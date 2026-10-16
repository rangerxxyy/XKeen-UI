use crate::{config_files, xkeen, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet, fs, net::IpAddr, os::unix::fs::OpenOptionsExt, path::Path,
    process::Stdio, time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command};
use tracing::{info, warn};

const CONFIG_PATH: &str = "/opt/etc/mihomo/config.yaml";
const DNS_STATE_PATH: &str = "/opt/etc/xkeen-ui/dns-restore.json";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DnsRestoreState {
    dns_override: bool,
    name_servers: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DnsToggleRequest {
    enabled: bool,
    expected_content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsControlStatus {
    dns_override: bool,
    mihomo_dns: bool,
    port_listener: Option<String>,
    name_servers: Vec<String>,
    detail: String,
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "error": message.into() }))).into_response()
}

async fn ndmc(command: &str) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        Command::new("ndmc")
            .args(["-c", command])
            .env_clear()
            .env("PATH", "/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin")
            .env("HOME", "/root")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| format!("Команда Keenetic не завершилась вовремя: {command}"))?
    .map_err(|e| format!("Не удалось выполнить команду Keenetic: {e}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        return Err(if detail.is_empty() {
            format!("Команда Keenetic завершилась с кодом {}", output.status)
        } else {
            format!("Команда Keenetic: {}", truncate(detail, 360))
        });
    }
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    if text.to_ascii_lowercase().contains("command not found")
        || text.to_ascii_lowercase().contains("invalid command")
    {
        return Err(format!(
            "Keenetic отклонил команду: {}",
            truncate(text.trim(), 360)
        ));
    }
    Ok(text)
}

fn parse_restore_state(output: &str) -> DnsRestoreState {
    let dns_override = output.lines().any(|line| {
        let line = line.trim();
        line == "opkg dns-override" || line.starts_with("opkg dns-override ")
    });
    let name_servers = output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            line.strip_prefix("ip name-server ")
                .or_else(|| line.strip_prefix("ipv6 name-server "))
        })
        .flat_map(str::split_whitespace)
        .filter_map(|value| {
            let address = value.trim_matches(|character| character == '\'' || character == '"');
            address.parse::<IpAddr>().ok().map(|_| address.to_owned())
        })
        .collect();
    DnsRestoreState {
        dns_override,
        name_servers,
    }
}

fn enable_router_dns_commands(previous: &DnsRestoreState, br0_ip: &str) -> Vec<String> {
    let ipv6_servers: Vec<_> = previous
        .name_servers
        .iter()
        .filter_map(|address| address.parse::<IpAddr>().ok().filter(IpAddr::is_ipv6))
        .collect();
    let mut commands = vec!["no ip name-server".to_owned()];
    if !ipv6_servers.is_empty() {
        commands.push("no ipv6 name-server".into());
        commands.extend(
            ipv6_servers
                .into_iter()
                .map(|address| format!("ipv6 name-server {address}")),
        );
    }
    commands.extend([
        format!("ip name-server {br0_ip}"),
        "opkg dns-override".into(),
        "system configuration save".into(),
    ]);
    commands
}

fn read_mihomo_dns_enabled(content: &str) -> bool {
    let mut in_dns = false;
    let mut enabled = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.chars().next().is_some_and(char::is_whitespace) {
            in_dns = trimmed == "dns:";
            continue;
        }
        if !in_dns {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("enable:") {
            enabled = value.split('#').next().unwrap_or("").trim() == "true";
        }
    }
    enabled
}

fn mihomo_dns_listens_on_router_interface(content: &str) -> bool {
    let mut in_dns = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.chars().next().is_some_and(char::is_whitespace) {
            in_dns = trimmed == "dns:";
            continue;
        }
        if in_dns {
            if let Some(value) = trimmed.strip_prefix("listen:") {
                return value
                    .split('#')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_matches(|character| character == '\'' || character == '"')
                    == "0.0.0.0:53";
            }
        }
    }
    false
}

fn mihomo_dns_preserves_router_handoff(content: &str) -> bool {
    read_mihomo_dns_enabled(content) && mihomo_dns_listens_on_router_interface(content)
}

fn set_mihomo_dns(content: &str, enabled: bool) -> String {
    let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
    let mut dns_start = None;
    let mut dns_end = lines.len();
    for (index, line) in lines.iter().enumerate() {
        if line.trim() == "dns:" && !line.chars().next().is_some_and(char::is_whitespace) {
            dns_start = Some(index);
        } else if dns_start.is_some()
            && !line.trim().is_empty()
            && !line.chars().next().is_some_and(char::is_whitespace)
            && !line.trim_start().starts_with('#')
        {
            dns_end = index;
            break;
        }
    }
    if dns_start.is_none() {
        if !lines.is_empty() && !lines.last().is_some_and(String::is_empty) {
            lines.push(String::new());
        }
        lines.extend([
            "dns:".into(),
            format!("  enable: {enabled}"),
            "  listen: 0.0.0.0:53".into(),
        ]);
    } else if let Some(start) = dns_start {
        let mut has_enable = false;
        let mut has_listen = false;
        for line in &mut lines[start + 1..dns_end] {
            let trimmed = line.trim_start();
            if trimmed.starts_with("enable:") {
                let indent = &line[..line.len() - trimmed.len()];
                *line = format!("{indent}enable: {enabled}");
                has_enable = true;
            } else if trimmed.starts_with("listen:") {
                let indent = &line[..line.len() - trimmed.len()];
                *line = format!("{indent}listen: 0.0.0.0:53");
                has_listen = true;
            }
        }
        let mut insert = Vec::new();
        if !has_enable {
            insert.push(format!("  enable: {enabled}"));
        }
        if !has_listen {
            insert.push("  listen: 0.0.0.0:53".into());
        }
        for (offset, line) in insert.into_iter().enumerate() {
            lines.insert(start + 1 + offset, line);
        }
    }
    format!("{}\n", lines.join("\n"))
}

fn get_br0_ip() -> Result<String, String> {
    let output = std::process::Command::new("ip")
        .args(["-4", "a", "s", "br0"])
        .output()
        .map_err(|e| format!("Не удалось прочитать адрес br0: {e}"))?;
    if !output.status.success() {
        return Err("Не удалось прочитать адрес br0".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().strip_prefix("inet "))
        .filter_map(|line| line.split('/').next())
        .find_map(|address| address.parse::<std::net::Ipv4Addr>().ok())
        .map(|address| address.to_string())
        .ok_or_else(|| "Не удалось определить IPv4-адрес br0".into())
}

fn port_53_listener() -> Option<String> {
    let mut sockets = BTreeSet::new();
    for protocol in ["tcp", "udp", "tcp6", "udp6"] {
        let table = fs::read_to_string(format!("/proc/net/{protocol}")).unwrap_or_default();
        for line in table.lines().skip(1) {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 10 || !fields[1].ends_with(":0035") {
                continue;
            }
            if protocol.starts_with("tcp") && fields[3] != "0A" {
                continue;
            }
            if !protocol.starts_with("tcp") && !fields[2].ends_with(":0000") {
                continue;
            }
            if let Ok(inode) = fields[9].parse::<u64>() {
                if inode > 0 {
                    sockets.insert(format!("socket:[{inode}]"));
                }
            }
        }
    }
    if sockets.is_empty() {
        return None;
    }
    let mut names = BTreeSet::new();
    for process in fs::read_dir("/proc").ok()?.flatten() {
        let Ok(fds) = fs::read_dir(process.path().join("fd")) else {
            continue;
        };
        if fds.flatten().any(|fd| {
            fs::read_link(fd.path())
                .is_ok_and(|link| sockets.contains(link.to_string_lossy().as_ref()))
        }) {
            names.insert(
                fs::read_to_string(process.path().join("comm"))
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            );
        }
    }
    (!names.is_empty()).then(|| names.into_iter().collect::<Vec<_>>().join(", "))
}

pub async fn status(State(state): State<AppState>) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Управление DNS доступно только на роутере",
        );
    }
    let config = match tokio::fs::read_to_string(CONFIG_PATH).await {
        Ok(config) => config,
        Err(_) => {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось прочитать config.yaml Mihomo",
            )
        }
    };
    match ndmc("show running-config").await {
        Ok(output) => {
            let restore = parse_restore_state(&output);
            Json(DnsControlStatus {
                dns_override: restore.dns_override,
                mihomo_dns: read_mihomo_dns_enabled(&config),
                port_listener: tokio::task::spawn_blocking(port_53_listener)
                    .await
                    .ok()
                    .flatten(),
                name_servers: restore.name_servers,
                detail: "Состояние прочитано из KeeneticOS и активного конфига Mihomo".into(),
            })
            .into_response()
        }
        Err(e) => error(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn ensure_dns_safe_to_stop() -> Result<(), String> {
    let running = ndmc("show running-config").await?;
    if parse_restore_state(&running).dns_override {
        return Err(
            "DNS Override KeeneticOS направляет запросы через XKeen. Сначала верните DNS KeeneticOS, затем останавливайте XKeen".into(),
        );
    }
    Ok(())
}

pub async fn ensure_dns_config_safe(content: &str) -> Result<(), String> {
    let running = ndmc("show running-config").await?;
    if parse_restore_state(&running).dns_override && !mihomo_dns_preserves_router_handoff(content) {
        return Err(
            "DNS Override KeeneticOS активен. Сначала верните DNS KeeneticOS, затем меняйте параметры DNS Mihomo или применяйте другой конфиг".into(),
        );
    }
    Ok(())
}

pub async fn toggle(
    State(state): State<AppState>,
    Json(request): Json<DnsToggleRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Управление DNS доступно только на роутере",
        );
    }
    let _guard = state.core_update_lock.lock().await;
    let init_status = xkeen::read_status();
    if request.enabled
        && (init_status.core.as_deref() != Some("mihomo") || init_status.running != Some(true))
    {
        return error(
            StatusCode::CONFLICT,
            "Для передачи DNS требуется запущенное ядро Mihomo",
        );
    }
    let current = match tokio::fs::read_to_string(CONFIG_PATH).await {
        Ok(current) => current,
        Err(_) => {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось прочитать config.yaml Mihomo",
            )
        }
    };
    if current != request.expected_content {
        return error(
            StatusCode::CONFLICT,
            "config.yaml изменился. Обновите его перед переключением DNS",
        );
    }
    let candidate = set_mihomo_dns(&current, request.enabled);
    if read_mihomo_dns_enabled(&candidate) != request.enabled
        || request.enabled && !mihomo_dns_listens_on_router_interface(&candidate)
    {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Черновик config.yaml не соответствует выбранному состоянию DNS",
        );
    }
    if let Err(e) = config_files::validate_managed_config(&candidate).await {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Конфигурация DNS не прошла проверку Mihomo: {e}"),
        );
    }

    let running = match ndmc("show running-config").await {
        Ok(value) => value,
        Err(e) => return error(StatusCode::BAD_GATEWAY, e),
    };
    let previous = parse_restore_state(&running);
    if request.enabled && previous.dns_override {
        return error(StatusCode::CONFLICT, "DNS Override уже включён в KeeneticOS. Сначала отключите его или проверьте текущий режим DNS");
    }
    let br0_ip = match get_br0_ip() {
        Ok(value) => value,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };

    if request.enabled {
        if let Err(e) = write_restore_state(&previous).await {
            return error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        info!("Передача DNS KeeneticOS в Mihomo начата");
        if let Err(e) = config_files::apply_managed_config(&candidate, &current).await {
            let cleanup = tokio::fs::remove_file(DNS_STATE_PATH).await;
            return match cleanup {
                Ok(()) => error(StatusCode::UNPROCESSABLE_ENTITY, e),
                Err(cleanup_error) => error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("{e}; конфиг остался прежним, но резерв не удалён: {cleanup_error}"),
                ),
            };
        }
        for command in enable_router_dns_commands(&previous, &br0_ip) {
            if let Err(e) = ndmc(&command).await {
                return rollback_enable(&previous, &current, &candidate, e).await;
            }
        }
    } else {
        let backup = match read_restore_state().await {
            Ok(Some(value)) => value,
            Ok(None) => {
                return error(
                    StatusCode::CONFLICT,
                    "Нет сохранённого состояния DNS для безопасного возврата к KeeneticOS",
                )
            }
            Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        info!("Возврат DNS Mihomo в KeeneticOS начат");
        if let Err(e) = restore_router_dns(&backup).await {
            return error(
                StatusCode::BAD_GATEWAY,
                format!("KeeneticOS не подтвердил возврат DNS; резерв сохранён для повтора. {e}"),
            );
        }
        if let Err(e) = config_files::apply_managed_config(&candidate, &current).await {
            return error(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("DNS роутера возвращён; DNS Mihomo остался включён в конфиге: {e}"),
            );
        }
        if let Err(e) = tokio::fs::remove_file(DNS_STATE_PATH).await {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("DNS возвращён KeeneticOS, но резерв не удалён: {e}"),
            );
        }
    }

    Json(serde_json::json!({ "success": true, "status": status_data().await })).into_response()
}

async fn status_data() -> Option<DnsControlStatus> {
    let config = tokio::fs::read_to_string(CONFIG_PATH).await.ok()?;
    let output = ndmc("show running-config").await.ok()?;
    let restore = parse_restore_state(&output);
    Some(DnsControlStatus {
        dns_override: restore.dns_override,
        mihomo_dns: read_mihomo_dns_enabled(&config),
        port_listener: tokio::task::spawn_blocking(port_53_listener)
            .await
            .ok()
            .flatten(),
        name_servers: restore.name_servers,
        detail: "Состояние прочитано из KeeneticOS и активного конфига Mihomo".into(),
    })
}

async fn restore_router_dns(state: &DnsRestoreState) -> Result<(), String> {
    ndmc("no opkg dns-override").await?;
    ndmc("no ip name-server").await?;
    if state.name_servers.iter().any(|address| {
        address
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_ipv6())
    }) {
        ndmc("no ipv6 name-server").await?;
    }
    for address in &state.name_servers {
        let parsed = address
            .parse::<IpAddr>()
            .map_err(|_| "Резерв DNS содержит некорректный IP-адрес".to_owned())?;
        let command = match parsed {
            IpAddr::V4(_) => format!("ip name-server {parsed}"),
            IpAddr::V6(_) => format!("ipv6 name-server {parsed}"),
        };
        ndmc(&command).await?;
    }
    if state.dns_override {
        ndmc("opkg dns-override").await?;
    }
    ndmc("system configuration save").await?;
    Ok(())
}

async fn rollback_enable(
    previous: &DnsRestoreState,
    current: &str,
    candidate: &str,
    cause: String,
) -> Response {
    match restore_router_dns(previous).await {
        Ok(()) => {
            warn!("Передача DNS в Mihomo не завершилась; исходные DNS KeeneticOS восстановлены");
            let config_rollback = config_files::apply_managed_config(current, candidate).await;
            if let Err(config_error) = config_rollback {
                return error(
                    StatusCode::BAD_GATEWAY,
                    format!("{cause}; DNS роутера восстановлен, но DNS Mihomo в конфиге не удалось откатить: {config_error}. Резерв сохранён для проверки"),
                );
            }
            if let Err(remove_error) = tokio::fs::remove_file(DNS_STATE_PATH).await {
                error(StatusCode::INTERNAL_SERVER_ERROR, format!("{cause}; прежние DNS-настройки восстановлены, но резерв не удалён: {remove_error}"))
            } else {
                error(StatusCode::UNPROCESSABLE_ENTITY, format!("{cause}; исходные DNS-настройки роутера и Mihomo восстановлены"))
            }
        }
        Err(rollback) => error(StatusCode::BAD_GATEWAY, format!("{cause}; откат KeeneticOS не завершён: {rollback}. Резерв сохранён в {DNS_STATE_PATH}")),
    }
}

async fn read_restore_state() -> Result<Option<DnsRestoreState>, String> {
    match tokio::fs::symlink_metadata(DNS_STATE_PATH).await {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() && meta.len() <= 16 * 1024 => {
            let value = tokio::fs::read_to_string(DNS_STATE_PATH)
                .await
                .map_err(|e| format!("Не удалось прочитать резерв состояния DNS: {e}"))?;
            let state: DnsRestoreState = serde_json::from_str(&value)
                .map_err(|e| format!("Резерв состояния DNS повреждён: {e}"))?;
            if state.name_servers.len() > 32
                || state
                    .name_servers
                    .iter()
                    .any(|address| address.parse::<IpAddr>().is_err())
            {
                return Err("Резерв DNS содержит некорректные серверы".into());
            }
            Ok(Some(state))
        }
        Ok(_) => Err("Файл резервного состояния DNS имеет неподдерживаемый тип".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Не удалось проверить резерв состояния DNS: {e}")),
    }
}

async fn write_restore_state(state: &DnsRestoreState) -> Result<(), String> {
    let path = Path::new(DNS_STATE_PATH);
    let parent = path.parent().ok_or("Некорректный путь резерва DNS")?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| format!("Не удалось создать каталог резерва DNS: {e}"))?;
    match tokio::fs::symlink_metadata(path).await {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
            let existing = read_restore_state()
                .await?
                .ok_or_else(|| "Не удалось прочитать существующий резерв DNS".to_owned())?;
            if existing != *state {
                return Err(
                    "Существует резерв DNS с другими настройками. Он не будет перезаписан автоматически".into(),
                );
            }
            return Ok(());
        }
        Ok(_) => return Err("Файл резерва DNS имеет неподдерживаемый тип".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Не удалось проверить резерв DNS: {e}")),
    }
    let staged = parent.join(format!(".dns-restore-{}.tmp", std::process::id()));
    let bytes =
        serde_json::to_vec(state).map_err(|e| format!("Не удалось собрать резерв DNS: {e}"))?;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staged)
        .await
        .map_err(|e| format!("Не удалось создать резерв DNS: {e}"))?;
    if let Err(e) = file.write_all(&bytes).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось записать резерв DNS: {e}"));
    }
    if let Err(e) = file.sync_all().await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось сохранить резерв DNS: {e}"));
    }
    drop(file);
    tokio::fs::rename(&staged, path)
        .await
        .map_err(|e| format!("Не удалось установить резерв DNS: {e}"))
}

fn truncate(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::{
        enable_router_dns_commands, mihomo_dns_listens_on_router_interface,
        mihomo_dns_preserves_router_handoff, parse_restore_state, read_mihomo_dns_enabled,
        set_mihomo_dns, DnsRestoreState,
    };

    #[test]
    fn reads_dns_runtime_and_nameservers_without_interpreting_comments() {
        let config = "# dns:\nlog-level: info\ndns:\n  enable: true\n  listen: 0.0.0.0:53\n";
        assert!(read_mihomo_dns_enabled(config));
        assert!(mihomo_dns_listens_on_router_interface(config));
        assert!(read_mihomo_dns_enabled(
            "dns:\n  enable: true\n  listen: 127.0.0.1:53\n"
        ));
        assert!(!mihomo_dns_listens_on_router_interface(
            "dns:\n  enable: true\n  listen: 127.0.0.1:53\n"
        ));
        assert!(!read_mihomo_dns_enabled(
            "dns:\n  # enable: true\n  listen: 0.0.0.0:53\n"
        ));
        let state = parse_restore_state(
            "opkg dns-override\nip name-server 192.168.1.1\nip name-server 77.88.8.8\nipv6 name-server 2001:4860:4860::8888\n",
        );
        assert!(state.dns_override);
        assert_eq!(
            state.name_servers,
            ["192.168.1.1", "77.88.8.8", "2001:4860:4860::8888"]
        );
        let untouched = parse_restore_state("ip name-server 77.88.8.8\n");
        assert_eq!(
            untouched,
            DnsRestoreState {
                dns_override: false,
                name_servers: vec!["77.88.8.8".into()],
            }
        );
    }

    #[test]
    fn changes_only_dns_enable_and_listen_preserving_other_yaml_sections() {
        let original =
            "log-level: info\ndns:\n  enable: false\n  nameserver:\n    - 1.1.1.1\nproxies: []\n";
        let enabled = set_mihomo_dns(original, true);
        assert!(read_mihomo_dns_enabled(&enabled));
        assert!(enabled.contains("    - 1.1.1.1"));
        assert!(enabled.contains("proxies: []"));
        let disabled = set_mihomo_dns(&enabled, false);
        assert!(!read_mihomo_dns_enabled(&disabled));
    }

    #[test]
    fn router_handoff_requires_enabled_dns_bound_to_router_interface() {
        assert!(mihomo_dns_preserves_router_handoff(
            "dns:\n  enable: true\n  listen: 0.0.0.0:53\n"
        ));
        assert!(!mihomo_dns_preserves_router_handoff(
            "dns:\n  enable: false\n  listen: 0.0.0.0:53\n"
        ));
        assert!(!mihomo_dns_preserves_router_handoff(
            "dns:\n  enable: true\n  listen: 127.0.0.1:53\n"
        ));
    }

    #[test]
    fn enabling_handoff_preserves_ipv6_nameservers() {
        let previous = DnsRestoreState {
            dns_override: false,
            name_servers: vec!["77.88.8.8".into(), "2001:4860:4860::8888".into()],
        };
        assert_eq!(
            enable_router_dns_commands(&previous, "192.168.1.1"),
            [
                "no ip name-server",
                "no ipv6 name-server",
                "ipv6 name-server 2001:4860:4860::8888",
                "ip name-server 192.168.1.1",
                "opkg dns-override",
                "system configuration save",
            ]
        );
    }
}
