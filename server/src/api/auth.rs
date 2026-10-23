//! `/auth/*` routes (sign-in, pairing, paired devices) and the guard that
//! protects `/api` and `/ws` when authentication is enabled. See
//! [`crate::auth`] for the model.

// Handlers return a ready error `Response` as their `Err`; boxing it would only
// add noise to every early return.
#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use serde::Deserialize;
use serde_json::{json, Value};
use warp::filters::BoxedFilter;
use warp::http::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE, LOCATION, SET_COOKIE};
use warp::http::{HeaderMap, Method, StatusCode};
use warp::hyper::Body;
use warp::reply::Response;
use warp::{Filter, Rejection};

use crate::auth::devices::{DeviceRecord, PollResult};
use crate::auth::oidc::{LoginState, SignInError};
use crate::auth::{
    client_ip, cookie, is_https, Auth, AuthMode, Principal, SESSION_COOKIE, STATE_COOKIE,
};

const MAX_BODY_BYTES: u64 = 16 * 1024;
const MAX_DEVICE_NAME: usize = 80;

fn response(status: StatusCode, body: Value, cookies: &[String]) -> Response {
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(cookie) {
            headers.append(SET_COOKIE, value);
        }
    }
    response
}

fn error(status: StatusCode, message: &str) -> Response {
    response(status, json!({ "error": message }), &[])
}

fn redirect(location: &str, cookies: &[String]) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::FOUND;
    if let Ok(value) = HeaderValue::from_str(location) {
        response.headers_mut().insert(LOCATION, value);
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(cookie) {
            response.headers_mut().append(SET_COOKIE, value);
        }
    }
    response
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// A small standalone page for sign-in failures (the SPA is not involved).
fn sign_in_page(status: StatusCode, title: &str, message: &str, cookies: &[String]) -> Response {
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>homectl</title>
<style>body{{font-family:system-ui,sans-serif;background:#0f1115;color:#e7e9ee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}}main{{max-width:28rem}}a{{color:#8ab4ff}}p{{color:#aab0bc;line-height:1.5}}</style></head>
<body><main><h1>{}</h1><p>{}</p><p><a href="/">Back to homectl</a></p></main></body></html>"#,
        escape_html(title),
        escape_html(message)
    );
    let mut response = Response::new(Body::from(html));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(cookie) {
            response.headers_mut().append(SET_COOKIE, value);
        }
    }
    response
}

/// Only same-origin absolute paths may be returned to after sign-in.
fn safe_return_path(candidate: Option<&String>) -> String {
    match candidate {
        Some(path)
            if path.starts_with('/')
                && !path.starts_with("//")
                && !path.starts_with("/\\")
                && !path.starts_with("/auth/")
                && path.len() <= 2048
                && !path.chars().any(char::is_control) =>
        {
            path.clone()
        }
        _ => "/".to_string(),
    }
}

fn device_json(record: &DeviceRecord) -> Value {
    json!({
        "id": record.id,
        "name": record.name,
        "createdAt": record.created_at,
        "createdBy": record.created_by,
        "userAgent": record.user_agent,
        "lastSeenAt": record.last_seen_at,
        "lastSeenIp": record.last_seen_ip,
    })
}

fn clean_name(name: Option<&str>) -> Option<String> {
    let name: String = name?
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_DEVICE_NAME)
        .collect();
    (!name.is_empty()).then_some(name)
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(300).collect())
}

struct Request {
    path: String,
    method: Method,
    headers: HeaderMap,
    ip: Option<String>,
    query: HashMap<String, String>,
    body: Bytes,
}

impl Request {
    fn json<T: for<'de> Deserialize<'de>>(&self) -> Result<T, Response> {
        let body: &[u8] = if self.body.is_empty() {
            b"{}"
        } else {
            &self.body
        };
        serde_json::from_slice(body).map_err(|e| {
            error(
                StatusCode::BAD_REQUEST,
                &format!("invalid request body: {e}"),
            )
        })
    }
}

/// `/auth/*` routes. Present in every mode so the UI can ask whether sign-in
/// is needed (`GET /auth/me`).
pub fn routes(mode: AuthMode) -> BoxedFilter<(Response,)> {
    let body = warp::body::content_length_limit(MAX_BODY_BYTES)
        .and(warp::body::bytes())
        .or(warp::any().map(Bytes::new))
        .unify();
    let query = warp::query::<HashMap<String, String>>()
        .or(warp::any().map(HashMap::new))
        .unify();
    warp::path("auth")
        .and(warp::path::tail())
        .and(warp::method())
        .and(warp::header::headers_cloned())
        .and(warp::addr::remote())
        .and(query)
        .and(body)
        .and_then(
            move |tail: warp::path::Tail,
                  method: Method,
                  headers: HeaderMap,
                  remote: Option<SocketAddr>,
                  query: HashMap<String, String>,
                  body: Bytes| {
                let mode = mode.clone();
                async move {
                    let request = Request {
                        path: tail.as_str().trim_end_matches('/').to_string(),
                        method,
                        ip: client_ip(&headers, remote),
                        headers,
                        query,
                        body,
                    };
                    Ok::<_, Rejection>(handle(mode, request).await)
                }
            },
        )
        .boxed()
}

async fn handle(mode: AuthMode, request: Request) -> Response {
    let auth = match mode {
        AuthMode::Disabled => {
            return match (request.method.clone(), request.path.as_str()) {
                (Method::GET, "me") => response(
                    StatusCode::OK,
                    json!({ "enabled": false, "authenticated": true }),
                    &[],
                ),
                (Method::GET, "login") => redirect("/", &[]),
                _ => error(StatusCode::NOT_FOUND, "authentication is not enabled"),
            };
        }
        AuthMode::Misconfigured(message) => {
            return match (request.method.clone(), request.path.as_str()) {
                (Method::GET, "me") => response(
                    StatusCode::OK,
                    json!({ "enabled": true, "authenticated": false, "error": message.as_str() }),
                    &[],
                ),
                _ => error(StatusCode::SERVICE_UNAVAILABLE, &message),
            };
        }
        AuthMode::Enabled(auth) => auth,
    };

    let method = request.method.clone();
    let path = request.path.clone();
    let result = match (method, path.as_str()) {
        (Method::GET, "me") => me(&auth, &request).await,
        (Method::GET, "login") => login(&auth, &request).await,
        (Method::GET, "callback") => callback(&auth, &request).await,
        (Method::POST, "logout") => Ok(response(
            StatusCode::OK,
            json!({ "ok": true }),
            &[Auth::clear_cookie(SESSION_COOKIE, "/")],
        )),
        (Method::POST, "pair/start") => pair_start(&auth, &request),
        (Method::POST, "pair/poll") => pair_poll(&auth, &request),
        (Method::GET, "pair/request") => pair_request(&auth, &request).await,
        (Method::POST, "pair/approve") => pair_approve(&auth, &request).await,
        (Method::POST, "pair/deny") => pair_deny(&auth, &request).await,
        (Method::GET, "devices") => list_devices(&auth, &request).await,
        (Method::PUT, device) if device.starts_with("devices/") => {
            rename_device(&auth, &request, &device["devices/".len()..]).await
        }
        (Method::DELETE, device) if device.starts_with("devices/") => {
            revoke_device(&auth, &request, &device["devices/".len()..]).await
        }
        _ => Err(error(StatusCode::NOT_FOUND, "not found")),
    };
    result.unwrap_or_else(|response| response)
}

async fn me(auth: &Auth, request: &Request) -> Result<Response, Response> {
    let Some(found) = auth
        .authenticate(&request.headers, request.ip.as_deref())
        .await
    else {
        return Ok(response(
            StatusCode::OK,
            json!({ "enabled": true, "authenticated": false }),
            &[],
        ));
    };
    let principal = &found.principal;
    let username = match principal {
        Principal::User(session) => Some(session.username.clone()),
        _ => None,
    };
    let device_id = match principal {
        Principal::Device { id, .. } => Some(id.clone()),
        _ => None,
    };
    let cookies: Vec<String> = found.renew_cookie.into_iter().collect();
    Ok(response(
        StatusCode::OK,
        json!({
            "enabled": true,
            "authenticated": true,
            "kind": principal.kind(),
            "name": principal.name(),
            "username": username,
            "deviceId": device_id,
            "admin": principal.is_admin(),
        }),
        &cookies,
    ))
}

async fn login(auth: &Auth, request: &Request) -> Result<Response, Response> {
    let return_to = safe_return_path(request.query.get("return"));
    match auth.oidc.start(return_to).await {
        Ok((url, login)) => Ok(redirect(&url, &[auth.state_cookie(&login)])),
        Err(e) => {
            warn!("Could not start sign-in: {e}");
            Err(sign_in_page(
                StatusCode::BAD_GATEWAY,
                "Sign-in is unavailable",
                "homectl could not reach the identity provider. Try again in a moment.",
                &[],
            ))
        }
    }
}

async fn callback(auth: &Auth, request: &Request) -> Result<Response, Response> {
    let clear_state = Auth::clear_cookie(STATE_COOKIE, "/auth");
    let failed = |status: StatusCode, title: &str, message: &str| {
        sign_in_page(status, title, message, std::slice::from_ref(&clear_state))
    };
    if let Some(provider_error) = request.query.get("error") {
        warn!("Sign-in failed at the provider: {provider_error}");
        return Err(failed(
            StatusCode::FORBIDDEN,
            "Sign-in was not completed",
            &format!("The identity provider answered: {provider_error}"),
        ));
    }
    let login: Option<LoginState> = cookie(&request.headers, STATE_COOKIE)
        .and_then(|value| auth.signer.verify(STATE_COOKIE, value))
        .filter(|login: &LoginState| login.exp > crate::auth::now());
    let Some(login) = login else {
        return Err(failed(
            StatusCode::BAD_REQUEST,
            "Sign-in expired",
            "The sign-in took too long or was started in another browser. Please try again.",
        ));
    };
    if request.query.get("state") != Some(&login.state) {
        return Err(failed(
            StatusCode::BAD_REQUEST,
            "Sign-in failed",
            "The sign-in response did not match this browser. Please try again.",
        ));
    }
    let Some(code) = request.query.get("code") else {
        return Err(failed(
            StatusCode::BAD_REQUEST,
            "Sign-in failed",
            "Missing authorization code.",
        ));
    };
    match auth.oidc.finish(&login, code).await {
        Ok(identity) => {
            info!(
                "{} signed in{}",
                identity.username,
                if identity.admin { " (admin)" } else { "" }
            );
            let session = auth.new_session(identity);
            Ok(redirect(
                &login.return_to,
                &[auth.session_cookie(&session), clear_state.clone()],
            ))
        }
        Err(SignInError::NotAllowed(message)) => {
            warn!("Refused sign-in: {message}");
            Err(failed(
                StatusCode::FORBIDDEN,
                "Not allowed",
                "Your account is not allowed to use homectl.",
            ))
        }
        Err(SignInError::Failed(message)) => {
            warn!("Sign-in failed: {message}");
            Err(failed(
                StatusCode::BAD_GATEWAY,
                "Sign-in failed",
                "homectl could not complete the sign-in. Please try again.",
            ))
        }
    }
}

async fn require_admin(auth: &Auth, request: &Request) -> Result<Principal, Response> {
    match auth
        .authenticate(&request.headers, request.ip.as_deref())
        .await
    {
        Some(found) if found.principal.is_admin() => Ok(found.principal),
        Some(_) => Err(error(
            StatusCode::FORBIDDEN,
            "only admins can manage paired devices",
        )),
        None => Err(error(StatusCode::UNAUTHORIZED, "sign in first")),
    }
}

fn pair_start(auth: &Auth, request: &Request) -> Result<Response, Response> {
    #[derive(Deserialize)]
    struct Body {
        name: Option<String>,
    }
    let body: Body = request.json()?;
    let (pairing_id, pairing) = auth.pairings.start(
        clean_name(body.name.as_deref()),
        user_agent(&request.headers),
        request.ip.clone(),
    );
    info!(
        "Pairing requested from {} (code {})",
        request.ip.as_deref().unwrap_or("unknown address"),
        pairing.code
    );
    Ok(response(
        StatusCode::OK,
        json!({
            "pairingId": pairing_id,
            "code": pairing.code,
            "expiresIn": pairing.expires_in().as_secs(),
            "approveUrl": format!("{}/pair?code={}", auth.public_url, pairing.code),
            "pollInterval": 3,
        }),
        &[],
    ))
}

fn pair_poll(auth: &Auth, request: &Request) -> Result<Response, Response> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        pairing_id: String,
    }
    let body: Body = request.json()?;
    Ok(match auth.pairings.poll(&body.pairing_id) {
        PollResult::Pending(expires_in) => response(
            StatusCode::OK,
            json!({ "status": "pending", "expiresIn": expires_in.as_secs() }),
            &[],
        ),
        PollResult::Approved {
            device_id,
            name,
            token,
        } => response(
            StatusCode::OK,
            json!({
                "status": "approved",
                "device": { "id": device_id, "name": name },
                "token": token,
            }),
            &[Auth::device_cookie(&token, is_https(&request.headers))],
        ),
        PollResult::Denied => response(StatusCode::OK, json!({ "status": "denied" }), &[]),
        PollResult::Unknown => response(StatusCode::OK, json!({ "status": "expired" }), &[]),
    })
}

async fn pair_request(auth: &Auth, request: &Request) -> Result<Response, Response> {
    require_admin(auth, request).await?;
    let code = request.query.get("code").map(String::as_str).unwrap_or("");
    let Some(pairing) = auth.pairings.find_by_code(code) else {
        return Err(error(
            StatusCode::NOT_FOUND,
            "no pending pairing with this code; it may have expired",
        ));
    };
    Ok(response(
        StatusCode::OK,
        json!({
            "code": pairing.code,
            "requestedName": pairing.requested_name,
            "userAgent": pairing.user_agent,
            "ip": pairing.ip,
            "requestedAt": pairing.requested_at,
            "expiresIn": pairing.expires_in().as_secs(),
        }),
        &[],
    ))
}

async fn pair_approve(auth: &Auth, request: &Request) -> Result<Response, Response> {
    let principal = require_admin(auth, request).await?;
    #[derive(Deserialize)]
    struct Body {
        code: String,
        name: Option<String>,
    }
    let body: Body = request.json()?;
    let Some(pairing) = auth.pairings.find_by_code(&body.code) else {
        return Err(error(
            StatusCode::NOT_FOUND,
            "no pending pairing with this code; it may have expired",
        ));
    };
    let name = clean_name(body.name.as_deref())
        .or(pairing.requested_name.clone())
        .unwrap_or_else(|| "Wall display".to_string());
    let approver = match &principal {
        Principal::User(session) => session.username.clone(),
        other => other.name().to_string(),
    };
    let (record, token) = auth
        .devices
        .create(&name, &approver, pairing.user_agent.clone());
    if !auth
        .pairings
        .approve(&body.code, record.id.clone(), name.clone(), token)
    {
        // Lost a race with expiry or another approval: undo the device.
        auth.devices.revoke(&record.id).await;
        return Err(error(
            StatusCode::CONFLICT,
            "the pairing is no longer pending",
        ));
    }
    info!("{approver} paired device \"{name}\" ({})", record.id);
    Ok(response(
        StatusCode::OK,
        json!({ "device": device_json(&record) }),
        &[],
    ))
}

async fn pair_deny(auth: &Auth, request: &Request) -> Result<Response, Response> {
    require_admin(auth, request).await?;
    #[derive(Deserialize)]
    struct Body {
        code: String,
    }
    let body: Body = request.json()?;
    if !auth.pairings.deny(&body.code) {
        return Err(error(
            StatusCode::NOT_FOUND,
            "no pending pairing with this code",
        ));
    }
    Ok(response(StatusCode::OK, json!({ "ok": true }), &[]))
}

async fn list_devices(auth: &Auth, request: &Request) -> Result<Response, Response> {
    require_admin(auth, request).await?;
    let devices: Vec<Value> = auth.devices.list().iter().map(device_json).collect();
    let tokens: Vec<&str> = auth.api_tokens.iter().map(|t| t.name.as_str()).collect();
    Ok(response(
        StatusCode::OK,
        json!({ "devices": devices, "apiTokens": tokens }),
        &[],
    ))
}

async fn rename_device(auth: &Auth, request: &Request, id: &str) -> Result<Response, Response> {
    require_admin(auth, request).await?;
    #[derive(Deserialize)]
    struct Body {
        name: Option<String>,
    }
    let body: Body = request.json()?;
    let Some(name) = clean_name(body.name.as_deref()) else {
        return Err(error(StatusCode::BAD_REQUEST, "name is required"));
    };
    match auth.devices.rename(id, &name) {
        Some(record) => Ok(response(
            StatusCode::OK,
            json!({ "device": device_json(&record) }),
            &[],
        )),
        None => Err(error(StatusCode::NOT_FOUND, "no such device")),
    }
}

async fn revoke_device(auth: &Auth, request: &Request, id: &str) -> Result<Response, Response> {
    let principal = require_admin(auth, request).await?;
    match auth.devices.revoke(id).await {
        Some(record) => {
            info!(
                "{} revoked paired device \"{}\" ({})",
                principal.name(),
                record.name,
                record.id
            );
            Ok(response(StatusCode::OK, json!({ "ok": true }), &[]))
        }
        None => Err(error(StatusCode::NOT_FOUND, "no such device")),
    }
}

/// Paths that need a credential when authentication is enabled. Health
/// checks, `/auth/*` and the static UI shell stay public.
pub fn is_protected_path(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/") || path == "/ws" || path.starts_with("/ws/")
}

pub enum GuardVerdict {
    Immediate(Response),
    /// Continue; optionally attach a credential-renewing `Set-Cookie`.
    Proceed(Option<String>),
}

pub fn guard(mode: AuthMode) -> impl Filter<Extract = (GuardVerdict,), Error = Rejection> + Clone {
    warp::path::full()
        .and(warp::header::headers_cloned())
        .and(warp::addr::remote())
        .and_then(
            move |path: warp::path::FullPath, headers: HeaderMap, remote: Option<SocketAddr>| {
                let mode = mode.clone();
                async move {
                    Ok::<_, Rejection>(verdict(&mode, path.as_str(), &headers, remote).await)
                }
            },
        )
}

async fn verdict(
    mode: &AuthMode,
    path: &str,
    headers: &HeaderMap,
    remote: Option<SocketAddr>,
) -> GuardVerdict {
    if !is_protected_path(path) {
        return GuardVerdict::Proceed(None);
    }
    match mode {
        AuthMode::Disabled => GuardVerdict::Proceed(None),
        AuthMode::Misconfigured(message) => {
            GuardVerdict::Immediate(error(StatusCode::SERVICE_UNAVAILABLE, message))
        }
        AuthMode::Enabled(auth) => {
            let ip = client_ip(headers, remote);
            match auth.authenticate(headers, ip.as_deref()).await {
                Some(found) => GuardVerdict::Proceed(found.renew_cookie),
                None => {
                    let mut response = error(StatusCode::UNAUTHORIZED, "sign in to homectl");
                    response.headers_mut().insert(
                        "www-authenticate",
                        HeaderValue::from_static("Bearer realm=\"homectl\""),
                    );
                    GuardVerdict::Immediate(response)
                }
            }
        }
    }
}

/// For long-lived connections (websockets): the authenticated principal, so
/// the connection can be closed when it is revoked or expires.
pub fn with_principal(
    mode: AuthMode,
) -> impl Filter<Extract = (Option<(Arc<Auth>, Principal)>,), Error = Rejection> + Clone {
    warp::header::headers_cloned()
        .and(warp::addr::remote())
        .and_then(move |headers: HeaderMap, remote: Option<SocketAddr>| {
            let mode = mode.clone();
            async move {
                match mode {
                    AuthMode::Enabled(auth) => {
                        let ip = client_ip(&headers, remote);
                        match auth.authenticate(&headers, ip.as_deref()).await {
                            Some(found) => Ok(Some((auth.clone(), found.principal))),
                            None => Err(warp::reject::not_found()),
                        }
                    }
                    _ => Ok(None),
                }
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn return_paths_stay_on_this_origin() {
        let s = |v: &str| safe_return_path(Some(&v.to_string()));
        assert_eq!(s("/pair?code=AB"), "/pair?code=AB");
        assert_eq!(s("//evil.example.org"), "/");
        assert_eq!(s("/\\evil.example.org"), "/");
        assert_eq!(s("https://evil.example.org"), "/");
        assert_eq!(s("/auth/login"), "/");
        assert_eq!(safe_return_path(None), "/");
    }

    #[test]
    fn protects_api_and_websocket_only() {
        assert!(is_protected_path("/api/v1/devices"));
        assert!(is_protected_path("/api/config"));
        assert!(is_protected_path("/ws"));
        assert!(!is_protected_path("/health/ready"));
        assert!(!is_protected_path("/auth/me"));
        assert!(!is_protected_path("/"));
        assert!(!is_protected_path("/assets/index.js"));
        assert!(!is_protected_path("/apix"));
    }

    #[test]
    fn device_names_are_trimmed_and_bounded() {
        assert_eq!(
            clean_name(Some("  Hall\u{7}way  ")).as_deref(),
            Some("Hallway")
        );
        assert_eq!(clean_name(Some("   ")), None);
        assert_eq!(
            clean_name(Some(&"x".repeat(200))).unwrap().len(),
            MAX_DEVICE_NAME
        );
    }
}
