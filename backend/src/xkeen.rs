use serde::Serialize;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::process::Command;

const INFO_FILE: &str = "/opt/sbin/.xkeen/01_info/01_info_variable.sh";
const INIT_DIR: &str = "/opt/etc/init.d";
const ALLOWED_CLIENTS: [&str; 2] = ["mihomo", "xray"];
const SERVICE_STATE_TIMEOUT: usize = 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XkeenStatus {
    pub installed: bool,
    pub running: Option<bool>,
    pub version: Option<String>,
    pub core: Option<String>,
    pub init_path: Option<String>,
    pub detail: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequest {
    pub action: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ProcessIdentity {
    pid: u32,
    start_ticks: u64,
}

pub fn read_status() -> XkeenStatus {
    let info = fs::read_to_string(INFO_FILE).ok();
    let init_path = info
        .as_deref()
        .and_then(resolve_init_path)
        .or_else(fallback_init_path);
    let version = info
        .as_deref()
        .and_then(|text| shell_assignment(text, "xkeen_current_version"))
        .filter(|value| !value.is_empty() && value.len() <= 64);
    let init_contents = init_path
        .as_deref()
        .and_then(|path| fs::read_to_string(path).ok());
    let core = init_contents
        .as_deref()
        .and_then(|text| shell_assignment(text, "name_client"))
        .or_else(|| {
            init_path
                .as_deref()
                .filter(|path| path.ends_with("/S24xray"))
                .map(|_| "xray".to_owned())
        })
        .filter(|value| ALLOWED_CLIENTS.contains(&value.as_str()));

    let installed = init_path
        .as_deref()
        .is_some_and(|path| executable_file(Path::new(path)));
    let running = if installed {
        core.as_deref().map(process_is_running)
    } else {
        None
    };
    let detail = match (installed, running) {
        (false, _) => "Не найден штатный init-файл XKeen".to_owned(),
        (true, Some(true)) => "Процесс ядра обнаружен".to_owned(),
        (true, Some(false)) => "Процесс ядра не обнаружен".to_owned(),
        (true, None) => "Не удалось определить активное ядро".to_owned(),
    };

    XkeenStatus {
        installed,
        running,
        version,
        core,
        init_path,
        detail,
    }
}

pub async fn control(action: &str) -> Result<XkeenStatus, String> {
    let before = read_status();
    let action_name = match action {
        "start" | "stop" | "restart" => action,
        _ => "invalid",
    };
    let before_processes = before
        .core
        .as_deref()
        .map(process_identities)
        .unwrap_or_default();
    let requested_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let requested_event = format!(
        "unix={requested_at} component=xkeen phase=requested action={action_name} running_before={} result=started",
        display_running(before.running),
    );
    if let Err(error) = crate::logs::append_xkeen_lifecycle(&[requested_event]) {
        tracing::warn!(%error, "Could not append XKeen lifecycle request to Journal log");
    }
    let path = before.init_path.as_deref().filter(|_| before.installed);
    let mut command_result = "not-started";
    let result = match control_args(action) {
        Err(error) => Err(error),
        Ok(args) => match path {
            None => Err("Не найден исполняемый init-файл XKeen".to_owned()),
            Some(path) => match execute_init_command(Path::new(path), args).await {
                Err(error) => {
                    command_result = "failed";
                    Err(error)
                }
                Ok(()) => {
                    command_result = "exit-0";
                    let mut confirmed = None;
                    for _ in 0..SERVICE_STATE_TIMEOUT {
                        let current = before
                            .core
                            .as_deref()
                            .map(process_identities)
                            .unwrap_or_default();
                        if process_transition_verified(action, &before_processes, &current) {
                            confirmed = Some(read_status());
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    confirmed.ok_or_else(|| {
                        let current = read_status();
                        format!(
                            "Команда XKeen завершилась успешно, но действие не подтверждено: {}",
                            current.detail
                        )
                    })
                }
            },
        },
    };
    let after = read_status();
    let after_processes = after
        .core
        .as_deref()
        .map(process_identities)
        .unwrap_or_default();
    let result = require_verified_transition(action, result, &before_processes, &after_processes);
    let verified = result.is_ok();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut event = format!(
        "unix={timestamp} component=xkeen phase=completed action={action_name} command={command_result} running_before={} running_after={} process_transition={} result={}",
        display_running(before.running),
        display_running(after.running),
        if verified { "verified" } else { "unverified" },
        if verified { "success" } else { "failure" },
    );
    if let Err(error) = &result {
        event.push_str(" error=");
        event.push_str(error);
    }
    let log_result = crate::logs::append_xkeen_lifecycle(&[event]);
    if let Err(error) = &log_result {
        tracing::warn!(%error, "Could not append XKeen lifecycle event to Journal log");
    }
    result.map(|_| {
        let mut status = after;
        if let Err(error) = log_result {
            status.detail = format!("{}. Запись в журнал не удалась: {error}", status.detail);
        }
        status
    })
}

pub(super) fn log_blocked_action(action: &str, reason: &str) {
    let action = match action {
        "start" | "stop" | "restart" => action,
        _ => "invalid",
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let entry = format!(
        "unix={timestamp} component=xkeen action={action} command=not-run process_transition=blocked result=blocked error={reason}"
    );
    if let Err(error) = crate::logs::append_xkeen_lifecycle(&[entry]) {
        tracing::warn!(%error, "Could not append blocked XKeen action to Journal log");
    }
}

fn require_verified_transition<T>(
    action: &str,
    result: Result<T, String>,
    before: &[ProcessIdentity],
    after: &[ProcessIdentity],
) -> Result<T, String> {
    match result {
        Ok(value) if process_transition_verified(action, before, after) => Ok(value),
        Ok(_) => Err(format!(
            "Команда XKeen завершилась, но переход процесса для действия {action} не подтверждён"
        )),
        Err(error) => Err(error),
    }
}

fn display_running(running: Option<bool>) -> &'static str {
    match running {
        Some(true) => "true",
        Some(false) => "false",
        None => "unknown",
    }
}

fn process_transition_verified(
    action: &str,
    before: &[ProcessIdentity],
    after: &[ProcessIdentity],
) -> bool {
    match action {
        "start" => !after.is_empty(),
        "stop" => after.is_empty(),
        "restart" => {
            !after.is_empty()
                && (before.is_empty() || before.iter().all(|identity| !after.contains(identity)))
        }
        _ => false,
    }
}

async fn execute_init_command(path: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .kill_on_drop(true)
        .env_clear()
        .env("PATH", "/opt/sbin:/opt/bin:/sbin:/bin:/usr/sbin:/usr/bin")
        .stdin(Stdio::null())
        // Init scripts can start a daemon that inherits its parent's stdout/stderr.
        // Keep those descriptors detached from the HTTP request before waiting.
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("HOME", "/root")
        .env("TERM", "dumb");
    let status = tokio::time::timeout(Duration::from_secs(30), command.status())
        .await
        .map_err(|_| "Команда XKeen не завершилась за 30 секунд".to_owned())?
        .map_err(|error| format!("Не удалось выполнить {}: {error}", path.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("XKeen завершил команду с кодом {status}"))
    }
}

fn control_args(action: &str) -> Result<&'static [&'static str], String> {
    match action {
        "start" => Ok(&["start", "on"]),
        "stop" => Ok(&["stop"]),
        "restart" => Ok(&["restart", "on"]),
        _ => Err("Допустимы только start, stop и restart".to_owned()),
    }
}

fn process_is_running(name: &str) -> bool {
    !process_identities(name).is_empty()
}

fn process_identities(name: &str) -> Vec<ProcessIdentity> {
    let mut identities = fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
            let comm = fs::read_to_string(entry.path().join("comm")).ok()?;
            if comm.trim() != name {
                return None;
            }
            let stat = fs::read_to_string(entry.path().join("stat")).ok()?;
            let start_ticks = process_start_ticks(&stat)?;
            Some(ProcessIdentity { pid, start_ticks })
        })
        .collect::<Vec<_>>();
    identities.sort_unstable();
    identities
}

fn process_start_ticks(stat: &str) -> Option<u64> {
    let comm_end = stat.rfind(')')?;
    stat[comm_end + 1..]
        .split_whitespace()
        .nth(19)?
        .parse()
        .ok()
}

fn executable_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.is_file()
            && !metadata.file_type().is_symlink()
            && metadata.permissions().mode() & 0o111 != 0
    })
}

fn resolve_init_path(info: &str) -> Option<String> {
    let dir = shell_assignment(info, "initd_dir")?;
    let file = shell_assignment(info, "initd_file")?;
    let resolved = file.replace("$initd_dir", &dir);
    let path = if Path::new(&resolved).is_absolute() {
        PathBuf::from(resolved)
    } else {
        PathBuf::from(dir).join(resolved)
    };
    safe_init_path(&path).then(|| path.to_string_lossy().into_owned())
}

fn fallback_init_path() -> Option<String> {
    [
        PathBuf::from("/opt/etc/init.d/S05xkeen"),
        PathBuf::from("/opt/etc/init.d/S99xkeen"),
    ]
    .into_iter()
    .find(|path| executable_file(path))
    .map(|path| path.to_string_lossy().into_owned())
}

fn safe_init_path(path: &Path) -> bool {
    path.parent() == Some(Path::new(INIT_DIR))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with('S')
                    && name.len() <= 128
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })
}

fn shell_assignment(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, raw) = line.split_once('=')?;
        if name.trim() != key {
            return None;
        }
        let value = raw.split('#').next()?.trim();
        let value = value.trim_matches(|character| character == '\'' || character == '"');
        (!value.is_empty() && value.len() <= 512).then(|| value.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        control_args, execute_init_command, process_start_ticks, process_transition_verified,
        require_verified_transition, resolve_init_path, safe_init_path, shell_assignment,
        ProcessIdentity,
    };
    use std::{
        os::unix::fs::PermissionsExt,
        path::Path,
        time::{Duration, Instant},
    };

    #[test]
    fn reads_xkeen_config_without_sourcing_shell() {
        let text = "initd_dir=\"/opt/etc/init.d\" # dir\ninitd_file=\"$initd_dir/S05xkeen\"\nxkeen_current_version=2.1";
        assert_eq!(
            resolve_init_path(text).as_deref(),
            Some("/opt/etc/init.d/S05xkeen")
        );
        assert_eq!(
            shell_assignment(text, "xkeen_current_version").as_deref(),
            Some("2.1")
        );
    }

    #[test]
    fn rejects_init_paths_outside_the_entware_init_directory() {
        assert!(!safe_init_path(Path::new("/tmp/evil")));
        assert!(!safe_init_path(Path::new("/opt/etc/init.d/../../tmp/evil")));
        assert!(safe_init_path(Path::new("/opt/etc/init.d/S05xkeen")));
    }

    #[test]
    fn maps_service_actions_to_supported_init_commands() {
        assert_eq!(control_args("start").unwrap(), &["start", "on"]);
        assert_eq!(control_args("stop").unwrap(), &["stop"]);
        assert_eq!(control_args("restart").unwrap(), &["restart", "on"]);
        assert!(control_args("invalid").is_err());
    }

    #[test]
    fn restart_requires_a_new_process_identity() {
        let old = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        assert!(!process_transition_verified("restart", &[old], &[old]));
    }

    #[test]
    fn restart_accepts_a_replaced_process_and_start_from_stopped_state() {
        let old = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let new = ProcessIdentity {
            pid: 321,
            start_ticks: 901,
        };
        assert!(process_transition_verified("restart", &[old], &[new]));
        assert!(process_transition_verified("restart", &[], &[new]));
    }

    #[test]
    fn start_and_stop_require_the_expected_process_presence() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        assert!(process_transition_verified("start", &[], &[identity]));
        assert!(!process_transition_verified("start", &[], &[]));
        assert!(process_transition_verified("stop", &[identity], &[]));
        assert!(!process_transition_verified(
            "stop",
            &[identity],
            &[identity]
        ));
    }

    #[test]
    fn refuses_to_return_success_when_final_restart_transition_is_unverified() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let result = require_verified_transition("restart", Ok(()), &[identity], &[identity]);
        assert!(result.unwrap_err().contains("не подтверждён"));
    }

    #[test]
    fn preserves_command_failure_when_transition_is_unverified() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let result = require_verified_transition(
            "restart",
            Err::<(), _>("XKeen завершил команду с кодом 1".to_owned()),
            &[identity],
            &[identity],
        );
        assert_eq!(result.unwrap_err(), "XKeen завершил команду с кодом 1");
    }

    #[test]
    fn parses_process_start_time_after_comm_with_spaces_and_parentheses() {
        let fields = std::iter::once("S")
            .chain(std::iter::repeat_n("0", 18))
            .chain(std::iter::once("98765"))
            .collect::<Vec<_>>()
            .join(" ");
        let stat = format!("42 (mihomo (worker)) {fields}");
        assert_eq!(process_start_ticks(&stat), Some(98765));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn init_command_does_not_wait_for_a_background_daemon() {
        let path =
            std::env::temp_dir().join(format!("xkeen-ui-control-test-{}.sh", std::process::id()));
        std::fs::write(&path, "#!/bin/sh\n(sleep 2) &\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();

        let started = Instant::now();
        let result = execute_init_command(&path, &["restart", "on"]).await;
        let elapsed = started.elapsed();
        let _ = std::fs::remove_file(&path);

        assert!(result.is_ok());
        assert!(elapsed < Duration::from_millis(1_500));
    }

    #[test]
    fn allows_only_supported_core_names() {
        let text = "name_client=../../busybox";
        let value = shell_assignment(text, "name_client").unwrap();
        assert!(!super::ALLOWED_CLIENTS.contains(&value.as_str()));
        assert!(super::ALLOWED_CLIENTS.contains(&"mihomo"));
    }
}
