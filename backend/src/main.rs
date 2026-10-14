use std::{
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    time::Instant,
};

use axum::{
    extract::State,
    http::{header::AUTHORIZATION, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::{info, warn};

mod mihomo;
use mihomo::{Endpoint as MihomoEndpoint, MihomoClient, MihomoError};

#[derive(Clone)]
struct AppState {
    started: Instant,
    port: u16,
    router_mode: bool,
    access_token: Option<String>,
    platform: String,
    mihomo: MihomoClient,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

#[derive(Serialize)]
struct ServiceStatus {
    name: &'static str,
    state: &'static str,
    version: Option<String>,
    detail: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemStatus {
    app_version: &'static str,
    mode: &'static str,
    port: u16,
    uptime_seconds: u64,
    platform: String,
    memory: Option<MemoryStatus>,
    load_average: Option<f32>,
    services: Vec<ServiceStatus>,
    notice: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryStatus {
    used_mb: u64,
    total_mb: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProxySelection {
    group: String,
    name: String,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

async fn status(State(state): State<AppState>) -> Json<SystemStatus> {
    let services = ["Xkeen", "Xray", "Mihomo"]
        .into_iter()
        .map(|name| {
            if state.router_mode {
                match process_is_running(name) {
                    Some(true) => ServiceStatus {
                        name,
                        state: "running",
                        version: None,
                        detail: "Процесс обнаружен; версия ядра пока не запрошена",
                    },
                    Some(false) => ServiceStatus {
                        name,
                        state: "stopped",
                        version: None,
                        detail: "Процесс не обнаружен",
                    },
                    None => ServiceStatus {
                        name,
                        state: "unavailable",
                        version: None,
                        detail: "Проверка процессов доступна только на Linux",
                    },
                }
            } else {
                ServiceStatus {
                    name,
                    state: "unknown",
                    version: None,
                    detail: "Локальный режим не обращается к процессам и настройкам роутера",
                }
            }
        })
        .collect();

    Json(SystemStatus {
        app_version: env!("CARGO_PKG_VERSION"),
        mode: if state.router_mode {
            "router"
        } else {
            "simulation"
        },
        port: state.port,
        uptime_seconds: state.started.elapsed().as_secs(),
        platform: state.platform.clone(),
        memory: state.router_mode.then(read_memory_status).flatten(),
        load_average: state
            .router_mode
            .then(|| {
                std::fs::read_to_string("/proc/loadavg")
                    .ok()
                    .and_then(|contents| parse_load_average(&contents))
            })
            .flatten(),
        services,
        notice: if state.router_mode {
            "Режим устройства: отображаются только состояния обнаруженных процессов. Управляющие операции в этой версии отключены."
        } else {
            "Изоляция активна: реальные системные службы, DNS, маршруты и настройки устройства не изменяются."
        },
    })
}

async fn mihomo_data(State(state): State<AppState>, endpoint: MihomoEndpoint) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Mihomo API недоступен в режиме симуляции"})),
        )
            .into_response();
    }

    match state.mihomo.get_json(endpoint).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => mihomo_error_response(error),
    }
}

async fn mihomo_version(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::Version).await
}

async fn mihomo_proxies(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::Proxies).await
}

async fn mihomo_connections(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::Connections).await
}

async fn mihomo_rules(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::Rules).await
}

async fn select_mihomo_proxy(
    State(state): State<AppState>,
    Json(selection): Json<ProxySelection>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Mihomo API недоступен в режиме симуляции"})),
        )
            .into_response();
    }
    match state
        .mihomo
        .select_proxy(&selection.group, &selection.name)
        .await
    {
        Ok(()) => Json(serde_json::json!({"status":"selected"})).into_response(),
        Err(error) => mihomo_error_response(error),
    }
}

fn mihomo_error_response(error: MihomoError) -> Response {
    let (status, message) = match error {
        MihomoError::Request(_) => (StatusCode::BAD_GATEWAY, "Не удалось связаться с Mihomo API"),
        MihomoError::Body(_) => (
            StatusCode::BAD_GATEWAY,
            "Не удалось прочитать ответ Mihomo API",
        ),
        MihomoError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "Mihomo API не ответил вовремя"),
        MihomoError::UpstreamStatus(401 | 403) => (
            StatusCode::BAD_GATEWAY,
            "Mihomo API отклонил доступ; проверьте локальную настройку секрета",
        ),
        MihomoError::UpstreamStatus(_) => (StatusCode::BAD_GATEWAY, "Mihomo API вернул ошибку"),
        MihomoError::ResponseTooLarge => {
            (StatusCode::BAD_GATEWAY, "Ответ Mihomo API слишком большой")
        }
        MihomoError::InvalidJson(_) => (
            StatusCode::BAD_GATEWAY,
            "Mihomo API вернул некорректный JSON",
        ),
        MihomoError::InvalidControllerUrl => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Адрес локального Mihomo API настроен некорректно",
        ),
        MihomoError::InvalidSecret => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Секрет локального Mihomo API имеет некорректный формат",
        ),
        MihomoError::InvalidSelection => (
            StatusCode::BAD_REQUEST,
            "Узел не входит в доступную группу Selector",
        ),
    };
    (status, Json(serde_json::json!({"error":message}))).into_response()
}

fn read_memory_status() -> Option<MemoryStatus> {
    let contents = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb = None;
    let mut available_kb = None;
    for line in contents.lines() {
        let mut parts = line.split_whitespace();
        match parts.next()? {
            "MemTotal:" => total_kb = parts.next()?.parse::<u64>().ok(),
            "MemAvailable:" => available_kb = parts.next()?.parse::<u64>().ok(),
            _ => {}
        }
    }
    let total = total_kb?;
    let available = available_kb?.min(total);
    Some(MemoryStatus {
        used_mb: (total - available) / 1024,
        total_mb: total / 1024,
    })
}

fn parse_load_average(contents: &str) -> Option<f32> {
    contents
        .split_whitespace()
        .next()?
        .parse::<f32>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

async fn require_access_token(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let Some(expected) = state.access_token.as_deref() else {
        return next.run(request).await;
    };
    let supplied = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if supplied.is_some_and(|value| constant_time_equals(value.as_bytes(), expected.as_bytes())) {
        next.run(request).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"access token required"})),
        )
            .into_response()
    }
}

fn constant_time_equals(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

fn process_is_running(service: &str) -> Option<bool> {
    let proc_dir = std::fs::read_dir("/proc").ok()?;
    for entry in proc_dir.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .bytes()
            .all(|b| b.is_ascii_digit())
        {
            continue;
        }
        let comm = std::fs::read_to_string(entry.path().join("comm")).ok();
        if comm
            .as_deref()
            .is_some_and(|value| value.trim() == service.to_lowercase())
        {
            return Some(true);
        }
    }
    Some(false)
}

fn web_root() -> PathBuf {
    env::var_os("XKEEN_WEB_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("web"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "xkeen_ui=info,tower_http=info".into()),
        )
        .with_target(false)
        .init();

    let port = env::var("XKEEN_PORT")
        .ok()
        .map(|value| value.parse::<u16>())
        .transpose()?;
    let port = port.unwrap_or(1001);
    if port == 0 {
        return Err("XKEEN_PORT must be between 1 and 65535".into());
    }

    let router_mode =
        env::var("XKEEN_MODE").is_ok_and(|value| value.eq_ignore_ascii_case("router"));
    if router_mode && !cfg!(target_os = "linux") {
        return Err(
            "XKEEN_MODE=router is supported only on Linux; use simulation mode locally".into(),
        );
    }
    let access_token = env::var("XKEEN_TOKEN")
        .ok()
        .filter(|token| !token.trim().is_empty());
    if router_mode && access_token.is_none() {
        return Err(
            "XKEEN_TOKEN is required in router mode; do not expose an unauthenticated panel".into(),
        );
    }

    let state = AppState {
        started: Instant::now(),
        port,
        router_mode,
        access_token,
        platform: format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH),
        mihomo: MihomoClient::from_env().map_err(|_| "invalid XKEEN_MIHOMO_URL")?,
    };
    let web = web_root();
    let index = web.join("index.html");
    let protected_api = Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/mihomo/version", get(mihomo_version))
        .route("/api/v1/mihomo/proxies", get(mihomo_proxies))
        .route("/api/v1/mihomo/connections", get(mihomo_connections))
        .route("/api/v1/mihomo/rules", get(mihomo_rules))
        .route(
            "/api/v1/mihomo/proxies/select",
            axum::routing::put(select_mihomo_proxy),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_access_token,
        ));
    let app = Router::new()
        .route("/health", get(health))
        .merge(protected_api)
        .fallback_service(ServeDir::new(&web).not_found_service(ServeFile::new(index)))
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let bind_ip = env::var("XKEEN_BIND")
        .unwrap_or_else(|_| "0.0.0.0".to_owned())
        .parse::<IpAddr>()?;
    let address = SocketAddr::new(bind_ip, port);
    let listener = TcpListener::bind(address).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            warn!(port, "binding the requested port was denied");
        }
        error
    })?;
    info!(%address, mode = if router_mode { "router" } else { "simulation" }, "XKeen UI API is listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{constant_time_equals, parse_load_average};

    #[test]
    fn load_average_parser_reads_only_a_finite_first_value() {
        assert_eq!(parse_load_average("0.42 0.38 0.27 1/90 1234"), Some(0.42));
        assert_eq!(parse_load_average("not-a-number 0 0"), None);
        assert_eq!(parse_load_average("NaN 0 0"), None);
        assert_eq!(parse_load_average(""), None);
    }

    #[test]
    fn bearer_token_comparison_accepts_only_exact_bytes() {
        assert!(constant_time_equals(b"abc123", b"abc123"));
        assert!(!constant_time_equals(b"abc123", b"abc124"));
        assert!(!constant_time_equals(b"abc", b"abc123"));
        assert!(!constant_time_equals(b"", b"abc"));
    }

    #[test]
    fn service_process_names_are_normalized() {
        assert_eq!("Mihomo".to_lowercase(), "mihomo");
        assert_eq!("Xray".to_lowercase(), "xray");
    }

    #[test]
    fn port_zero_is_not_a_valid_configured_port() {
        assert_eq!("0".parse::<u16>().ok(), Some(0));
        assert!("1001".parse::<u16>().is_ok_and(|port| port > 0));
        assert!("65536".parse::<u16>().is_err());
    }
}
