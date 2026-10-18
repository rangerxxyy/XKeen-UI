use std::{
    path::Path,
    process::Stdio,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::Path as AxumPath,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tokio::{io::AsyncWriteExt, process::Command};

const CONFIG_PATH: &str = "/opt/etc/mihomo/config.yaml";
const CONFIG_DIR: &str = "/opt/etc/mihomo";
const MAX_RULESET_BYTES: u64 = 10 * 1024 * 1024;

pub async fn get_content(AxumPath(name): AxumPath<String>) -> Response {
    match read_content(&name).await {
        Ok((content, path)) => {
            Json(serde_json::json!({"content": content, "path": path})).into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": error})),
        )
            .into_response(),
    }
}

async fn read_content(name: &str) -> Result<(String, String), String> {
    if name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
        return Err("Некорректное имя rule-set".into());
    }
    let yaml = tokio::fs::read_to_string(CONFIG_PATH)
        .await
        .map_err(|e| format!("Не удалось прочитать конфигурацию Mihomo: {e}"))?;
    let provider = find_provider(&yaml, name)
        .ok_or_else(|| format!("Rule-set «{name}» не найден в конфигурации Mihomo"))?;
    let path = if let Some(path) = provider.get("path") {
        resolve_provider_path(path)
    } else if let Some(url) = provider.get("url") {
        format!("{CONFIG_DIR}/rules/{}", md5_of(url).await?)
    } else {
        return Err(
            "У rule-set нет path или url; встроенные payload не содержат отдельного файла".into(),
        );
    };
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Не удалось найти файл rule-set {path}: {e}"))?;
    if metadata.len() > MAX_RULESET_BYTES {
        return Err("Rule-set больше лимита просмотра 10 МБ".into());
    }
    if path.to_ascii_lowercase().ends_with(".mrs") {
        return convert_mrs(
            &path,
            provider
                .get("behavior")
                .map(String::as_str)
                .unwrap_or("domain"),
        )
        .await
        .map(|content| (content, path.clone()));
    }
    tokio::fs::read_to_string(&path)
        .await
        .map(|content| (content, path.clone()))
        .map_err(|e| format!("Не удалось прочитать файл rule-set {path}: {e}"))
}

fn find_provider(yaml: &str, wanted: &str) -> Option<std::collections::HashMap<String, String>> {
    let mut in_providers = false;
    let mut section_indent = 0usize;
    let mut provider_indent = None;
    let mut found = false;
    let mut values = std::collections::HashMap::new();
    for raw in yaml.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if indent == 0 {
            in_providers = trimmed == "rule-providers:"
                || trimmed.starts_with("rule-providers: #")
                || trimmed.starts_with("rule-providers: &");
            section_indent = indent;
            provider_indent = None;
            continue;
        }
        if !in_providers {
            continue;
        }
        if provider_indent.is_none() {
            provider_indent = Some(indent);
        }
        if Some(indent) == provider_indent {
            let Some((key, value)) = split_yaml_pair(trimmed) else {
                continue;
            };
            let name = unquote(key.trim().trim_end_matches(':'));
            found = name == wanted;
            provider_indent = Some(indent);
            values.clear();
            if !value.is_empty() {
                let inline = value.trim();
                if let Some(entries) = inline
                    .strip_prefix('{')
                    .and_then(|value| value.strip_suffix('}'))
                {
                    for entry in entries.split(',') {
                        if let Some((key, value)) = split_yaml_pair(entry.trim()) {
                            let key = key.trim();
                            if key != "<<" {
                                values.insert(key.to_owned(), unquote(value.trim()).to_owned());
                            }
                        }
                    }
                } else {
                    values.insert("payload".into(), value.to_owned());
                }
            }
            continue;
        }
        if found && provider_indent.is_some_and(|base| indent > base && indent > section_indent) {
            if let Some((key, value)) = split_yaml_pair(trimmed) {
                values.insert(key.trim().to_owned(), unquote(value.trim()).to_owned());
            }
        }
    }
    found.then_some(values)
}

fn split_yaml_pair(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((
        key,
        value
            .trim()
            .split_once(" #")
            .map_or(value.trim(), |(value, _)| value),
    ))
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('\'') && value.ends_with('\''))
            || (value.starts_with('"') && value.ends_with('"')))
    {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}

fn resolve_provider_path(path: &str) -> String {
    if Path::new(path).is_absolute() {
        path.to_owned()
    } else {
        format!("{CONFIG_DIR}/{}", path.trim_start_matches("./"))
    }
}

async fn md5_of(value: &str) -> Result<String, String> {
    let mut child = Command::new("md5sum")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!("Не удалось вычислить путь rule-set: утилита md5sum недоступна ({error})")
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(value.as_bytes())
            .await
            .map_err(|e| format!("Ошибка хэширования URL rule-set: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Ошибка вычисления пути rule-set: {e}"))?;
    if !output.status.success() {
        return Err("Не удалось вычислить путь локального кэша rule-set".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .map(str::to_owned)
        .ok_or_else(|| "md5sum вернул пустой путь rule-set".into())
}

async fn convert_mrs(path: &str, behavior: &str) -> Result<String, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let output_path = format!("/tmp/xkeen-ruleset-{}-{nanos:x}.yaml", std::process::id());
    let output = Command::new("/opt/sbin/mihomo")
        .args([
            "convert-ruleset",
            &behavior.to_ascii_lowercase(),
            "mrs",
            path,
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| format!("Не удалось запустить конвертер Mihomo: {e}"))?;
    let result = if output.status.success() {
        match tokio::fs::metadata(&output_path).await {
            Ok(metadata) if metadata.len() > MAX_RULESET_BYTES => {
                Err("Преобразованный rule-set больше лимита просмотра 10 МБ".into())
            }
            Ok(_) => tokio::fs::read_to_string(&output_path)
                .await
                .map_err(|e| format!("Не удалось прочитать результат конвертации: {e}")),
            Err(e) => Err(format!("Не удалось проверить результат конвертации: {e}")),
        }
    } else {
        Err(format!(
            "Mihomo не смог преобразовать MRS: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    };
    let _ = tokio::fs::remove_file(output_path).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_provider_paths_and_behavior_from_config_yaml() {
        let yaml = "rule-providers:\n  local-set:\n    type: http\n    behavior: domain\n    path: ./rules/local.yaml\n    url: https://example.test/rules.yaml\nother:\n  enabled: true\n";
        let provider = find_provider(yaml, "local-set").unwrap();
        assert_eq!(
            provider.get("path").map(String::as_str),
            Some("./rules/local.yaml")
        );
        assert_eq!(provider.get("behavior").map(String::as_str), Some("domain"));
        assert!(find_provider(yaml, "missing").is_none());
    }

    #[test]
    fn finds_rule_provider_when_config_has_utf8_bom_and_inline_mapping() {
        let yaml = "\u{feff}rule-providers:\n  category-ai@domain: { <<: *domain, url: https://example.test/category-ai.mrs }\n";
        let provider = find_provider(yaml, "category-ai@domain");
        assert!(
            provider.is_some(),
            "the active provider name must match the runtime API name"
        );
        assert_eq!(
            provider.unwrap().get("url").map(String::as_str),
            Some("https://example.test/category-ai.mrs")
        );
    }

    #[test]
    fn finds_provider_with_valid_four_space_yaml_indentation() {
        let yaml = "rule-providers:\n    adlist@domain: { <<: *domain, url: https://example.test/adlist.mrs }\n";
        assert!(find_provider(yaml, "adlist@domain").is_some());
    }

    #[test]
    fn finds_rule_providers_in_the_bundled_zxc_style_configuration() {
        let yaml = include_str!("../../src/templates/zxc-rv/mihomo/config.yaml");
        for name in ["adlist@domain", "category-ai@domain", "telegram@ipcidr"] {
            assert!(
                find_provider(yaml, name).is_some(),
                "missing provider {name}"
            );
        }
    }

    #[test]
    fn resolves_relative_and_absolute_rule_paths() {
        assert_eq!(
            resolve_provider_path("./rules/local.yaml"),
            "/opt/etc/mihomo/rules/local.yaml"
        );
        assert_eq!(
            resolve_provider_path("/custom/local.yaml"),
            "/custom/local.yaml"
        );
    }
}
