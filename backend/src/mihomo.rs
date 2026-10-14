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
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Version => "version",
            Self::Proxies => "proxies",
            Self::Connections => "connections",
            Self::Rules => "rules",
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
        serde_json::from_slice(&body).map_err(MihomoError::InvalidJson)
    }

    pub async fn select_proxy(&self, group: &str, proxy: &str) -> Result<(), MihomoError> {
        if !valid_name(group) || !valid_name(proxy) {
            return Err(MihomoError::InvalidSelection);
        }
        let proxies = self.get_json(Endpoint::Proxies).await?;
        let group_data = proxies
            .get("proxies")
            .and_then(Value::as_object)
            .and_then(|entries| entries.get(group))
            .ok_or(MihomoError::InvalidSelection)?;
        let is_selector = group_data.get("type").and_then(Value::as_str) == Some("Selector");
        let contains_proxy = group_data
            .get("all")
            .and_then(Value::as_array)
            .is_some_and(|entries| entries.iter().any(|entry| entry.as_str() == Some(proxy)));
        if !is_selector || !contains_proxy {
            return Err(MihomoError::InvalidSelection);
        }

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

#[cfg(test)]
mod tests {
    use super::{
        parse_controller_authority, valid_connection_id, valid_name, Endpoint, MihomoError,
    };

    #[test]
    fn endpoint_paths_are_a_fixed_allowlist() {
        assert_eq!(Endpoint::Version.path(), "version");
        assert_eq!(Endpoint::Proxies.path(), "proxies");
        assert_eq!(Endpoint::Connections.path(), "connections");
        assert_eq!(Endpoint::Rules.path(), "rules");
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
}
