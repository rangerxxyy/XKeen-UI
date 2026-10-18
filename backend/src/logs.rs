use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{SeekFrom, Write},
    os::unix::fs::{FileTypeExt, OpenOptionsExt},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::AppState;

const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_LOG_LINES: usize = 1000;
const MAX_LIFECYCLE_ENTRY_BYTES: usize = 4096;
const MAX_LIFECYCLE_WRITE_BYTES: usize = 16 * 1024;
pub(super) const XKEEN_UI_LOG_PATH: &str = "/opt/var/log/xkeen-ui.log";
const XKEEN_RUNTIME_LOG_PATH: &str = "/opt/var/log/xkeen-detached.log";

#[derive(Deserialize)]
pub(super) struct LogQuery {
    file: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct UiErrorRequest {
    source: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogResult {
    file: &'static str,
    lines: Vec<String>,
    truncated: bool,
}

struct LogSource {
    id: &'static str,
    label: &'static str,
    path: &'static str,
}

const LOG_SOURCES: &[LogSource] = &[
    LogSource {
        id: "xray-access",
        label: "access.log",
        path: "/opt/var/log/xray/access.log",
    },
    LogSource {
        id: "xkeen-ui",
        label: "error.log",
        path: XKEEN_UI_LOG_PATH,
    },
];

const ERROR_LOG_SOURCES: &[LogSource] = &[
    LogSource {
        id: "xkeen-runtime",
        label: "XKeen",
        path: XKEEN_RUNTIME_LOG_PATH,
    },
    LogSource {
        id: "xray-error",
        label: "Xray",
        path: "/opt/var/log/xray/error.log",
    },
    LogSource {
        id: "xkeen-ui",
        label: "XKeen UI",
        path: XKEEN_UI_LOG_PATH,
    },
];

// Kept as an internal updater diagnostic endpoint; it is intentionally absent
// from the user-facing journal selector, which exposes only Access and Error Log.
const UPDATE_LOG_SOURCE: LogSource = LogSource {
    id: "app-update",
    label: "Update diagnostics",
    path: "/opt/var/log/xkeen-ui-update.log",
};

pub(super) async fn read_logs(
    State(state): State<AppState>,
    Query(query): Query<LogQuery>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Чтение системных журналов доступно только в режиме роутера"})),
        )
            .into_response();
    }
    let source = LOG_SOURCES
        .iter()
        .find(|source| source.id == query.file)
        .or_else(|| (query.file == UPDATE_LOG_SOURCE.id).then_some(&UPDATE_LOG_SOURCE));
    let Some(source) = source else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"Неизвестный файл журнала"})),
        )
            .into_response();
    };
    let result = if query.file == "xkeen-ui" {
        read_error_log_bundle().await
    } else {
        read_tail(source).await
    };
    match result {
        Ok(result) => Json(result).into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":"Файл журнала ещё не создан"})),
        )
            .into_response(),
        Err(error) => {
            tracing::warn!(file = source.id, %error, "Could not read requested log file");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error":"Не удалось прочитать файл журнала"})),
            )
                .into_response()
        }
    }
}

pub(super) async fn append_ui_error(
    State(state): State<AppState>,
    axum::Json(request): axum::Json<UiErrorRequest>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Запись в системный журнал доступна только в режиме роутера"})),
        )
            .into_response();
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let Some(entry) = ui_error_entry(timestamp, &request.source, &request.message) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"Некорректное событие журнала"})),
        )
            .into_response();
    };
    if is_legacy_noise_line(&entry) {
        return StatusCode::NO_CONTENT.into_response();
    }
    match append_xkeen_lifecycle(&[entry]) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => {
            tracing::warn!(%error, "Could not append UI error to Error Log");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error":"Не удалось записать событие в Error Log"})),
            )
                .into_response()
        }
    }
}

fn ui_error_entry(timestamp: u64, source: &str, message: &str) -> Option<String> {
    if !matches!(source, "yaml" | "config" | "ui" | "update") {
        return None;
    }
    let message = sanitize_line(message).trim().to_owned();
    if message.is_empty() || message.len() > 2048 {
        return None;
    }
    Some(format!(
        "unix={timestamp} level=ERROR component=xkeen-ui source={source} message={message}"
    ))
}

async fn read_tail(source: &LogSource) -> std::io::Result<LogResult> {
    read_tail_path(source, Path::new(source.path)).await
}

async fn read_tail_path(source: &LogSource, path: &Path) -> std::io::Result<LogResult> {
    let metadata = tokio::fs::symlink_metadata(path).await?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.file_type().is_char_device()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "log path is not a regular file",
        ));
    }
    let mut file = tokio::fs::File::open(path).await?;
    let length = file.metadata().await?.len();
    let start = length.saturating_sub(MAX_LOG_BYTES);
    file.seek(SeekFrom::Start(start)).await?;
    let mut bytes = Vec::with_capacity((length - start) as usize);
    file.take(MAX_LOG_BYTES).read_to_end(&mut bytes).await?;
    let text = String::from_utf8_lossy(&bytes);
    let text = if start > 0 {
        text.split_once('\n').map_or("", |(_, tail)| tail)
    } else {
        text.as_ref()
    };
    let mut lines: Vec<String> = text
        .lines()
        .map(sanitize_line)
        .filter(|line| !line.is_empty())
        .filter(|line| !should_filter_legacy_noise(source.id, line))
        .collect();
    let truncated = lines.len() > MAX_LOG_LINES || start > 0;
    if lines.len() > MAX_LOG_LINES {
        lines.drain(..lines.len() - MAX_LOG_LINES);
    }
    Ok(LogResult {
        file: source.label,
        lines,
        truncated,
    })
}

async fn read_error_log_bundle() -> std::io::Result<LogResult> {
    let mut groups = Vec::new();
    let mut truncated = false;
    for source in ERROR_LOG_SOURCES {
        match read_tail(source).await {
            Ok(result) => {
                truncated |= result.truncated;
                if !result.lines.is_empty() {
                    groups.push((source.label, result.lines));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    if groups.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no runtime error logs exist yet",
        ));
    }
    let mut lines = Vec::new();
    for (label, source_lines) in groups {
        lines.extend(
            source_lines
                .into_iter()
                .map(|line| format!("{line}  [{label}]")),
        );
    }
    if lines.len() > MAX_LOG_LINES {
        lines.drain(..lines.len() - MAX_LOG_LINES);
        truncated = true;
    }
    Ok(LogResult {
        file: "error.log",
        lines,
        truncated,
    })
}

fn is_expected_ui_noise(source: &str, message: &str) -> bool {
    if source != "ui" {
        return false;
    }
    let normalized = message.to_lowercase();
    (normalized.contains("mihomo proxy ping:")
        && normalized.contains("узел не входит в доступную группу selector"))
        || normalized.contains(
            "данные не обновились: mihomo вернул некорректный список соединений",
        )
        || (normalized.contains("clash ws proxy error:")
            && normalized.contains("connection refused"))
}

fn is_legacy_noise_line(line: &str) -> bool {
    let normalized = line.to_lowercase();
    normalized.contains("component=xkeen phase=requested")
        || normalized.contains("component=xkeen phase=completed")
        || (normalized.contains("component=xkeen action=")
            && ((normalized.contains("command=exit-0") && normalized.contains("result=success"))
                || (normalized.contains("command=not-run")
                    && normalized.contains("process_transition=blocked"))))
        || normalized.contains("source=update")
        || normalized.contains("[fatal] received sigterm")
        || (normalized.contains("mihomo proxy ping:")
            && normalized.contains("operation was aborted"))
        || is_expected_ui_noise("ui", line)
}

fn should_filter_legacy_noise(source_id: &str, line: &str) -> bool {
    matches!(source_id, "xkeen-ui" | "xkeen-runtime") && is_legacy_noise_line(line)
}

pub(super) fn append_xkeen_lifecycle(entries: &[String]) -> std::io::Result<()> {
    append_log_file(Path::new(XKEEN_UI_LOG_PATH), entries)
}

pub(super) fn append_log_file(path: &Path, entries: &[String]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "log path has no parent")
    })?;
    let parent_metadata = std::fs::symlink_metadata(parent)?;
    if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "log directory is not a regular directory",
        ));
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "lifecycle log is not a regular file",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let mut contents = String::new();
    for entry in entries {
        for line in entry.lines() {
            if contents.len() >= MAX_LIFECYCLE_WRITE_BYTES {
                break;
            }
            let mut clean = sanitize_line(line);
            if clean.len() > MAX_LIFECYCLE_ENTRY_BYTES {
                let mut end = MAX_LIFECYCLE_ENTRY_BYTES;
                while !clean.is_char_boundary(end) {
                    end -= 1;
                }
                clean.truncate(end);
            }
            contents.push_str(&clean);
            contents.push('\n');
        }
    }
    if contents.is_empty() {
        return Ok(());
    }
    if contents.len() > MAX_LIFECYCLE_WRITE_BYTES {
        let mut end = MAX_LIFECYCLE_WRITE_BYTES;
        while !contents.is_char_boundary(end) {
            end -= 1;
        }
        contents.truncate(end);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .write(true)
        .mode(0o600)
        .custom_flags(0x20000) // Linux O_NOFOLLOW
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "lifecycle log is not a regular file",
        ));
    }
    file.write_all(contents.as_bytes())?;
    file.sync_data()
}

pub(super) fn sanitize_line(line: &str) -> String {
    let line = strip_ansi_sequences(line);
    let mut clean: String = line
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(4096)
        .collect();
    for key in [
        "password=",
        "password:",
        "token=",
        "token:",
        "secret=",
        "secret:",
        "api_key=",
        "api_key:",
        "api-key=",
        "privatekey=",
        "authorization:",
        "bearer ",
    ] {
        let mut search_start = 0;
        loop {
            let lower = clean.to_ascii_lowercase();
            let Some(offset) = lower[search_start..].find(key) else {
                break;
            };
            let index = search_start + offset;
            let value_start = index + key.len();
            let mut token_start = value_start;
            while clean
                .as_bytes()
                .get(token_start)
                .is_some_and(u8::is_ascii_whitespace)
            {
                token_start += 1;
            }
            if key == "authorization:" {
                let scheme_end = clean[token_start..]
                    .find(char::is_whitespace)
                    .map_or(clean.len(), |offset| token_start + offset);
                if matches!(
                    clean[token_start..scheme_end].to_ascii_lowercase().as_str(),
                    "bearer" | "basic"
                ) {
                    token_start = scheme_end;
                    while clean
                        .as_bytes()
                        .get(token_start)
                        .is_some_and(u8::is_ascii_whitespace)
                    {
                        token_start += 1;
                    }
                }
            }
            let value_end = clean[token_start..]
                .find(char::is_whitespace)
                .map_or(clean.len(), |offset| token_start + offset);
            clean.replace_range(value_start..value_end, "[REDACTED]");
            search_start = value_start + "[REDACTED]".len();
        }
    }
    clean
}

fn strip_ansi_sequences(line: &str) -> String {
    let mut clean = String::with_capacity(line.len());
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{001b}' {
            clean.push(character);
            continue;
        }
        if characters.peek() == Some(&'[') {
            characters.next();
            for sequence_character in characters.by_ref() {
                if ('@'..='~').contains(&sequence_character) {
                    break;
                }
            }
        }
    }
    clean
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_inline_secrets_and_removes_controls() {
        assert_eq!(
            sanitize_line(
                "url password=hunter2 token=abc Authorization: Bearer private\tok\u{0007}"
            ),
            "url password=[REDACTED] token=[REDACTED] Authorization:[REDACTED]\tok"
        );
    }

    #[test]
    fn redacts_every_occurrence_of_each_inline_secret() {
        let line = "token=first token=second TOKEN=third password=one password=two Authorization: Bearer alpha Authorization: Basic beta";
        let expected = "token=[REDACTED] token=[REDACTED] TOKEN=[REDACTED] password=[REDACTED] password=[REDACTED] Authorization:[REDACTED] Authorization:[REDACTED]";
        assert_eq!(sanitize_line(line), expected);
        assert_eq!(sanitize_line(&sanitize_line(line)), expected);
    }

    #[test]
    fn strips_ansi_color_codes_from_runtime_log_lines() {
        assert_eq!(
            sanitize_line("Прокси-клиент \u{001b}[91mостановлен\u{001b}[0m"),
            "Прокси-клиент остановлен"
        );
    }

    #[test]
    fn log_source_ids_are_unique_and_absolute() {
        assert_eq!(LOG_SOURCES.len(), 2);
        assert_eq!(LOG_SOURCES[0].label, "access.log");
        assert_eq!(LOG_SOURCES[1].label, "error.log");
        for (index, source) in LOG_SOURCES.iter().enumerate() {
            assert!(source.path.starts_with("/opt/var/log/"));
            assert!(LOG_SOURCES[index + 1..]
                .iter()
                .all(|other| other.id != source.id));
        }
    }

    #[test]
    fn error_log_uses_real_xkeen_xray_and_ui_error_sources() {
        assert_eq!(ERROR_LOG_SOURCES.len(), 3);
        assert_eq!(ERROR_LOG_SOURCES[0].path, "/opt/var/log/xkeen-detached.log");
        assert_eq!(ERROR_LOG_SOURCES[1].path, "/opt/var/log/xray/error.log");
        assert_eq!(ERROR_LOG_SOURCES[2].path, XKEEN_UI_LOG_PATH);
    }

    #[tokio::test]
    async fn reads_persisted_hybrid_lifecycle_output_without_filtering_it() {
        let directory =
            std::env::temp_dir().join(format!("xkeen-ui-hybrid-log-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("xkeen-ui.log");
        append_log_file(
            &path,
            &["unix=1792230000 Прокси-клиент запущен в режиме Hybrid".to_owned()],
        )
        .unwrap();
        // read_tail accepts the same source id used by the aggregated Error Log.
        let source = LogSource {
            id: "xkeen-ui",
            label: "XKeen UI",
            path: "",
        };
        let result = read_tail_path(&source, &path).await.unwrap();
        assert_eq!(
            result.lines,
            vec!["unix=1792230000 Прокси-клиент запущен в режиме Hybrid"]
        );
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(directory);
    }

    #[test]
    fn ui_error_entries_are_whitelisted_bounded_and_sanitized() {
        assert_eq!(
            ui_error_entry(42, "yaml", "Ошибка YAML token=private\nsecond line"),
            Some("unix=42 level=ERROR component=xkeen-ui source=yaml message=Ошибка YAML token=[REDACTED] line".to_owned())
        );
        assert!(ui_error_entry(42, "unknown", "message").is_none());
        assert!(ui_error_entry(42, "yaml", "  ").is_none());
        assert!(ui_error_entry(42, "yaml", &"x".repeat(2049)).is_none());
    }

    #[test]
    fn suppresses_expected_repeated_ui_polling_noise() {
        assert!(is_expected_ui_noise(
            "ui",
            "Mihomo proxy ping: Проверка узла: Узел не входит в доступную группу Selector (HTTP 400)"
        ));
        assert!(is_expected_ui_noise(
            "ui",
            "Clash WS proxy error: IO error: Connection refused (os error 111)"
        ));
        assert!(is_expected_ui_noise(
            "ui",
            "Данные не обновились: Mihomo вернул некорректный список соединений"
        ));
        assert!(!is_expected_ui_noise(
            "yaml",
            "Mihomo proxy ping: Узел не входит в доступную группу Selector"
        ));
        assert!(!is_expected_ui_noise("ui", "DNS lookup failed"));
        assert!(is_legacy_noise_line(
            "unix=42 level=ERROR component=xkeen-ui source=ui message=Clash WS proxy error: Connection refused (os error 111)"
        ));
        assert!(is_legacy_noise_line(
            "unix=42 component=xkeen phase=completed action=restart result=success"
        ));
        assert!(is_legacy_noise_line(
            "16.10.2026, 17:59:44 component=xkeen action=restart command=exit-0 running_before=true running_after=true process_transition=verified result=success"
        ));
        assert!(is_legacy_noise_line(
            "16.10.2026, 18:48:21 component=xkeen action=restart command=exit-0 running_before=true running_after=true process_transition=verified result=success"
        ));
        assert!(is_legacy_noise_line(
            "16.10.2026, 18:48:53 component=xkeen action=stop command=not-run process_transition=blocked result=blocked error=DNS Override"
        ));
        assert!(is_legacy_noise_line(
            "unix=42 level=ERROR component=xkeen-ui source=update message=installer exited with code 1"
        ));
        assert!(is_legacy_noise_line(
            "unix=42 level=ERROR component=xkeen-ui source=ui message=Mihomo proxy ping: The operation was aborted."
        ));
        assert!(is_legacy_noise_line("[FATAL] received SIGTERM"));
        assert!(should_filter_legacy_noise(
            "xkeen-runtime",
            "[FATAL] received SIGTERM"
        ));
        assert!(!should_filter_legacy_noise(
            "xray-access",
            "[FATAL] received SIGTERM"
        ));
        assert!(!is_legacy_noise_line(
            "unix=42 level=ERROR component=xkeen-ui source=yaml message=Ошибка YAML"
        ));
    }

    #[test]
    fn appends_bounded_lifecycle_entries_after_redacting_secrets() {
        let directory = std::env::temp_dir().join(format!("xkeen-ui-log-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("xkeen-ui.log");
        append_log_file(&path, &["XKeen restart token=private".to_owned()]).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "XKeen restart token=[REDACTED]\n");
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(directory);
    }

    #[test]
    fn refuses_a_symlink_log_target() {
        let directory =
            std::env::temp_dir().join(format!("xkeen-ui-symlink-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let target = directory.join("target.log");
        let link = directory.join("link.log");
        std::fs::write(&target, "leave alone\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(unix)]
        assert!(append_log_file(&link, &["new line".to_owned()]).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "leave alone\n");
        let _ = std::fs::remove_file(link);
        let _ = std::fs::remove_file(target);
        let _ = std::fs::remove_dir(directory);
    }

    #[test]
    fn caps_a_lifecycle_log_write() {
        let directory =
            std::env::temp_dir().join(format!("xkeen-ui-log-cap-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("xkeen-ui.log");
        let entries = vec!["x".repeat(MAX_LIFECYCLE_ENTRY_BYTES); 8];
        append_log_file(&path, &entries).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            MAX_LIFECYCLE_WRITE_BYTES as u64
        );
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(directory);
    }
}
