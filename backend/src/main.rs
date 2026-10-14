use std::{
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Instant,
};

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{any, get},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::{info, warn};

mod core_update;
mod installer;
mod logs;
mod mihomo;
mod xkeen;
use mihomo::{Endpoint as MihomoEndpoint, MihomoClient, MihomoError};

#[derive(Clone)]
struct AppState {
    started: Instant,
    port: u16,
    router_mode: bool,
    platform: String,
    mihomo: MihomoClient,
    core_sources: Arc<RwLock<CoreSources>>,
    core_sources_path: Option<PathBuf>,
    core_sources_lock: Arc<tokio::sync::Mutex<()>>,
    core_update_lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CoreSources {
    xray: String,
    mihomo: String,
}

impl Default for CoreSources {
    fn default() -> Self {
        Self {
            xray: "https://github.com/XTLS/Xray-core".into(),
            mihomo: "https://github.com/MetaCubeX/mihomo".into(),
        }
    }
}

impl CoreSources {
    fn normalize(&mut self) -> Result<(), &'static str> {
        self.xray =
            normalize_github_repo(&self.xray).ok_or("Некорректный GitHub-репозиторий Xray")?;
        self.mihomo =
            normalize_github_repo(&self.mihomo).ok_or("Некорректный GitHub-репозиторий Mihomo")?;
        Ok(())
    }
}

fn normalize_github_repo(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("github.com/") {
        format!("https://{trimmed}")
    } else {
        trimmed.to_owned()
    };
    let url = normalized.strip_prefix("https://github.com/")?;
    let path = url
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(url.trim_end_matches('/'));
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if parts.next().is_some() || !valid_github_component(owner) || !valid_github_component(repo) {
        return None;
    }
    Some(format!("https://github.com/{owner}/{repo}"))
}

fn valid_github_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

async fn load_core_sources(
    path: Option<&PathBuf>,
) -> Result<CoreSources, Box<dyn std::error::Error>> {
    let Some(path) = path else {
        return Ok(CoreSources::default());
    };
    match tokio::fs::read(path).await {
        Ok(bytes) => {
            let mut sources: CoreSources = serde_json::from_slice(&bytes)?;
            sources
                .normalize()
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
            Ok(sources)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(CoreSources::default()),
        Err(error) => Err(error.into()),
    }
}

async fn save_core_sources(path: &PathBuf, sources: &CoreSources) -> std::io::Result<()> {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("Нет каталога настроек"))?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = path.with_extension("json.tmp");
    tokio::fs::write(
        &temporary,
        serde_json::to_vec_pretty(sources).map_err(std::io::Error::other)?,
    )
    .await?;
    #[cfg(unix)]
    tokio::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600)).await?;
    tokio::fs::rename(temporary, path).await
}

async fn get_core_sources(State(state): State<AppState>) -> Response {
    match state.core_sources.read() {
        Ok(sources) => Json(sources.clone()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error":"Не удалось прочитать настройки источников"})),
        )
            .into_response(),
    }
}

async fn put_core_sources(
    State(state): State<AppState>,
    Json(mut sources): Json<CoreSources>,
) -> Response {
    if let Err(error) = sources.normalize() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":error})),
        )
            .into_response();
    }
    let _write_guard = state.core_sources_lock.lock().await;
    if let Some(path) = state.core_sources_path.as_ref() {
        if let Err(error) = save_core_sources(path, &sources).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error":format!("Не удалось сохранить настройки: {error}")}),
                ),
            )
                .into_response();
        }
    }
    match state.core_sources.write() {
        Ok(mut current) => {
            *current = sources.clone();
            Json(sources).into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error":"Не удалось обновить настройки источников"})),
        )
            .into_response(),
    }
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

#[derive(Deserialize)]
struct DnsQuery {
    name: String,
    #[serde(rename = "type")]
    record_type: String,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

async fn api_not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": "API endpoint not found" })),
    )
}

async fn xkeen_status(State(state): State<AppState>) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Управление XKeen недоступно в режиме симуляции"})),
        )
            .into_response();
    }
    Json(xkeen::read_status()).into_response()
}

async fn control_xkeen(
    State(state): State<AppState>,
    Json(request): Json<xkeen::ControlRequest>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Управление XKeen недоступно в режиме симуляции"})),
        )
            .into_response();
    }
    match xkeen::control(&request.action).await {
        Ok(status) => Json(status).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":error})),
        )
            .into_response(),
    }
}

async fn install_core(
    State(state): State<AppState>,
    Json(request): Json<core_update::CoreInstallRequest>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Установка ядер недоступна в режиме симуляции"})),
        )
            .into_response();
    }
    let _update_guard = state.core_update_lock.lock().await;
    match core_update::install(&state, request).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":error})),
        )
            .into_response(),
    }
}

async fn status(State(state): State<AppState>) -> Json<SystemStatus> {
    let services = ["Xkeen", "Xray", "Mihomo"]
        .into_iter()
        .map(|name| {
            if state.router_mode {
                if name == "Xkeen" {
                    let xkeen = xkeen::read_status();
                    let (service_state, detail) = match (xkeen.installed, xkeen.running) {
                        (false, _) => ("unavailable", "Штатный init-файл XKeen не найден"),
                        (true, Some(true)) => ("running", "Настроенное ядро XKeen запущено"),
                        (true, Some(false)) => ("stopped", "Настроенное ядро XKeen остановлено"),
                        (true, None) => ("unknown", "Не удалось определить настроенное ядро XKeen"),
                    };
                    return ServiceStatus {
                        name,
                        state: service_state,
                        version: xkeen.version,
                        detail,
                    };
                }
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
            "Статус ядра XKeen читается из системы; команды управления требуют подтверждения в панели."
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

async fn close_all_mihomo_connections(State(state): State<AppState>) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Закрытие соединений недоступно в режиме симуляции"})),
        )
            .into_response();
    }
    match state.mihomo.close_all_connections().await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => mihomo_error_response(error),
    }
}

async fn close_mihomo_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"Закрытие соединений недоступно в режиме симуляции"})),
        )
            .into_response();
    }
    match state.mihomo.close_connection(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => mihomo_error_response(error),
    }
}

async fn mihomo_rules(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::Rules).await
}

async fn mihomo_proxy_providers(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::ProxyProviders).await
}

async fn mihomo_rule_providers(State(state): State<AppState>) -> Response {
    mihomo_data(State(state), MihomoEndpoint::RuleProviders).await
}

async fn mihomo_dns_query(
    State(state): State<AppState>,
    Query(query): Query<DnsQuery>,
) -> Response {
    if !state.router_mode {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"DNS-запрос Mihomo недоступен в режиме симуляции"})),
        )
            .into_response();
    }
    match state
        .mihomo
        .dns_query(&query.name, &query.record_type)
        .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => mihomo_error_response(error),
    }
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

async fn require_same_origin(request: Request<axum::body::Body>, next: Next) -> Response {
    if same_origin(request.headers()) {
        next.run(request).await
    } else {
        (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"cross-origin request rejected"})),
        )
            .into_response()
    }
}

fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Ok(origin_uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(authority) = origin_uri.authority() else {
        return false;
    };
    matches!(origin_uri.scheme_str(), Some("http" | "https"))
        && !authority.as_str().contains('@')
        && origin_uri
            .path_and_query()
            .is_none_or(|path| path.as_str() == "/")
        && authority.as_str().eq_ignore_ascii_case(host)
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
        MihomoError::InvalidConnectionId => (
            StatusCode::BAD_REQUEST,
            "Соединение больше не активно или его идентификатор некорректен",
        ),
        MihomoError::InvalidDnsQuery => (
            StatusCode::BAD_REQUEST,
            "Домен или тип DNS-записи не прошёл проверку",
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
    let args: Vec<String> = env::args().skip(1).collect();
    if !args.is_empty() {
        installer::dispatch(&args)?;
        return Ok(());
    }
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

    let core_sources_path = router_mode.then(|| {
        env::var_os("XKEEN_CORE_SOURCES_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/opt/etc/xkeen-ui/core-sources.json"))
    });
    let core_sources = load_core_sources(core_sources_path.as_ref()).await?;

    let state = AppState {
        started: Instant::now(),
        port,
        router_mode,
        platform: format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH),
        mihomo: MihomoClient::from_env().map_err(|_| "invalid XKEEN_MIHOMO_URL")?,
        core_sources: Arc::new(RwLock::new(core_sources)),
        core_sources_path,
        core_sources_lock: Arc::new(tokio::sync::Mutex::new(())),
        core_update_lock: Arc::new(tokio::sync::Mutex::new(())),
    };
    let web = web_root();
    let index = web.join("index.html");
    let read_api = Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/xkeen", get(xkeen_status))
        .route("/api/v1/logs", get(logs::read_logs))
        .route("/api/v1/settings/core-sources", get(get_core_sources))
        .route("/api/v1/mihomo/version", get(mihomo_version))
        .route("/api/v1/mihomo/proxies", get(mihomo_proxies))
        .route("/api/v1/mihomo/connections", get(mihomo_connections))
        .route("/api/v1/mihomo/rules", get(mihomo_rules))
        .route(
            "/api/v1/mihomo/providers/proxies",
            get(mihomo_proxy_providers),
        )
        .route("/api/v1/mihomo/providers/rules", get(mihomo_rule_providers))
        .route("/api/v1/mihomo/dns/query", get(mihomo_dns_query));
    let mutation_api = Router::new()
        .route("/api/v1/xkeen/control", axum::routing::post(control_xkeen))
        .route("/api/v1/cores/install", axum::routing::post(install_core))
        .route(
            "/api/v1/settings/core-sources",
            axum::routing::put(put_core_sources),
        )
        .route(
            "/api/v1/mihomo/connections",
            axum::routing::delete(close_all_mihomo_connections),
        )
        .route(
            "/api/v1/mihomo/connections/{id}",
            axum::routing::delete(close_mihomo_connection),
        )
        .route(
            "/api/v1/mihomo/proxies/select",
            axum::routing::put(select_mihomo_proxy),
        )
        .route_layer(middleware::from_fn(require_same_origin));
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/{*path}", any(api_not_found))
        .merge(read_api)
        .merge(mutation_api)
        .fallback_service(ServeDir::new(&web).not_found_service(ServeFile::new(index)))
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let bind_ip = env::var("XKEEN_BIND")
        .unwrap_or_else(|_| "127.0.0.1".to_owned())
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
    use super::{
        load_core_sources, normalize_github_repo, parse_load_average, same_origin,
        save_core_sources, CoreSources,
    };
    use axum::http::{header, HeaderMap, HeaderValue};

    #[test]
    fn load_average_parser_reads_only_a_finite_first_value() {
        assert_eq!(parse_load_average("0.42 0.38 0.27 1/90 1234"), Some(0.42));
        assert_eq!(parse_load_average("not-a-number 0 0"), None);
        assert_eq!(parse_load_average("NaN 0 0"), None);
        assert_eq!(parse_load_average(""), None);
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

    #[test]
    fn core_repository_urls_are_normalized_and_restricted_to_github_repo_roots() {
        assert_eq!(
            normalize_github_repo("github.com/MetaCubeX/mihomo"),
            Some("https://github.com/MetaCubeX/mihomo".into())
        );
        assert_eq!(
            normalize_github_repo("https://github.com/XTLS/Xray-core.git/"),
            Some("https://github.com/XTLS/Xray-core".into())
        );
        assert_eq!(
            normalize_github_repo("https://github.com/owner/repo/releases"),
            None
        );
        assert_eq!(
            normalize_github_repo("https://example.com/owner/repo"),
            None
        );
        assert_eq!(
            normalize_github_repo("https://github.com/owner/repo?redirect=evil"),
            None
        );
        assert_eq!(normalize_github_repo("https://github.com/owner"), None);
    }

    #[tokio::test]
    async fn core_sources_round_trip_through_owned_settings_file() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "xkeen-ui-sources-{}-{nonce}.json",
            std::process::id()
        ));
        let mut sources = CoreSources::default();
        sources.xray = "https://github.com/example/xray-fork".into();
        save_core_sources(&path, &sources).await.unwrap();
        let loaded = load_core_sources(Some(&path)).await.unwrap();
        assert_eq!(loaded.xray, sources.xray);
        assert_eq!(loaded.mihomo, sources.mihomo);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn mutations_require_an_exact_same_origin_header() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("192.168.1.1:1001"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://192.168.1.1:1001"),
        );
        assert!(same_origin(&headers));

        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://attacker.example"),
        );
        assert!(!same_origin(&headers));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://192.168.1.1:1002"),
        );
        assert!(!same_origin(&headers));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://user@192.168.1.1:1001"),
        );
        assert!(!same_origin(&headers));
        headers.remove(header::ORIGIN);
        assert!(!same_origin(&headers));
    }
}
