use std::{
    fs, io,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use tokio::{io::AsyncWriteExt, process::Command};

use crate::{xkeen, AppState};

const CONFIG: &str = "/opt/etc/mihomo/config.yaml";
const CONFIG_DIR: &str = "/opt/etc/mihomo";
const BACKUP_DIR: &str = "/opt/sbin/core-backup";
const MAX_CONFIG: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyRequest {
    content: String,
    expected_content: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyResult {
    status: &'static str,
    path: &'static str,
    backup: String,
    restarted: bool,
    detail: String,
}

pub async fn apply_active(
    State(state): State<AppState>,
    Json(request): Json<ApplyRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Применение конфигурации доступно только на роутере",
        );
    }
    if request.content.is_empty()
        || request.content.len() > MAX_CONFIG
        || request.expected_content.len() > MAX_CONFIG
    {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Текущий конфиг и черновик должны быть не больше 4 MiB каждый",
        );
    }
    let _guard = state.core_update_lock.lock().await;
    match apply(&request.content, &request.expected_content).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => {
            let status = if message.starts_with("Конфиг на роутере изменился")
            {
                StatusCode::CONFLICT
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            };
            error(status, &message)
        }
    }
}

async fn apply(content: &str, expected_content: &str) -> Result<ApplyResult, String> {
    let meta = tokio::fs::symlink_metadata(CONFIG)
        .await
        .map_err(|e| format!("Не удалось проверить активный конфиг Mihomo: {e}"))?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Активный конфиг не является обычным файлом; замена запрещена".into());
    }
    if meta.len() > MAX_CONFIG as u64 {
        return Err("Активный конфиг больше 4 MiB; применение через панель запрещено".into());
    }
    let current = tokio::fs::read_to_string(CONFIG)
        .await
        .map_err(|e| format!("Не удалось прочитать текущий конфиг перед сравнением: {e}"))?;
    if current != expected_content {
        return Err("Конфиг на роутере изменился после чтения. Считайте его заново, чтобы не перезаписать чужие изменения".into());
    }

    let staged = unique_file(Path::new(CONFIG_DIR), "xkeen-ui-staged", "yaml");
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(meta.permissions().mode() & 0o777)
        .open(&staged)
        .await
        .map_err(|e| format!("Не удалось создать временный конфиг: {e}"))?;
    let write_result = async {
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await
    }
    .await;
    drop(file);
    if let Err(e) = write_result {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось записать временный конфиг: {e}"));
    }

    let core = ["/opt/sbin/mihomo", "/opt/bin/mihomo"]
        .into_iter()
        .find(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0))
        .ok_or_else(|| "Исполняемый Mihomo не найден в /opt/sbin или /opt/bin".to_owned());
    let core = match core {
        Ok(core) => core,
        Err(e) => {
            let _ = tokio::fs::remove_file(&staged).await;
            return Err(e);
        }
    };
    if let Err(e) = validate_config(core, &staged).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!(
            "Mihomo отклонил конфигурацию; активный файл не менялся: {e}"
        ));
    }

    let latest = tokio::fs::read_to_string(CONFIG)
        .await
        .map_err(|e| format!("Не удалось повторно проверить активный конфиг: {e}"))?;
    if latest != expected_content {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err("Конфиг на роутере изменился во время проверки. Считайте его заново, чтобы не перезаписать изменения".into());
    }

    let backup_dir = Path::new(BACKUP_DIR);
    ensure_backup_dir(backup_dir).await?;
    let backup = unique_file(backup_dir, "mihomo-config", "yaml");
    tokio::fs::copy(CONFIG, &backup)
        .await
        .map_err(|e| format!("Не удалось создать резервную копию; конфиг не менялся: {e}"))?;
    if let Err(e) = tokio::fs::set_permissions(&backup, fs::Permissions::from_mode(0o600)).await {
        let _ = tokio::fs::remove_file(&backup).await;
        return Err(format!(
            "Не удалось защитить резервную копию; конфиг не менялся: {e}"
        ));
    }

    if let Err(e) = tokio::fs::rename(&staged, CONFIG).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!(
            "Не удалось заменить активный конфиг; сохранён бэкап {}: {e}",
            backup.display()
        ));
    }

    let runtime = xkeen::read_status();
    let restart = runtime.running == Some(true) && runtime.core.as_deref() == Some("mihomo");
    if restart {
        let restarted =
            matches!(xkeen::control("restart").await, Ok(status) if status.running == Some(true));
        if !restarted {
            let rollback = restore_config(&backup, meta.permissions().mode() & 0o777).await;
            let restart_old = xkeen::control("restart").await;
            let detail = match (rollback, restart_old) {
                (Ok(()), Ok(status)) if status.running == Some(true) => {
                    "Прежний конфиг восстановлен, Mihomo запущен".to_owned()
                }
                (Ok(()), _) => {
                    "Прежний конфиг восстановлен, но запуск Mihomo не подтверждён".to_owned()
                }
                (Err(e), _) => format!("Откат не удался: {e}"),
            };
            return Err(format!(
                "Mihomo не подтвердил перезапуск; {detail}. Резервная копия: {}",
                backup.display()
            ));
        }
    }
    Ok(ApplyResult {
        status: if restart { "applied" } else { "saved" },
        path: CONFIG,
        backup: backup.to_string_lossy().into_owned(),
        restarted: restart,
        detail: if restart {
            "Конфигурация проверена Mihomo, сохранена с резервной копией и ядро перезапущено".into()
        } else {
            "Конфигурация проверена Mihomo и сохранена с резервной копией; ядро сейчас не работает"
                .into()
        },
    })
}

async fn validate_config(core: &str, staged: &Path) -> Result<(), String> {
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        Command::new(core)
            .args(["-t", "-f"])
            .arg(staged)
            .env_clear()
            .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
            .env("CLASH_HOME_DIR", CONFIG_DIR)
            .current_dir(CONFIG_DIR)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Проверка конфигурации превысила 20 секунд".to_owned())?
    .map_err(|e| format!("Не удалось запустить проверку Mihomo: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&output.stderr);
    let detail = text.chars().take(1024).collect::<String>();
    Err(if detail.trim().is_empty() {
        format!("код завершения {}", output.status)
    } else {
        detail.trim().to_owned()
    })
}

async fn ensure_backup_dir(path: &Path) -> Result<(), String> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {
            tokio::fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .await
                .map_err(|e| format!("Не удалось защитить каталог бэкапов: {e}"))
        }
        Ok(_) => Err("Каталог резервных копий Mihomo небезопасен; конфиг не менялся".into()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            tokio::fs::create_dir_all(path)
                .await
                .map_err(|e| format!("Не удалось создать каталог бэкапов: {e}"))?;
            tokio::fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .await
                .map_err(|e| format!("Не удалось защитить каталог бэкапов: {e}"))
        }
        Err(e) => Err(format!("Не удалось проверить каталог бэкапов: {e}")),
    }
}

async fn restore_config(backup: &Path, mode: u32) -> Result<(), String> {
    let staged = unique_file(Path::new(CONFIG_DIR), "xkeen-ui-rollback", "yaml");
    tokio::fs::copy(backup, &staged)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::set_permissions(&staged, fs::Permissions::from_mode(mode))
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(staged, CONFIG)
        .await
        .map_err(|e| e.to_string())
}

fn unique_file(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    dir.join(format!(".{name}-{}-{nanos}.{ext}", std::process::id()))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({"error": message}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::unique_file;
    use std::path::Path;

    #[test]
    fn staged_and_backup_names_are_unique_and_have_no_user_input() {
        let first = unique_file(Path::new("/tmp"), "mihomo-config", "yaml");
        let second = unique_file(Path::new("/tmp"), "mihomo-config", "yaml");
        assert_ne!(first, second);
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".mihomo-config-"));
        assert!(first.ends_with("yaml"));
    }
}
