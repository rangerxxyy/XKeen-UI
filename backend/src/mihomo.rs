use std::{env, time::Duration};

use axum::http::header;
use http_body_util::{BodyExt, Full};
use hyper::{body::Bytes, Method, Request, Uri};
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tokio::task::JoinSet;

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

type HttpClient = Client<HttpConnector, Full<Bytes>>;

#[derive(Clone)]
pub struct MihomoClient {
    authority: String,
    secret: Option<String>,
    http: HttpClient,
}

#[derive(Clone, Copy)]
pub enum Endpoint {
    Version,
    Proxies,
    Connections,
    Rules,
    ProxyProviders,
    RuleProviders,
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Version => "version",
            Self::Proxies => "proxies",
            Self::Connections => "connections",
            Self::Rules => "rules",
            Self::ProxyProviders => "providers/proxies",
            Self::RuleProviders => "providers/rules",
        }
    }
}

#[derive(Debug)]
pub enum MihomoError {
    InvalidControllerUrl,
    InvalidSecret,
    Request(hyper_util::client::legacy::Error),
    Body(hyper::Error),
    Timeout,
    UpstreamStatus(u16),
    ResponseTooLarge,
    InvalidJson(serde_json::Error),
    InvalidSelection,
    InvalidConnectionId,
    InvalidDnsQuery,
}

impl MihomoClient {
    pub fn from_env() -> Result<Self, MihomoError> {
        let raw_url =
            env::var("XKEEN_MIHOMO_URL").unwrap_or_else(|_| "http://127.0.0.1:9090/".to_owned());
        let authority = parse_controller_authority(&raw_url)?;
        let mut connector = HttpConnector::new();
        connector.set_connect_timeout(Some(Duration::from_secs(1)));
        let http = Client::builder(TokioExecutor::new())
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(Duration::from_secs(15))
            .build(connector);
        let secret = env::var("XKEEN_MIHOMO_SECRET")
            .ok()
            .filter(|value| !value.is_empty());

        Ok(Self {
            authority,
            secret,
            http,
        })
    }

    pub async fn get_json(&self, endpoint: Endpoint) -> Result<Value, MihomoError> {
        let response = self.send(Method::GET, endpoint.path(), None).await?;
        self.read_json(response).await
    }

    pub async fn get_raw_json(&self, endpoint: Endpoint) -> Result<Bytes, MihomoError> {
        let response = self.send(Method::GET, endpoint.path(), None).await?;
        let body = self.read_body(response).await?;
        serde_json::from_slice::<serde::de::IgnoredAny>(&body).map_err(MihomoError::InvalidJson)?;
        Ok(body)
    }

    pub async fn dns_query(&self, name: &str, record_type: &str) -> Result<Value, MihomoError> {
        if !valid_dns_name(name) || !valid_dns_type(record_type) {
            return Err(MihomoError::InvalidDnsQuery);
        }
        let name = utf8_percent_encode(name, NON_ALPHANUMERIC);
        let record_type = record_type.to_ascii_uppercase();
        let record_type = utf8_percent_encode(&record_type, NON_ALPHANUMERIC);
        let response = self
            .send(
                Method::GET,
                &format!("dns/query?name={name}&type={record_type}"),
                None,
            )
            .await?;
        self.read_json(response).await
    }

    async fn read_json(
        &self,
        response: hyper::Response<hyper::body::Incoming>,
    ) -> Result<Value, MihomoError> {
        let body = self.read_body(response).await?;
        serde_json::from_slice(&body).map_err(MihomoError::InvalidJson)
    }

    async fn read_body(
        &self,
        response: hyper::Response<hyper::body::Incoming>,
    ) -> Result<Bytes, MihomoError> {
        if !response.status().is_success() {
            return Err(MihomoError::UpstreamStatus(response.status().as_u16()));
        }
        let body = tokio::time::timeout(REQUEST_TIMEOUT, async {
            let mut incoming = response.into_body();
            let mut bytes = Vec::new();
            while let Some(frame) = incoming.frame().await {
                let frame = frame.map_err(MihomoError::Body)?;
                if let Ok(data) = frame.into_data() {
                    if bytes.len().saturating_add(data.len()) > MAX_RESPONSE_BYTES {
                        return Err(MihomoError::ResponseTooLarge);
                    }
                    bytes.extend_from_slice(&data);
                }
            }
            Ok::<_, MihomoError>(bytes)
        })
        .await
        .map_err(|_| MihomoError::Timeout)??;
        Ok(Bytes::from(body))
    }

    pub async fn select_proxy(&self, group: &str, proxy: &str) -> Result<(), MihomoError> {
        if !valid_name(group) || !valid_name(proxy) {
            return Err(MihomoError::InvalidSelection);
        }
        // Mihomo validates the current selector and target when handling PUT.
        // Avoid fetching the full proxy inventory first: this was an extra
        // round trip on every switch and made local selector changes sluggish.
        let encoded_group = utf8_percent_encode(group, NON_ALPHANUMERIC);
        let body = Bytes::from(json!({ "name": proxy }).to_string());
        let response = self
            .send(Method::PUT, &format!("proxies/{encoded_group}"), Some(body))
            .await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(MihomoError::UpstreamStatus(response.status().as_u16()))
        }
    }

    pub async fn ping_group(&self, group: &str) -> Result<Value, MihomoError> {
        self.ping_group_with_options(group, "https://www.gstatic.com/generate_204", 5000)
            .await
    }

    pub async fn ping_group_with_options(
        &self,
        group: &str,
        ping_url: &str,
        timeout_ms: u64,
    ) -> Result<Value, MihomoError> {
        if !valid_name(group) {
            return Err(MihomoError::InvalidSelection);
        }
        let payload = self.get_json(Endpoint::Proxies).await?;
        let proxies = payload
            .get("proxies")
            .and_then(Value::as_object)
            .ok_or(MihomoError::InvalidSelection)?;
        let group_data = proxies.get(group).ok_or(MihomoError::InvalidSelection)?;
        if !matches!(
            group_data.get("type").and_then(Value::as_str),
            Some("Selector" | "URLTest" | "Fallback" | "LoadBalance")
        ) {
            return Err(MihomoError::InvalidSelection);
        }
        // Subscription nodes can be absent from /proxies while still being
        // listed in selectors. Mihomo exposes their runtime metadata separately.
        let mut available_proxies = proxies.clone();
        if let Ok(provider_payload) = self.get_json(Endpoint::ProxyProviders).await {
            if let Some(providers) = provider_payload.get("providers").and_then(Value::as_object) {
                for provider in providers.values() {
                    if let Some(items) = provider.get("proxies").and_then(Value::as_array) {
                        for proxy in items {
                            if let Some(name) = proxy.get("name").and_then(Value::as_str) {
                                available_proxies
                                    .entry(name.to_owned())
                                    .or_insert_with(|| proxy.clone());
                            }
                        }
                    }
                }
            }
        }
        let names = group_data
            .get("all")
            .and_then(Value::as_array)
            .ok_or(MihomoError::InvalidSelection)?
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| {
                available_proxies.get(*name).is_some_and(|proxy| {
                    !matches!(
                        proxy.get("type").and_then(Value::as_str),
                        Some(
                            "Selector"
                                | "URLTest"
                                | "LoadBalance"
                                | "Fallback"
                                | "Reject"
                                | "Compatible"
                        )
                    )
                })
            })
            .map(str::to_owned)
            .collect::<Vec<_>>();

        let mut results = Vec::with_capacity(names.len());
        for batch in names.chunks(8) {
            let mut tasks = JoinSet::new();
            for name in batch.iter().cloned() {
                let client = self.clone();
                let ping_url = ping_url.to_owned();
                tasks.spawn(async move {
                    let delay = client
                        .ping_proxy(&name, &ping_url, timeout_ms)
                        .await
                        .ok()
                        .and_then(|value| value.get("delay").and_then(Value::as_u64));
                    json!({"name": name, "delay": delay})
                });
            }
            while let Some(result) = tasks.join_next().await {
                if let Ok(result) = result {
                    results.push(result);
                }
            }
        }
        Ok(json!({"results": results}))
    }

    pub async fn ping_proxy_in_group(&self, group: &str, name: &str) -> Result<Value, MihomoError> {
        self.ping_proxy_in_group_with_options(
            group,
            name,
            "https://www.gstatic.com/generate_204",
            5000,
        )
        .await
    }

    pub async fn ping_proxy_in_group_with_options(
        &self,
        group: &str,
        name: &str,
        ping_url: &str,
        timeout_ms: u64,
    ) -> Result<Value, MihomoError> {
        if !valid_name(group) || !valid_name(name) {
            return Err(MihomoError::InvalidSelection);
        }
        let payload = self.get_json(Endpoint::Proxies).await?;
        let proxies = payload
            .get("proxies")
            .and_then(Value::as_object)
            .ok_or(MihomoError::InvalidSelection)?;
        let group_data = proxies.get(group).ok_or(MihomoError::InvalidSelection)?;
        if !matches!(
            group_data.get("type").and_then(Value::as_str),
            Some("Selector" | "URLTest" | "Fallback" | "LoadBalance")
        ) || !group_data
            .get("all")
            .and_then(Value::as_array)
            .is_some_and(|entries| entries.iter().any(|entry| entry.as_str() == Some(name)))
        {
            return Err(MihomoError::InvalidSelection);
        }

        let mut proxy = proxies.get(name).cloned();
        if proxy.is_none() {
            if let Ok(provider_payload) = self.get_json(Endpoint::ProxyProviders).await {
                proxy = provider_payload
                    .get("providers")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flat_map(|providers| providers.values())
                    .filter_map(|provider| provider.get("proxies").and_then(Value::as_array))
                    .flatten()
                    .find(|entry| entry.get("name").and_then(Value::as_str) == Some(name))
                    .cloned();
            }
        }
        let proxy_type = proxy
            .as_ref()
            .and_then(|proxy| proxy.get("type"))
            .and_then(Value::as_str);
        if proxy.is_none()
            || matches!(
                proxy_type,
                Some("Selector" | "URLTest" | "LoadBalance" | "Fallback" | "Reject" | "Compatible")
            )
        {
            return Err(MihomoError::InvalidSelection);
        }

        let delay = self
            .ping_proxy(name, ping_url, timeout_ms)
            .await
            .ok()
            .and_then(|value| value.get("delay").and_then(Value::as_u64));
        Ok(json!({"results": [{"name": name, "delay": delay}]}))
    }

    async fn ping_proxy(
        &self,
        name: &str,
        ping_url: &str,
        timeout_ms: u64,
    ) -> Result<Value, MihomoError> {
        let name = utf8_percent_encode(name, NON_ALPHANUMERIC);
        let url = utf8_percent_encode(ping_url, NON_ALPHANUMERIC);
        let response = self
            .send(
                Method::GET,
                &format!("proxies/{name}/delay?url={url}&timeout={timeout_ms}"),
                None,
            )
            .await?;
        self.read_json(response).await
    }

    pub async fn close_connection(&self, id: &str) -> Result<(), MihomoError> {
        if !valid_connection_id(id) {
            return Err(MihomoError::InvalidConnectionId);
        }
        let connections = self.get_json(Endpoint::Connections).await?;
        let exists = connections
            .get("connections")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("id").and_then(Value::as_str) == Some(id))
            });
        if !exists {
            return Err(MihomoError::InvalidConnectionId);
        }
        self.expect_success(Method::DELETE, &format!("connections/{id}"), None)
            .await
    }

    pub async fn close_all_connections(&self) -> Result<(), MihomoError> {
        self.expect_success(Method::DELETE, "connections", None)
            .await
    }

    async fn expect_success(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<(), MihomoError> {
        let response = self.send(method, path, body).await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(MihomoError::UpstreamStatus(response.status().as_u16()))
        }
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Bytes>,
    ) -> Result<hyper::Response<hyper::body::Incoming>, MihomoError> {
        let uri = format!("http://{}/{path}", self.authority)
            .parse::<Uri>()
            .map_err(|_| MihomoError::InvalidControllerUrl)?;
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::ACCEPT, "application/json");
        if let Some(secret) = self.secret.as_deref() {
            let value = format!("Bearer {secret}")
                .parse::<hyper::header::HeaderValue>()
                .map_err(|_| MihomoError::InvalidSecret)?;
            builder = builder.header(header::AUTHORIZATION, value);
        }
        let mut request = builder
            .body(Full::new(body.unwrap_or_default()))
            .map_err(|_| MihomoError::InvalidControllerUrl)?;
        if request.method() == Method::PUT {
            request.headers_mut().insert(
                header::CONTENT_TYPE,
                hyper::header::HeaderValue::from_static("application/json"),
            );
        }
        tokio::time::timeout(REQUEST_TIMEOUT, self.http.request(request))
            .await
            .map_err(|_| MihomoError::Timeout)?
            .map_err(MihomoError::Request)
    }
}

fn parse_controller_authority(raw_url: &str) -> Result<String, MihomoError> {
    let uri = raw_url
        .parse::<Uri>()
        .map_err(|_| MihomoError::InvalidControllerUrl)?;
    let authority = uri.authority().ok_or(MihomoError::InvalidControllerUrl)?;
    let loopback_host = matches!(uri.host(), Some("127.0.0.1" | "localhost" | "::1"));
    if uri.scheme_str() != Some("http")
        || !loopback_host
        || authority.as_str().contains('@')
        || uri
            .path_and_query()
            .is_some_and(|value| value.as_str() != "/")
    {
        return Err(MihomoError::InvalidControllerUrl);
    }
    Ok(authority.as_str().to_owned())
}

fn valid_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn valid_connection_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn valid_dns_name(value: &str) -> bool {
    let name = value.strip_suffix('.').unwrap_or(value);
    !name.is_empty()
        && name.len() <= 253
        && name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                && label.as_bytes()[0] != b'-'
                && label.as_bytes()[label.len() - 1] != b'-'
        })
}

fn valid_dns_type(value: &str) -> bool {
    matches!(
        value.to_ascii_uppercase().as_str(),
        "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS" | "PTR" | "SRV" | "HTTPS" | "SVCB"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        parse_controller_authority, valid_connection_id, valid_dns_name, valid_dns_type,
        valid_name, Endpoint, MihomoClient, MihomoError, MAX_RESPONSE_BYTES,
    };
    use axum::http::{header, Method, StatusCode};
    use http_body_util::Full;
    use hyper::body::Bytes;
    use hyper::service::service_fn;
    use hyper_util::rt::TokioIo;
    use std::{
        convert::Infallible,
        sync::{Arc, Mutex},
    };
    use tokio::{net::TcpListener, sync::mpsc, task::JoinHandle};

    async fn mock_controller(
        responses: Vec<(StatusCode, String)>,
    ) -> (
        MihomoClient,
        mpsc::UnboundedReceiver<(Method, String, Option<String>)>,
        JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let authority = listener.local_addr().unwrap().to_string();
        let responses = Arc::new(Mutex::new(responses.into_iter()));
        let (request_tx, request_rx) = mpsc::unbounded_channel();
        let server = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let responses = responses.clone();
                let request_tx = request_tx.clone();
                tokio::spawn(async move {
                    let service =
                        service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                            let responses = responses.clone();
                            let request_tx = request_tx.clone();
                            async move {
                                let _ = request_tx.send((
                                    request.method().clone(),
                                    request
                                        .uri()
                                        .path_and_query()
                                        .map_or("/", |value| value.as_str())
                                        .to_owned(),
                                    request
                                        .headers()
                                        .get(header::AUTHORIZATION)
                                        .and_then(|value| value.to_str().ok())
                                        .map(str::to_owned),
                                ));
                                let (status, body) = responses.lock().unwrap().next().unwrap_or((
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    "no mock response".into(),
                                ));
                                Ok::<_, Infallible>(
                                    hyper::Response::builder()
                                        .status(status)
                                        .header(header::CONTENT_TYPE, "application/json")
                                        .body(Full::new(Bytes::from(body)))
                                        .unwrap(),
                                )
                            }
                        });
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        });
        let mut connector = hyper_util::client::legacy::connect::HttpConnector::new();
        connector.set_connect_timeout(Some(std::time::Duration::from_secs(1)));
        let http =
            hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
                .build(connector);
        let client = MihomoClient {
            authority,
            secret: Some("mock-secret".into()),
            http,
        };
        (client, request_rx, server)
    }

    async fn next_request(
        receiver: &mut mpsc::UnboundedReceiver<(Method, String, Option<String>)>,
    ) -> (Method, String, Option<String>) {
        tokio::time::timeout(std::time::Duration::from_secs(1), receiver.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[test]
    fn endpoint_paths_are_a_fixed_allowlist() {
        assert_eq!(Endpoint::Version.path(), "version");
        assert_eq!(Endpoint::Proxies.path(), "proxies");
        assert_eq!(Endpoint::Connections.path(), "connections");
        assert_eq!(Endpoint::Rules.path(), "rules");
        assert_eq!(Endpoint::ProxyProviders.path(), "providers/proxies");
        assert_eq!(Endpoint::RuleProviders.path(), "providers/rules");
    }

    #[test]
    fn controller_url_accepts_only_local_http_authorities() {
        assert_eq!(
            parse_controller_authority("http://127.0.0.1:9090/").unwrap(),
            "127.0.0.1:9090"
        );
        assert!(matches!(
            parse_controller_authority("http://192.168.1.1:9090/"),
            Err(MihomoError::InvalidControllerUrl)
        ));
        assert!(matches!(
            parse_controller_authority("https://127.0.0.1:9090/"),
            Err(MihomoError::InvalidControllerUrl)
        ));
        assert!(matches!(
            parse_controller_authority("http://user@127.0.0.1:9090/"),
            Err(MihomoError::InvalidControllerUrl)
        ));
    }

    #[test]
    fn selector_names_reject_empty_control_and_oversized_values() {
        assert!(!valid_name(""));
        assert!(!valid_name("main\n"));
        assert!(!valid_name(&"x".repeat(257)));
        assert!(valid_name("Main / Europe"));
    }

    #[test]
    fn connection_ids_allow_only_uuid_safe_characters() {
        assert!(valid_connection_id("a8af0b12-24ff-4a4f-9000-19d9a3afc20d"));
        assert!(!valid_connection_id(""));
        assert!(!valid_connection_id("../configs"));
        assert!(!valid_connection_id("id?secret=value"));
    }

    #[test]
    fn dns_queries_allow_domain_names_and_known_record_types_only() {
        assert!(valid_dns_name("example.com"));
        assert!(valid_dns_name("router.lan."));
        assert!(valid_dns_name("_xmpp._tcp.example.com"));
        assert!(!valid_dns_name(""));
        assert!(!valid_dns_name("bad..example"));
        assert!(!valid_dns_name("-bad.example"));
        assert!(!valid_dns_name("bad.example/path"));
        assert!(valid_dns_type("A"));
        assert!(valid_dns_type("aaaa"));
        assert!(!valid_dns_type("ANY"));
        assert!(!valid_dns_type("A&secret=value"));
    }

    #[tokio::test]
    async fn dns_lookup_uses_encoded_query_and_parses_clash_response() {
        let (client, mut requests, server) = mock_controller(vec![(
            StatusCode::OK,
            r#"{"Status":"NOERROR","Answer":[{"name":"example.com","type":"A","data":"192.0.2.1"}]}"#.into(),
        )]).await;
        let result = client.dns_query("example.com", "a").await.unwrap();
        assert_eq!(result["Status"], "NOERROR");
        assert_eq!(result["Answer"][0]["data"], "192.0.2.1");
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::GET,
                "/dns/query?name=example%2Ecom&type=A".into(),
                Some("Bearer mock-secret".into())
            )
        );
        server.abort();
    }

    #[tokio::test]
    async fn raw_json_preserves_the_capped_upstream_payload() {
        let body = r#"{"proxies":{"Main":{"type":"Selector","all":["Finland"]}}}"#;
        let (client, mut requests, server) =
            mock_controller(vec![(StatusCode::OK, body.into())]).await;
        let result = client.get_raw_json(Endpoint::Proxies).await.unwrap();
        assert_eq!(result.as_ref(), body.as_bytes());
        assert_eq!(next_request(&mut requests).await.1, "/proxies");
        server.abort();
    }

    #[tokio::test]
    async fn raw_json_rejects_invalid_json_and_oversized_payloads() {
        let (client, _requests, server) =
            mock_controller(vec![(StatusCode::OK, r#"{"proxies":}"#.into())]).await;
        assert!(matches!(
            client.get_raw_json(Endpoint::Proxies).await,
            Err(MihomoError::InvalidJson(_))
        ));
        server.abort();

        let body = format!("{{\"padding\":\"{}\"}}", "x".repeat(MAX_RESPONSE_BYTES));
        let (client, _requests, server) = mock_controller(vec![(StatusCode::OK, body)]).await;
        assert!(matches!(
            client.get_raw_json(Endpoint::ProxyProviders).await,
            Err(MihomoError::ResponseTooLarge)
        ));
        server.abort();
    }

    #[tokio::test]
    async fn proxy_selection_sends_one_put_and_lets_mihomo_validate_current_membership() {
        let (client, mut requests, server) =
            mock_controller(vec![(StatusCode::NO_CONTENT, String::new())]).await;
        client
            .select_proxy("Main / Europe", "Finland")
            .await
            .unwrap();
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::PUT,
                "/proxies/Main%20%2F%20Europe".into(),
                Some("Bearer mock-secret".into())
            )
        );
        server.abort();
    }

    #[tokio::test]
    async fn ping_group_checks_all_real_nodes_and_skips_nested_groups() {
        let (client, mut requests, server) = mock_controller(vec![
            (StatusCode::OK, r#"{"proxies":{"Main":{"type":"Selector","all":["Finland","Sweden","DIRECT","Auto"]},"Finland":{"type":"VLESS"},"DIRECT":{"type":"Direct"},"Auto":{"type":"URLTest"}}}"#.into()),
            (StatusCode::OK, r#"{"providers":{"subscription":{"proxies":[{"name":"Sweden","type":"Hysteria2"}]}}}"#.into()),
            (StatusCode::OK, r#"{"delay":42}"#.into()),
            (StatusCode::OK, r#"{"delay":73}"#.into()),
            (StatusCode::OK, r#"{"delay":8}"#.into()),
        ]).await;
        let result = client.ping_group("Main").await.unwrap();
        assert_eq!(result["results"].as_array().unwrap().len(), 3);
        let entries = result["results"].as_array().unwrap();
        assert!(entries.iter().any(|item| item["name"] == "Finland"));
        assert!(entries.iter().any(|item| item["name"] == "Sweden"));
        assert!(entries
            .iter()
            .any(|item| item["name"] == "DIRECT" && item["delay"] == 8));
        assert_eq!(next_request(&mut requests).await.1, "/proxies");
        assert_eq!(next_request(&mut requests).await.1, "/providers/proxies");
        let paths = [
            next_request(&mut requests).await.1,
            next_request(&mut requests).await.1,
            next_request(&mut requests).await.1,
        ];
        assert!(paths
            .iter()
            .any(|path| path.starts_with("/proxies/Finland/delay?")));
        assert!(paths
            .iter()
            .any(|path| path.starts_with("/proxies/Sweden/delay?")));
        assert!(paths
            .iter()
            .any(|path| path.starts_with("/proxies/DIRECT/delay?")));
        server.abort();
    }

    #[tokio::test]
    async fn ping_proxy_in_group_checks_only_the_requested_real_node() {
        let (client, mut requests, server) = mock_controller(vec![
            (StatusCode::OK, r#"{"proxies":{"Main":{"type":"Selector","all":["Finland","Sweden","Auto"]},"Finland":{"type":"VLESS"},"Auto":{"type":"URLTest"}}}"#.into()),
            (StatusCode::OK, r#"{"delay":42}"#.into()),
        ]).await;
        let result = client.ping_proxy_in_group("Main", "Finland").await.unwrap();
        assert_eq!(result["results"][0]["name"], "Finland");
        assert_eq!(result["results"][0]["delay"], 42);
        assert_eq!(next_request(&mut requests).await.1, "/proxies");
        assert!(next_request(&mut requests)
            .await
            .1
            .starts_with("/proxies/Finland/delay?"));
        server.abort();
    }

    #[tokio::test]
    async fn ping_proxy_in_group_rejects_nodes_outside_the_group() {
        let (client, mut requests, server) = mock_controller(vec![(
            StatusCode::OK,
            r#"{"proxies":{"Main":{"type":"Selector","all":["Finland"]},"Sweden":{"type":"VLESS"}}}"#.into(),
        )]).await;
        assert!(matches!(
            client.ping_proxy_in_group("Main", "Sweden").await,
            Err(MihomoError::InvalidSelection)
        ));
        assert_eq!(next_request(&mut requests).await.1, "/proxies");
        server.abort();
    }

    #[tokio::test]
    async fn ping_proxy_in_auto_policy_groups_and_direct_nodes() {
        let (client, mut requests, server) = mock_controller(vec![
            (StatusCode::OK, r#"{"proxies":{"Fastest":{"type":"URLTest","all":["DIRECT","Finland"]},"DIRECT":{"type":"Direct"},"Finland":{"type":"VLESS"}}}"#.into()),
            (StatusCode::OK, r#"{"delay":8}"#.into()),
        ]).await;
        let result = client
            .ping_proxy_in_group("Fastest", "DIRECT")
            .await
            .unwrap();
        assert_eq!(result["results"][0]["name"], "DIRECT");
        assert_eq!(result["results"][0]["delay"], 8);
        assert_eq!(next_request(&mut requests).await.1, "/proxies");
        assert!(next_request(&mut requests)
            .await
            .1
            .starts_with("/proxies/DIRECT/delay?"));
        server.abort();
    }

    #[tokio::test]
    async fn proxy_selection_reports_mihomo_rejection_for_unknown_group_or_member() {
        let (client, mut requests, server) =
            mock_controller(vec![(StatusCode::NOT_FOUND, String::new())]).await;
        assert!(matches!(
            client.select_proxy("Main", "Unknown").await,
            Err(MihomoError::UpstreamStatus(404))
        ));
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::PUT,
                "/proxies/Main".into(),
                Some("Bearer mock-secret".into())
            )
        );
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), requests.recv())
                .await
                .is_err()
        );
        server.abort();
    }

    #[tokio::test]
    async fn close_connection_rechecks_the_id_before_delete() {
        let (client, mut requests, server) = mock_controller(vec![
            (
                StatusCode::OK,
                r#"{"connections":[{"id":"a8af0b12-24ff-4a4f-9000-19d9a3afc20d"}]}"#.into(),
            ),
            (StatusCode::NO_CONTENT, String::new()),
        ])
        .await;
        client
            .close_connection("a8af0b12-24ff-4a4f-9000-19d9a3afc20d")
            .await
            .unwrap();
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::GET,
                "/connections".into(),
                Some("Bearer mock-secret".into())
            )
        );
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::DELETE,
                "/connections/a8af0b12-24ff-4a4f-9000-19d9a3afc20d".into(),
                Some("Bearer mock-secret".into())
            )
        );
        server.abort();
    }

    #[tokio::test]
    async fn stale_connection_id_is_not_deleted() {
        let (client, mut requests, server) =
            mock_controller(vec![(StatusCode::OK, r#"{"connections":[]}"#.into())]).await;
        assert!(matches!(
            client
                .close_connection("a8af0b12-24ff-4a4f-9000-19d9a3afc20d")
                .await,
            Err(MihomoError::InvalidConnectionId)
        ));
        assert_eq!(
            next_request(&mut requests).await,
            (
                Method::GET,
                "/connections".into(),
                Some("Bearer mock-secret".into())
            )
        );
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), requests.recv())
                .await
                .is_err()
        );
        server.abort();
    }

    #[tokio::test]
    async fn upstream_errors_and_oversized_bodies_are_rejected() {
        let (client, _requests, server) =
            mock_controller(vec![(StatusCode::SERVICE_UNAVAILABLE, "{}".into())]).await;
        assert!(matches!(
            client.get_json(Endpoint::Version).await,
            Err(MihomoError::UpstreamStatus(503))
        ));
        server.abort();

        let body = format!("{{\"padding\":\"{}\"}}", "x".repeat(MAX_RESPONSE_BYTES));
        let (client, _requests, server) = mock_controller(vec![(StatusCode::OK, body)]).await;
        assert!(matches!(
            client.get_json(Endpoint::Version).await,
            Err(MihomoError::ResponseTooLarge)
        ));
        server.abort();
    }
}
