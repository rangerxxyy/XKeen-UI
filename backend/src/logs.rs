use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use std::{io::SeekFrom, os::unix::fs::FileTypeExt, path::Path};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use super::AppState;

const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_LOG_LINES: usize = 1000;

#[derive(Deserialize)]
pub(super) struct LogQuery {
    file: String,
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
        id: "xray-error",
        label: "Xray · error.log",
        path: "/opt/var/log/xray/error.log",
    },
    LogSource {
        id: "xray-access",
        label: "Xray · access.log",
        path: "/opt/var/log/xray/access.log",
    },
    LogSource {
        id: "web-error",
        label: "Web · error.log",
        path: "/opt/var/log/lighttpd/error.log",
    },
    LogSource {
        id: "nfqws2",
        label: "nfqws2.log",
        path: "/opt/var/log/nfqws2.log",
    },
    LogSource {
        id: "xkeen-ui",
        label: "XKeen UI · xkeen-ui.log",
        path: "/opt/var/log/xkeen-ui.log",
    },
];

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
    let Some(source) = LOG_SOURCES.iter().find(|source| source.id == query.file) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"Неизвестный файл журнала"})),
        )
            .into_response();
    };
    match read_tail(source).await {
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

async fn read_tail(source: &LogSource) -> std::io::Result<LogResult> {
    let path = Path::new(source.path);
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

fn sanitize_line(line: &str) -> String {
    let mut clean: String = line
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(4096)
        .collect();
    for key in [
        "password=",
        "token=",
        "secret=",
        "api_key=",
        "privatekey=",
        "authorization:",
        "bearer ",
    ] {
        let lower = clean.to_ascii_lowercase();
        let Some(index) = lower.find(key) else {
            continue;
        };
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
    fn log_source_ids_are_unique_and_absolute() {
        for (index, source) in LOG_SOURCES.iter().enumerate() {
            assert!(source.path.starts_with("/opt/var/log/"));
            assert!(LOG_SOURCES[index + 1..]
                .iter()
                .all(|other| other.id != source.id));
        }
    }
}
