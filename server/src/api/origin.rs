//! Cross-origin request guard.
//!
//! homectl has no authentication and is expected to be reachable only from the
//! local network. That alone does not stop a browser on the network from
//! loading a malicious page that issues cross-origin requests to the API:
//! without checks the page could read the configuration export (including
//! widget secrets) or apply destructive writes such as a config import.
//!
//! Every request that carries an `Origin` header is therefore checked against:
//!
//! 1. the server's own host (same-origin requests, e.g. the bundled UI),
//! 2. loopback hosts (local development),
//! 3. origins listed in `HOMECTL_ALLOWED_ORIGINS` (comma separated).
//!
//! Disallowed origins get a `403` before any route handler runs, and allowed
//! cross-origin responses echo `Access-Control-Allow-Origin`. Requests without
//! an `Origin` header (curl, CLI, health probes, same-origin GETs) are not CORS
//! requests and pass through untouched.
//!
//! Note that the same-host comparison trusts the `Host` header, so a DNS
//! rebinding attack could still present a matching pair. homectl assumes the
//! local network is trusted; deployments that want to defend against rebinding
//! as well would need a configured host allowlist.

use std::collections::HashSet;
use std::env;
use std::sync::Arc;

use warp::http::header::{
    HeaderValue, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE, VARY,
};
use warp::http::{Method, StatusCode};
use warp::hyper::Body;
use warp::reply::Response;
use warp::{Filter, Rejection};

/// Comma separated list of origins that may access the API cross-origin.
pub(crate) const ALLOWED_ORIGINS_ENV: &str = "HOMECTL_ALLOWED_ORIGINS";

const ALLOWED_METHODS: &str = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS: &str = "Content-Type, Authorization";

/// The origins that may talk to the API from a browser.
#[derive(Clone, Debug, Default)]
pub(crate) struct AllowedOrigins {
    explicit: Arc<HashSet<String>>,
}

impl AllowedOrigins {
    /// Read the configured origins from `HOMECTL_ALLOWED_ORIGINS`.
    pub(crate) fn from_env() -> Self {
        let configured = env::var(ALLOWED_ORIGINS_ENV).unwrap_or_default();
        Self::from_entries(configured.split(','))
    }

    /// Build a policy from explicit origin entries, ignoring blanks.
    pub(crate) fn from_entries<'a, I>(entries: I) -> Self
    where
        I: IntoIterator<Item = &'a str>,
    {
        let explicit = entries
            .into_iter()
            .map(normalize_origin)
            .filter(|entry| !entry.is_empty() && entry != "null")
            .collect();

        Self {
            explicit: Arc::new(explicit),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.explicit.is_empty()
    }

    pub(crate) fn entries(&self) -> impl Iterator<Item = &str> {
        self.explicit.iter().map(String::as_str)
    }

    /// Whether a (normalized) origin may access the API.
    fn permits(&self, origin: &str, host: Option<&str>) -> bool {
        if origin.is_empty() || origin == "null" {
            return false;
        }

        if self.explicit.contains(origin) {
            return true;
        }

        let Some(authority) = origin_authority(origin) else {
            return false;
        };

        if is_loopback_authority(authority) {
            return true;
        }

        host.is_some_and(|host| authorities_equal(authority, host))
    }
}

/// How a request should be handled with respect to cross-origin access.
#[derive(Debug)]
pub(crate) enum Verdict {
    /// Answer immediately without running any route handler (denied request
    /// or CORS preflight).
    Immediate(Response),
    /// Run the route handlers. `Some(origin)` when the request came from an
    /// allowed cross-origin caller and needs CORS response headers.
    Proceed(Option<String>),
}

/// Build a filter that classifies every request before route handlers run.
pub(crate) fn guard(
    allowed: AllowedOrigins,
) -> impl Filter<Extract = (Verdict,), Error = Rejection> + Clone {
    warp::any()
        .and(warp::header::optional::<String>("origin"))
        .and(warp::header::optional::<String>("host"))
        .and(warp::method())
        .map(
            move |origin: Option<String>, host: Option<String>, method: Method| {
                classify(origin, host.as_deref(), &method, &allowed)
            },
        )
}

/// Add CORS response headers when the request came from an allowed origin.
pub(crate) fn finalize(origin: Option<&str>, mut response: Response) -> Response {
    if let Some(origin) = origin {
        if let Ok(value) = HeaderValue::from_str(origin) {
            let headers = response.headers_mut();
            headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
            headers.append(VARY, HeaderValue::from_static("Origin"));
        }
    }

    response
}

fn classify(
    origin: Option<String>,
    host: Option<&str>,
    method: &Method,
    allowed: &AllowedOrigins,
) -> Verdict {
    let Some(origin) = origin else {
        return Verdict::Proceed(None);
    };

    let origin = origin.trim().to_string();
    let normalized = origin.to_ascii_lowercase();
    if !allowed.permits(&normalized, host) {
        debug!("Rejected cross-origin request from {origin:?} (host {host:?})");
        return Verdict::Immediate(forbidden_response());
    }

    if method == Method::OPTIONS {
        return Verdict::Immediate(preflight_response(&origin));
    }

    Verdict::Proceed(Some(origin))
}

fn forbidden_response() -> Response {
    let mut response = Response::new(Body::from("cross-origin request is not allowed"));
    *response.status_mut() = StatusCode::FORBIDDEN;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
}

fn preflight_response(origin: &str) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;

    let headers = response.headers_mut();
    headers.insert(VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(ALLOWED_METHODS),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(ALLOWED_HEADERS),
    );
    if let Ok(value) = HeaderValue::from_str(origin) {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }

    response
}

fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn origin_authority(origin: &str) -> Option<&str> {
    let (_, rest) = origin.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    (!authority.is_empty()).then_some(authority)
}

fn authorities_equal(a: &str, b: &str) -> bool {
    normalize_authority(a) == normalize_authority(b)
}

fn normalize_authority(authority: &str) -> String {
    let authority = authority.trim().to_ascii_lowercase();
    if let Some(stripped) = authority
        .strip_suffix(":443")
        .or_else(|| authority.strip_suffix(":80"))
    {
        return stripped.to_string();
    }

    authority
}

fn is_loopback_authority(authority: &str) -> bool {
    matches!(
        authority_host(authority).as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn authority_host(authority: &str) -> String {
    let authority = normalize_authority(authority);
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return rest[..end].to_string();
        }
    }

    authority.split(':').next().unwrap_or_default().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(entries: &[&str]) -> AllowedOrigins {
        AllowedOrigins::from_entries(entries.iter().copied())
    }

    fn immediate(response: Verdict) -> Response {
        match response {
            Verdict::Immediate(response) => response,
            Verdict::Proceed(_) => panic!("expected an immediate response"),
        }
    }

    #[test]
    fn requests_without_origin_pass_through() {
        let verdict = classify(None, Some("homectl.example"), &Method::POST, &policy(&[]));
        assert!(matches!(verdict, Verdict::Proceed(None)));
    }

    #[test]
    fn same_authority_is_allowed() {
        let policy = policy(&[]);

        assert!(policy.permits("https://homectl.fruitiex.org", Some("homectl.fruitiex.org")));
        assert!(policy.permits(
            "https://homectl.fruitiex.org:443",
            Some("homectl.fruitiex.org")
        ));
        assert!(policy.permits("http://192.168.11.99:45289", Some("192.168.11.99:45289")));
        assert!(!policy.permits("https://evil.example", Some("homectl.fruitiex.org")));
        assert!(!policy.permits("https://homectl.fruitiex.org", Some("other.example")));
        assert!(!policy.permits("null", Some("homectl.fruitiex.org")));
    }

    #[test]
    fn loopback_origins_are_allowed_for_development() {
        let policy = policy(&[]);

        assert!(policy.permits("http://localhost:3000", None));
        assert!(policy.permits("http://127.0.0.1:5173", Some("127.0.0.1:45289")));
        assert!(policy.permits("http://[::1]:3000", None));
        assert!(!policy.permits("http://local.host:3000", None));
    }

    #[test]
    fn explicit_allowlist_entries_are_allowed() {
        let policy = policy(&["HTTPS://Dashboard.Example/", "http://kiosk.local:8080"]);

        assert!(policy.permits("https://dashboard.example", Some("homectl.example")));
        assert!(policy.permits("http://kiosk.local:8080", Some("homectl.example")));
        assert!(!policy.permits("https://other.example", Some("homectl.example")));
    }

    #[test]
    fn denied_origin_gets_a_forbidden_response() {
        let response = immediate(classify(
            Some("https://evil.example".to_string()),
            Some("homectl.example"),
            &Method::GET,
            &policy(&[]),
        ));

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .headers()
            .get(ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[test]
    fn preflight_gets_cors_headers() {
        let response = immediate(classify(
            Some("http://localhost:3000".to_string()),
            Some("127.0.0.1:45289"),
            &Method::OPTIONS,
            &policy(&[]),
        ));

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_METHODS)
                .unwrap(),
            ALLOWED_METHODS
        );
    }

    #[test]
    fn denied_preflight_gets_a_forbidden_response() {
        let response = immediate(classify(
            Some("https://evil.example".to_string()),
            Some("homectl.example"),
            &Method::OPTIONS,
            &policy(&[]),
        ));

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn allowed_cross_origin_responses_echo_the_origin() {
        let response = finalize(Some("http://localhost:3000"), Response::new(Body::empty()));

        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(response.headers().get(VARY).unwrap(), "Origin");
    }
}
