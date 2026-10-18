use std::{
    fs, io,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Path as UrlPath, State},
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
const MAX_LIST: usize = 1024 * 1024;
const MAX_BACKUP_SCAN: usize = 500;
const MAX_BACKUPS: usize = 100;

fn is_mihomo_backup_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix(".mihomo-config-") else {
        return false;
    };
    let Some(rest) = rest.strip_suffix(".yaml") else {
        return false;
    };
    let Some((pid, nanos)) = rest.split_once('-') else {
        return false;
    };
    !pid.is_empty()
        && !nanos.is_empty()
        && pid.bytes().all(|b| b.is_ascii_digit())
        && nanos.bytes().all(|b| b.is_ascii_digit())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBackupEntry {
    id: String,
    size: u64,
    modified: u64,
}

pub async fn list_mihomo_backups(State(state): State<AppState>) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Резервные копии доступны только на роутере",
        );
    }
    let mut directory = match tokio::fs::read_dir(BACKUP_DIR).await {
        Ok(value) => value,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return Json(serde_json::json!({"backups": []})).into_response()
        }
        Err(_) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Не удалось прочитать каталог резервных копий",
            )
        }
    };
    let mut backups = Vec::new();
    for _ in 0..MAX_BACKUP_SCAN {
        let entry = match directory.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(_) => {
                return error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Не удалось прочитать каталог резервных копий",
                )
            }
        };
        let id = entry.file_name().to_string_lossy().into_owned();
        if !is_mihomo_backup_id(&id) {
            continue;
        }
        let metadata = match tokio::fs::symlink_metadata(entry.path()).await {
            Ok(meta)
                if meta.is_file()
                    && !meta.file_type().is_symlink()
                    && meta.len() <= MAX_CONFIG as u64 =>
            {
                meta
            }
            _ => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_secs());
        backups.push(ConfigBackupEntry {
            id,
            size: metadata.len(),
            modified,
        });
    }
    backups.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| b.id.cmp(&a.id)));
    backups.truncate(MAX_BACKUPS);
    Json(serde_json::json!({ "backups": backups })).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RestoreBackupRequest {
    backup_id: String,
    expected_content: String,
}

pub async fn restore_mihomo_backup(
    State(state): State<AppState>,
    Json(request): Json<RestoreBackupRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Восстановление доступно только на роутере",
        );
    }
    if !is_mihomo_backup_id(&request.backup_id) {
        return error(
            StatusCode::BAD_REQUEST,
            "Некорректный идентификатор резервной копии",
        );
    }
    if request.expected_content.len() > MAX_CONFIG {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Текущий конфиг должен быть не больше 4 MiB",
        );
    }
    let _guard = state.core_update_lock.lock().await;
    let backup = Path::new(BACKUP_DIR).join(&request.backup_id);
    let metadata = match tokio::fs::symlink_metadata(&backup).await {
        Ok(meta)
            if meta.is_file()
                && !meta.file_type().is_symlink()
                && meta.len() <= MAX_CONFIG as u64 =>
        {
            meta
        }
        Ok(_) => {
            return error(
                StatusCode::BAD_REQUEST,
                "Резервная копия не является обычным YAML-файлом",
            )
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return error(StatusCode::NOT_FOUND, "Резервная копия не найдена")
        }
        Err(_) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Не удалось проверить резервную копию",
            )
        }
    };
    let content = match tokio::fs::read_to_string(&backup).await {
        Ok(content) if !content.trim().is_empty() => content,
        Ok(_) => return error(StatusCode::UNPROCESSABLE_ENTITY, "Резервная копия пуста"),
        Err(_) => {
            return error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Резервная копия не является корректным UTF-8",
            )
        }
    };
    if let Err(message) = crate::dns_control::ensure_dns_config_safe(&content).await {
        return error(StatusCode::CONFLICT, &message);
    }
    match apply(&content, &request.expected_content).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => error(config_write_error_status(&message), &message),
    }
}

fn user_file_path(file: &str) -> Option<&'static str> {
    match file {
        "ip_exclude" => Some("/opt/etc/xkeen/ip_exclude.lst"),
        "port_exclude" => Some("/opt/etc/xkeen/port_exclude.lst"),
        "port_proxying" => Some("/opt/etc/xkeen/port_proxying.lst"),
        "xkeen" => Some("/opt/etc/xkeen/xkeen.json"),
        "xray_outbounds" => Some("/opt/etc/xray/configs/04_outbounds.json"),
        "xray_routing" => Some("/opt/etc/xray/configs/05_routing.json"),
        _ => None,
    }
}

pub async fn read_user_file(
    State(state): State<AppState>,
    UrlPath(file): UrlPath<String>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Чтение файлов доступно только на роутере",
        );
    }
    let Some(path) = user_file_path(&file) else {
        return error(StatusCode::NOT_FOUND, "Неизвестный файл конфигурации");
    };
    let metadata = match tokio::fs::symlink_metadata(path).await {
        Ok(value) if value.is_file() && !value.file_type().is_symlink() => value,
        Ok(_) => {
            return error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Файл не является обычным файлом",
            )
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return error(StatusCode::NOT_FOUND, "Файл на роутере не найден")
        }
        Err(_) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Не удалось проверить файл",
            )
        }
    };
    if metadata.len() > MAX_LIST as u64 {
        return error(StatusCode::PAYLOAD_TOO_LARGE, "Файл больше 1 MiB");
    }
    match tokio::fs::read_to_string(path).await {
        Ok(content) => Json(serde_json::json!({ "file": file, "path": path, "content": content }))
            .into_response(),
        Err(_) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Не удалось прочитать файл как UTF-8",
        ),
    }
}

pub async fn save_user_file(
    State(state): State<AppState>,
    UrlPath(file): UrlPath<String>,
    Json(request): Json<ApplyRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Сохранение файлов доступно только на роутере",
        );
    }
    let Some(path) = user_file_path(&file) else {
        return error(StatusCode::NOT_FOUND, "Неизвестный файл конфигурации");
    };
    if request.content.len() > MAX_LIST || request.expected_content.len() > MAX_LIST {
        return error(StatusCode::PAYLOAD_TOO_LARGE, "Файл больше 1 MiB");
    }
    let _guard = state.core_update_lock.lock().await;
    match save_list(path, &file, &request.content, &request.expected_content).await {
        Ok(backup) => Json(serde_json::json!({
            "status": "saved", "path": path, "backup": backup,
            "detail": "Файл сохранён на роутере; для применения сетевых правил перезапустите XKeen"
        }))
        .into_response(),
        Err(message) => error(
            if message.starts_with("Файл на роутере изменился") {
                StatusCode::CONFLICT
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            &message,
        ),
    }
}

pub async fn apply_xray_file(
    State(state): State<AppState>,
    UrlPath(file): UrlPath<String>,
    Json(request): Json<ApplyRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Применение Xray доступно только на роутере",
        );
    }
    let Some(path) = user_file_path(&file).filter(|_| file.starts_with("xray_")) else {
        return error(StatusCode::NOT_FOUND, "Неизвестный файл конфигурации Xray");
    };
    if request.content.len() > MAX_LIST || request.expected_content.len() > MAX_LIST {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Файл Xray должен быть не больше 1 MiB",
        );
    }
    let _guard = state.core_update_lock.lock().await;
    match apply_xray(path, &file, &request.content, &request.expected_content).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => {
            let status = if message.starts_with("Файл на роутере изменился") {
                StatusCode::CONFLICT
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            };
            error(status, &message)
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct XrayApplyResult {
    status: &'static str,
    path: &'static str,
    backup: String,
    restarted: bool,
    detail: String,
}

async fn apply_xray(
    path: &'static str,
    file: &str,
    content: &str,
    expected: &str,
) -> Result<XrayApplyResult, String> {
    if !matches!(
        serde_json::from_str::<serde_json::Value>(content),
        Ok(serde_json::Value::Object(_))
    ) {
        return Err("Xray отклонил файл: ожидается корректный JSON-объект".into());
    }
    let binary = ["/opt/sbin/xray", "/opt/bin/xray"]
        .into_iter()
        .find(|candidate| {
            fs::metadata(candidate)
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| "Исполняемый Xray не найден в /opt/sbin или /opt/bin".to_owned())?;
    let backup = save_list(path, file, content, expected).await?;
    let output = match tokio::time::timeout(
        Duration::from_secs(20),
        Command::new(binary)
            .args(["run", "-test"])
            .env_clear()
            .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
            .env("XRAY_LOCATION_CONFDIR", "/opt/etc/xray/configs")
            .env("XRAY_LOCATION_ASSET", "/opt/etc/xray/dat")
            .current_dir("/opt/etc/xray")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            restore_user_file(path, &backup).await?;
            return Err(format!(
                "Не удалось запустить проверку Xray; прежний файл восстановлен: {error}"
            ));
        }
        Err(_) => {
            restore_user_file(path, &backup).await?;
            return Err("Проверка Xray превысила 20 секунд; прежний файл восстановлен".into());
        }
    };
    if !output.status.success() {
        restore_user_file(path, &backup).await?;
        return Err(format!(
            "Xray отклонил конфигурацию; прежний файл восстановлен: {}",
            validation_detail(&output.status.to_string(), &output.stderr, &output.stdout)
        ));
    }
    let runtime = xkeen::read_status();
    let restart = runtime.running == Some(true) && runtime.core.as_deref() == Some("xray");
    if restart
        && !matches!(xkeen::control("restart").await, Ok(status) if status.running == Some(true))
    {
        let rollback = restore_user_file(path, &backup).await;
        let restart_old = xkeen::control("restart").await;
        let detail = match (rollback, restart_old) {
            (Ok(()), Ok(status)) if status.running == Some(true) => {
                "исходный файл восстановлен, Xray запущен".to_owned()
            }
            (Ok(()), _) => "исходный файл восстановлен, но запуск Xray не подтверждён".to_owned(),
            (Err(e), _) => format!("откат не удался: {e}"),
        };
        return Err(format!(
            "Не удалось подтвердить перезапуск Xray; {detail}. Резервная копия: {backup}"
        ));
    }
    Ok(XrayApplyResult {
        status: if restart { "applied" } else { "saved" },
        path,
        backup,
        restarted: restart,
        detail: if restart {
            "Файл проверен Xray, сохранён с резервной копией и ядро перезапущено".into()
        } else {
            "Файл проверен Xray и сохранён с резервной копией; Xray сейчас не работает".into()
        },
    })
}

async fn restore_user_file(path: &str, backup: &str) -> Result<(), String> {
    let metadata = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|e| format!("Не удалось проверить файл перед откатом: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Файл для отката небезопасен".into());
    }
    let parent = Path::new(path)
        .parent()
        .ok_or("Не удалось определить каталог файла")?;
    let staged = unique_file(parent, "xkeen-ui-rollback", "json");
    tokio::fs::copy(backup, &staged)
        .await
        .map_err(|e| format!("Не удалось подготовить откат: {e}"))?;
    tokio::fs::set_permissions(
        &staged,
        fs::Permissions::from_mode(metadata.permissions().mode() & 0o777),
    )
    .await
    .map_err(|e| format!("Не удалось назначить права при откате: {e}"))?;
    tokio::fs::rename(staged, path)
        .await
        .map_err(|e| format!("Не удалось восстановить исходный файл: {e}"))
}

async fn save_list(
    path: &str,
    file: &str,
    content: &str,
    expected: &str,
) -> Result<String, String> {
    if matches!(file, "xkeen" | "xray_outbounds" | "xray_routing")
        && !matches!(
            serde_json::from_str::<serde_json::Value>(content),
            Ok(serde_json::Value::Object(_))
        )
    {
        return Err("xkeen.json должен содержать корректный JSON-объект".into());
    }
    let metadata = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|e| format!("Не удалось проверить файл: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_LIST as u64
    {
        return Err("Файл не является обычным файлом размером до 1 MiB".into());
    }
    let current = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if current != expected {
        return Err("Файл на роутере изменился после чтения. Считайте его заново".into());
    }
    let backup_dir = Path::new(BACKUP_DIR);
    ensure_backup_dir(backup_dir).await?;
    let extension = if file == "xkeen" || file.starts_with("xray_") {
        "json"
    } else {
        "lst"
    };
    let backup = unique_file(backup_dir, file, extension);
    tokio::fs::copy(path, &backup)
        .await
        .map_err(|e| format!("Не удалось создать резервную копию: {e}"))?;
    tokio::fs::set_permissions(&backup, fs::Permissions::from_mode(0o600))
        .await
        .map_err(|e| format!("Не удалось защитить резервную копию: {e}"))?;
    let parent = Path::new(path)
        .parent()
        .ok_or("Не удалось определить каталог файла")?;
    let staged = unique_file(parent, file, extension);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(metadata.permissions().mode() & 0o777)
        .open(&staged)
        .await
        .map_err(|e| format!("Не удалось создать временный файл: {e}"))?;
    let write_result = async {
        output.write_all(content.as_bytes()).await?;
        output.sync_all().await
    }
    .await;
    drop(output);
    if let Err(err) = write_result {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось записать файл: {err}"));
    }
    let latest = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Не удалось повторно проверить файл: {e}"))?;
    if latest != expected {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err("Файл на роутере изменился во время записи. Считайте его заново".into());
    }
    if let Err(err) = tokio::fs::rename(&staged, path).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось заменить файл: {err}"));
    }
    Ok(backup.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    content: String,
    expected_content: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidateRequest {
    content: String,
}

pub async fn validate_draft(
    State(state): State<AppState>,
    Json(request): Json<ValidateRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Проверка конфигурации доступна только на роутере",
        );
    }
    if request.content.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "Черновик конфигурации пуст");
    }
    if request.content.len() > MAX_CONFIG {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Черновик конфигурации превышает 4 MiB",
        );
    }
    let _guard = state.core_update_lock.lock().await;
    match validate_content(&request.content).await {
        Ok(()) => Json(serde_json::json!({
            "valid": true,
            "detail": "Черновик прошёл проверку активным Mihomo; конфиг на роутере не изменялся"
        }))
        .into_response(),
        Err(message) => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("Проверка не пройдена; активный конфиг на роутере не изменялся: {message}"),
        ),
    }
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

pub async fn save_active(
    State(state): State<AppState>,
    Json(request): Json<ApplyRequest>,
) -> Response {
    if !state.router_mode {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Сохранение конфигурации доступно только на роутере",
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
    if let Err(message) = crate::dns_control::ensure_dns_config_safe(&request.content).await {
        return error(StatusCode::CONFLICT, &message);
    }
    match save_config_only(&request.content, &request.expected_content).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => error(config_write_error_status(&message), &message),
    }
}

async fn save_config_only(content: &str, expected_content: &str) -> Result<ApplyResult, String> {
    validate_content(content).await.map_err(|message| {
        format!("Mihomo отклонил конфигурацию; активный файл не менялся: {message}")
    })?;
    let meta = tokio::fs::symlink_metadata(CONFIG)
        .await
        .map_err(|e| format!("Не удалось проверить активный конфиг Mihomo: {e}"))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_CONFIG as u64 {
        return Err("Активный конфиг Mihomo не является обычным файлом допустимого размера".into());
    }
    let current = tokio::fs::read_to_string(CONFIG)
        .await
        .map_err(|e| format!("Не удалось прочитать активный конфиг Mihomo: {e}"))?;
    if current != expected_content {
        return Err(
            "Конфиг на роутере изменился после чтения. Считайте его заново перед сохранением"
                .into(),
        );
    }
    let staged = unique_file(Path::new(CONFIG_DIR), "xkeen-ui-save", "yaml");
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(meta.permissions().mode() & 0o777)
        .open(&staged)
        .await
        .map_err(|e| format!("Не удалось создать временный конфиг: {e}"))?;
    let result = async {
        output.write_all(content.as_bytes()).await?;
        output.sync_all().await
    }
    .await;
    drop(output);
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось записать временный конфиг: {e}"));
    }
    let latest = tokio::fs::read_to_string(CONFIG)
        .await
        .map_err(|e| format!("Не удалось повторно проверить активный конфиг: {e}"))?;
    if latest != expected_content {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err("Конфиг на роутере изменился во время записи. Считайте его заново".into());
    }
    let backup_dir = Path::new(BACKUP_DIR);
    if let Err(error) = ensure_backup_dir(backup_dir).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(error);
    }
    let backup = unique_file(backup_dir, "mihomo-config", "yaml");
    if let Err(error) = tokio::fs::copy(CONFIG, &backup).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось создать резервную копию: {error}"));
    }
    if let Err(error) = tokio::fs::set_permissions(&backup, fs::Permissions::from_mode(0o600)).await
    {
        let _ = tokio::fs::remove_file(&backup).await;
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось защитить резервную копию: {error}"));
    }
    tokio::fs::rename(&staged, CONFIG).await.map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!(
            "Не удалось сохранить конфиг; бэкап: {}: {e}",
            backup.display()
        )
    })?;
    Ok(ApplyResult {
        status: "saved",
        path: CONFIG,
        backup: backup.to_string_lossy().into_owned(),
        restarted: false,
        detail:
            "Конфигурация проверена Mihomo и сохранена с резервной копией; ядро не перезапускалось"
                .into(),
    })
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
    if let Err(message) = crate::dns_control::ensure_dns_config_safe(&request.content).await {
        return error(StatusCode::CONFLICT, &message);
    }
    match apply(&request.content, &request.expected_content).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => error(config_write_error_status(&message), &message),
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
    if let Err(error) = ensure_backup_dir(backup_dir).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(error);
    }
    let backup = unique_file(backup_dir, "mihomo-config", "yaml");
    if let Err(error) = tokio::fs::copy(CONFIG, &backup).await {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!(
            "Не удалось создать резервную копию; конфиг не менялся: {error}"
        ));
    }
    if let Err(e) = tokio::fs::set_permissions(&backup, fs::Permissions::from_mode(0o600)).await {
        let _ = tokio::fs::remove_file(&backup).await;
        let _ = tokio::fs::remove_file(&staged).await;
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

async fn validate_content(content: &str) -> Result<(), String> {
    let directory = Path::new(CONFIG_DIR);
    let metadata = tokio::fs::symlink_metadata(directory)
        .await
        .map_err(|error| format!("Не удалось проверить каталог Mihomo: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Каталог Mihomo не является обычным каталогом".into());
    }
    let core = ["/opt/sbin/mihomo", "/opt/bin/mihomo"]
        .into_iter()
        .find(|path| {
            fs::metadata(path)
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| "Исполняемый Mihomo не найден в /opt/sbin или /opt/bin".to_owned())?;
    let staged = unique_file(directory, "xkeen-ui-validate", "yaml");
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staged)
        .await
        .map_err(|error| format!("Не удалось создать временный файл для проверки: {error}"))?;
    let written = async {
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await
    }
    .await;
    drop(file);
    let validation = match written {
        Ok(()) => validate_config(core, &staged).await,
        Err(error) => Err(format!("Не удалось записать временный файл: {error}")),
    };
    let cleanup = tokio::fs::remove_file(&staged).await;
    match (validation, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), _) => Err(error),
        (Ok(()), Err(error)) => Err(format!(
            "Проверка прошла, но временный файл не удалён: {error}"
        )),
    }
}

pub(crate) async fn apply_managed_config(
    content: &str,
    expected_content: &str,
) -> Result<String, String> {
    if content.is_empty() || content.len() > MAX_CONFIG || expected_content.len() > MAX_CONFIG {
        return Err("Текущий конфиг и новый вариант должны быть не больше 4 MiB".into());
    }
    apply(content, expected_content)
        .await
        .map(|result| result.backup)
}

pub(crate) async fn validate_managed_config(content: &str) -> Result<(), String> {
    if content.is_empty() || content.len() > MAX_CONFIG {
        return Err("Конфиг должен быть не больше 4 MiB".into());
    }
    let staged = unique_file(Path::new(CONFIG_DIR), "xkeen-ui-dns-check", "yaml");
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staged)
        .await
        .map_err(|e| format!("Не удалось создать файл проверки DNS: {e}"))?;
    let result = async {
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&staged).await;
        return Err(format!("Не удалось записать файл проверки DNS: {e}"));
    }
    let core = ["/opt/sbin/mihomo", "/opt/bin/mihomo"]
        .into_iter()
        .find(|path| {
            fs::metadata(path)
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .ok_or_else(|| "Исполняемый Mihomo не найден в /opt/sbin или /opt/bin".to_owned());
    let validation = match core {
        Ok(core) => validate_config(core, &staged).await,
        Err(error) => Err(error),
    };
    let _ = tokio::fs::remove_file(&staged).await;
    validation
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
    Err(validation_detail(
        &output.status.to_string(),
        &output.stderr,
        &output.stdout,
    ))
}

fn validation_detail(status: &str, stderr: &[u8], stdout: &[u8]) -> String {
    let details = [stderr, stdout]
        .into_iter()
        .map(String::from_utf8_lossy)
        .flat_map(|text| {
            text.lines()
                .map(crate::logs::sanitize_line)
                .collect::<Vec<_>>()
        })
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if details.is_empty() {
        return format!("код завершения {status}; Mihomo не вернул диагностический текст");
    }
    let bounded = details.chars().take(1024).collect::<String>();
    format!("код завершения {status}: {bounded}")
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

fn config_write_error_status(message: &str) -> StatusCode {
    if message.starts_with("Конфиг на роутере изменился") {
        StatusCode::CONFLICT
    } else if message.starts_with("Mihomo отклонил конфигурацию") {
        StatusCode::UNPROCESSABLE_ENTITY
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

#[cfg(test)]
mod tests {
    use super::{
        config_write_error_status, is_mihomo_backup_id, unique_file, user_file_path,
        validation_detail, ApplyRequest,
    };
    use axum::http::StatusCode;
    use std::path::Path;

    #[test]
    fn backup_ids_only_accept_generated_mihomo_yaml_names() {
        assert!(is_mihomo_backup_id(".mihomo-config-3608-1792253130778141508.yaml"));
        for unsafe_id in [
            "../config.yaml",
            ".mihomo-config-1-2.yaml/../../config.yaml",
            ".mihomo-config-1-2.yml",
            "mihomo-config-1-2.yaml",
            ".mihomo-config-x-2.yaml",
            ".mihomo-config-1-2.yaml\n",
        ] {
            assert!(!is_mihomo_backup_id(unsafe_id), "accepted {unsafe_id:?}");
        }
    }

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
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".yaml"));
    }

    #[test]
    fn user_lists_resolve_only_to_fixed_xkeen_paths() {
        assert_eq!(
            user_file_path("ip_exclude"),
            Some("/opt/etc/xkeen/ip_exclude.lst")
        );
        assert_eq!(
            user_file_path("port_exclude"),
            Some("/opt/etc/xkeen/port_exclude.lst")
        );
        assert_eq!(
            user_file_path("port_proxying"),
            Some("/opt/etc/xkeen/port_proxying.lst")
        );
        assert_eq!(user_file_path("xkeen"), Some("/opt/etc/xkeen/xkeen.json"));
        assert_eq!(
            user_file_path("xray_outbounds"),
            Some("/opt/etc/xray/configs/04_outbounds.json")
        );
        assert_eq!(
            user_file_path("xray_routing"),
            Some("/opt/etc/xray/configs/05_routing.json")
        );
        assert_eq!(user_file_path("../config.yaml"), None);
    }

    #[test]
    fn accepts_frontend_camel_case_expected_content_for_config_writes() {
        let parsed =
            serde_json::from_str::<ApplyRequest>(r#"{"content":"new","expectedContent":"old"}"#);
        assert!(
            parsed.is_ok(),
            "frontend sends expectedContent in camel case"
        );
    }

    #[test]
    fn keeps_mihomo_diagnostics_from_both_output_streams() {
        let result = validation_detail("exit status: 1", b"stderr detail\n", b"stdout detail\n");
        assert!(result.contains("код завершения exit status: 1"));
        assert!(result.contains("stderr detail\nstdout detail"));
    }

    #[test]
    fn uses_stdout_when_mihomo_writes_no_stderr() {
        let result = validation_detail("exit status: 1", b"", b"invalid rule at line 42\n");
        assert!(result.contains("invalid rule at line 42"));
    }

    #[test]
    fn reports_exit_status_when_mihomo_emits_no_diagnostic() {
        let result = validation_detail("exit status: 2", b"", b"");
        assert_eq!(
            result,
            "код завершения exit status: 2; Mihomo не вернул диагностический текст"
        );
    }

    #[test]
    fn maps_only_mihomo_validation_rejections_to_unprocessable_entity() {
        assert_eq!(
            config_write_error_status("Mihomo отклонил конфигурацию: invalid field"),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            config_write_error_status("Конфиг на роутере изменился после чтения"),
            StatusCode::CONFLICT
        );
        assert_eq!(
            config_write_error_status("Не удалось создать резервную копию: disk full"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
