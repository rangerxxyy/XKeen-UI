use crate::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use http_body_util::{BodyExt, Empty};
use hyper::{body::Bytes, Request};
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
use serde_json::Value;

const XKEEN_CONFIG: &str = "/opt/etc/xkeen/xkeen.json";

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
    use super::rci_token;

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
