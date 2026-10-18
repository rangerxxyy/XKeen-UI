use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use http_body_util::{BodyExt, Empty};
use hyper::{body::Bytes, Request};
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
use serde_json::Value;
use std::time::Duration;

const XKEEN_CONFIG: &str = "/opt/etc/xkeen/xkeen.json";
const SYSTEM_RCI_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_SYSTEM_RCI_BODY: usize = 64 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    pub used_mb: u64,
    pub total_mb: u64,
}

fn rci_token(config: &str) -> Option<String> {
    serde_json::from_str::<Value>(config)
        .ok()?
        .get("xkeen")?
        .get("rci_token")?
        .as_str()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_system_memory(data: &Value) -> Option<MemoryStatus> {
    let total_kb = data.get("memtotal")?.as_u64()?;
    let used_kb = data
        .get("memory")?
        .as_str()?
        .split_once('/')?
        .0
        .trim()
        .parse::<u64>()?;
    if total_kb == 0 || used_kb > total_kb {
        return None;
    }
    Some(MemoryStatus {
        used_mb: used_kb / 1024,
        total_mb: total_kb / 1024,
    })
}

pub async fn read_system_memory() -> Option<MemoryStatus> {
    let config = tokio::fs::read_to_string(XKEEN_CONFIG).await.ok()?;
    let mut connector = HttpConnector::new();
    connector.set_connect_timeout(Some(Duration::from_secs(1)));
    let client: Client<_, Empty<Bytes>> = Client::builder(TokioExecutor::new()).build(connector);
    let mut request = Request::builder().uri("http://127.0.0.1:79/rci/show/system");
    if let Some(token) = rci_token(&config) {
        request = request.header("X-Ndma-Tkn", token);
    }
    let request = request.body(Empty::new()).ok()?;

    tokio::time::timeout(SYSTEM_RCI_TIMEOUT, async move {
        let response = client.request(request).await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let mut body = response.into_body();
        let mut bytes = Vec::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.ok()?;
            if let Ok(data) = frame.into_data() {
                if bytes.len().saturating_add(data.len()) > MAX_SYSTEM_RCI_BODY {
                    return None;
                }
                bytes.extend_from_slice(&data);
            }
        }
        let payload = serde_json::from_slice::<Value>(&bytes).ok()?;
        parse_system_memory(&payload)
    })
    .await
    .ok()
    .flatten()
}

pub async fn devices(State(state): State<AppState>) -> impl IntoResponse {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(
                serde_json::json!({ "error": "Список устройств доступен только в режиме роутера" }),
            ),
        )
            .into_response();
    }

    let config = tokio::fs::read_to_string(XKEEN_CONFIG)
        .await
        .unwrap_or_default();
    let mut connector = HttpConnector::new();
    connector.set_connect_timeout(Some(std::time::Duration::from_secs(3)));
    let client: Client<_, Empty<Bytes>> = Client::builder(TokioExecutor::new()).build(connector);
    let mut request = Request::builder().uri("http://127.0.0.1:79/rci/show/device-list");
    if let Some(token) = rci_token(&config) {
        request = request.header("X-Ndma-Tkn", token);
    }
    let request = match request.body(Empty::new()) {
        Ok(request) => request,
        Err(error) => return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Не удалось подготовить запрос KeeneticOS RCI: {error}") })),
        ).into_response(),
    };
    let response = match tokio::time::timeout(std::time::Duration::from_secs(5), client.request(request)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("Не удалось получить список устройств KeeneticOS: {error}") })),
        ).into_response(),
        Err(_) => return (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Запрос списка устройств KeeneticOS превысил 5 секунд" })),
        ).into_response(),
    };
    if !response.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("KeeneticOS RCI вернул HTTP {}", response.status()) })),
        ).into_response();
    }
    let body = match tokio::time::timeout(std::time::Duration::from_secs(5), response.into_body().collect()).await {
        Ok(Ok(body)) => {
            let bytes = body.to_bytes();
            if bytes.len() > 1024 * 1024 {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": "Список устройств KeeneticOS превышает 1 MiB" })),
                ).into_response();
            }
            bytes
        }
        Ok(Err(error)) => return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("Не удалось прочитать список устройств KeeneticOS: {error}") })),
        ).into_response(),
        Err(_) => return (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({ "error": "Чтение списка устройств KeeneticOS превысило 5 секунд" })),
        ).into_response(),
    };
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(payload) => payload,
        Err(error) => return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("Некорректный ответ списка устройств KeeneticOS: {error}") })),
        ).into_response(),
    };
    let hosts = payload
        .get("host")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Json(serde_json::json!({ "host": hosts })).into_response()
}

#[cfg(test)]
mod tests {
    use super::{parse_system_memory, rci_token};
    use serde_json::json;

    #[test]
    fn parses_rci_memory_in_kib_and_reports_nominal_total_megabytes() {
        let memory = parse_system_memory(&json!({
            "memtotal": 524288,
            "memory": "123456/524288"
        }))
        .expect("complete RCI memory metrics");

        assert_eq!(memory.used_mb, 120);
        assert_eq!(memory.total_mb, 512);
    }

    #[test]
    fn rejects_incomplete_or_inconsistent_rci_memory_metrics() {
        assert!(parse_system_memory(&json!({ "memtotal": 524288 })).is_none());
        assert!(parse_system_memory(&json!({
            "memtotal": 524288,
            "memory": "524289/524288"
        }))
        .is_none());
        assert!(parse_system_memory(&json!({
            "memtotal": "524288",
            "memory": "123456/524288"
        }))
        .is_none());
    }

    #[test]
    fn reads_rci_token_from_xkeen_configuration_without_exposing_other_fields() {
        assert_eq!(
            rci_token(r#"{"xkeen":{"rci_token":"secret-token"}}"#).as_deref(),
            Some("secret-token")
        );
        assert_eq!(rci_token(r#"{"xkeen":{"rci_token":"  "}}"#), None);
        assert_eq!(rci_token("not json"), None);
    }
}
