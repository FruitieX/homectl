//! End-to-end authentication tests against a real server process and a mock
//! OIDC provider: person sign-in (allowed and refused groups), machine
//! tokens, and the device pairing handshake including revocation and
//! persistence across a restart.

mod common;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use common::{TestServer, TestServerConfig};
use reqwest::blocking::{Client, Response};
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use warp::Filter;

const PUBLIC_URL: &str = "http://homectl.test";
const CLIENT_SECRET: &str = "mock-client-secret";
const MACHINE_TOKEN: &str = "machine-token-0123456789";

#[derive(Clone)]
struct Grant {
    nonce: String,
    challenge: String,
    user: String,
}

/// A tiny OIDC provider. `/authorize?user=<name>` signs that user in
/// immediately and redirects back with a code.
fn start_mock_provider() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let issuer = format!("http://127.0.0.1:{port}");
    let grants: Arc<Mutex<HashMap<String, Grant>>> = Arc::default();

    let discovery = {
        let issuer = issuer.clone();
        warp::path!(".well-known" / "openid-configuration").map(move || {
            warp::reply::json(&json!({
                "issuer": issuer,
                "authorization_endpoint": format!("{issuer}/authorize"),
                "token_endpoint": format!("{issuer}/token"),
            }))
        })
    };
    let authorize = {
        let grants = grants.clone();
        warp::path!("authorize")
            .and(warp::query::<HashMap<String, String>>())
            .map(move |q: HashMap<String, String>| {
                assert_eq!(q["client_id"], "homectl");
                assert_eq!(q["code_challenge_method"], "S256");
                assert_eq!(q["redirect_uri"], format!("{PUBLIC_URL}/auth/callback"));
                let code = format!("code-{}", grants.lock().unwrap().len());
                grants.lock().unwrap().insert(
                    code.clone(),
                    Grant {
                        nonce: q["nonce"].clone(),
                        challenge: q["code_challenge"].clone(),
                        user: q.get("user").cloned().unwrap_or_else(|| "rasse".into()),
                    },
                );
                let location = format!("{}?code={code}&state={}", q["redirect_uri"], q["state"]);
                warp::http::Response::builder()
                    .status(302)
                    .header("location", location)
                    .body(String::new())
                    .unwrap()
            })
    };
    let token = {
        let grants = grants.clone();
        let issuer = issuer.clone();
        warp::path!("token")
            .and(warp::post())
            .and(warp::body::form::<HashMap<String, String>>())
            .map(move |form: HashMap<String, String>| {
                let grant = grants.lock().unwrap().remove(&form["code"]);
                let Some(grant) = grant else {
                    return warp::reply::with_status(
                        warp::reply::json(&json!({"error": "invalid_grant"})),
                        warp::http::StatusCode::BAD_REQUEST,
                    );
                };
                let challenge = URL_SAFE_NO_PAD.encode(ring::digest::digest(
                    &ring::digest::SHA256,
                    form["code_verifier"].as_bytes(),
                ));
                assert_eq!(challenge, grant.challenge, "PKCE verifier must match");
                assert_eq!(form["client_secret"], CLIENT_SECRET);
                let groups = match grant.user.as_str() {
                    "rasse" => vec!["admins", "family"],
                    "julle" => vec!["family"],
                    _ => vec!["kids"],
                };
                let exp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    + 300;
                let claims = json!({
                    "iss": issuer, "sub": format!("sub-{}", grant.user), "aud": "homectl",
                    "exp": exp, "nonce": grant.nonce, "name": grant.user,
                    "preferred_username": grant.user, "groups": groups,
                });
                let id_token = format!(
                    "e30.{}.sig",
                    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
                );
                warp::reply::with_status(
                    warp::reply::json(
                        &json!({"id_token": id_token, "access_token": "a", "token_type": "Bearer"}),
                    ),
                    warp::http::StatusCode::OK,
                )
            })
    };

    let routes = discovery.or(authorize).or(token);
    std::thread::spawn(move || {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(warp::serve(routes).run(([127, 0, 0, 1], port)));
    });
    // Wait for the provider to listen.
    for _ in 0..100 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    issuer
}

fn auth_env(issuer: &str) -> Vec<(String, String)> {
    vec![
        ("HOMECTL_OIDC_ISSUER".into(), issuer.into()),
        ("HOMECTL_OIDC_CLIENT_ID".into(), "homectl".into()),
        ("HOMECTL_OIDC_CLIENT_SECRET".into(), CLIENT_SECRET.into()),
        ("HOMECTL_PUBLIC_URL".into(), PUBLIC_URL.into()),
        ("HOMECTL_OIDC_ALLOWED_GROUPS".into(), "family".into()),
        ("HOMECTL_API_TOKENS".into(), format!("cli:{MACHINE_TOKEN}")),
    ]
}

fn client() -> Client {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

/// `name=value` of a `Set-Cookie` header with the given cookie name.
fn set_cookie(response: &Response, name: &str) -> Option<String> {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap().to_string())
        .find(|pair| pair.starts_with(&format!("{name}=")) && pair.len() > name.len() + 1)
}

/// Sign in through the mock provider as `user`; returns the final callback
/// response.
fn sign_in(server: &TestServer, user: &str) -> Response {
    let client = client();
    let login = client
        .get(format!("{}/auth/login?return=/config", server.base_url))
        .send()
        .unwrap();
    assert_eq!(login.status(), StatusCode::FOUND);
    let state_cookie = set_cookie(&login, "homectl_oidc").expect("state cookie");
    let authorize = login.headers()[LOCATION].to_str().unwrap().to_string();
    let provider = client
        .get(format!("{authorize}&user={user}"))
        .send()
        .unwrap();
    assert_eq!(provider.status(), StatusCode::FOUND);
    let callback = provider.headers()[LOCATION]
        .to_str()
        .unwrap()
        .replace(PUBLIC_URL, &server.base_url);
    client
        .get(callback)
        .header(COOKIE, state_cookie)
        .send()
        .unwrap()
}

fn session_for(server: &TestServer, user: &str) -> String {
    let callback = sign_in(server, user);
    assert_eq!(callback.status(), StatusCode::FOUND);
    assert_eq!(callback.headers()[LOCATION], "/config");
    set_cookie(&callback, "homectl_session").expect("session cookie")
}

fn get(server: &TestServer, path: &str, cookie: Option<&str>, bearer: Option<&str>) -> Response {
    let mut request = client().get(format!("{}{path}", server.base_url));
    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie);
    }
    if let Some(bearer) = bearer {
        request = request.bearer_auth(bearer);
    }
    request.send().unwrap()
}

fn post(server: &TestServer, path: &str, cookie: Option<&str>, body: Value) -> Response {
    let mut request = client()
        .post(format!("{}{path}", server.base_url))
        .json(&body);
    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie);
    }
    request.send().unwrap()
}

#[test]
fn auth_is_off_without_oidc_config() {
    let server = TestServer::new().unwrap();
    let me: Value = get(&server, "/auth/me", None, None).json().unwrap();
    assert_eq!(me["enabled"], false);
    assert_eq!(
        get(&server, "/api/v1/devices", None, None).status(),
        StatusCode::OK
    );
}

#[test]
fn partial_oidc_config_fails_closed() {
    let server = TestServer::with_config(TestServerConfig {
        extra_env: vec![("HOMECTL_OIDC_ISSUER".into(), "http://127.0.0.1:1".into())],
        ..Default::default()
    })
    .unwrap();
    assert_eq!(
        get(&server, "/api/v1/devices", None, None).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        get(&server, "/health/live", None, None).status(),
        StatusCode::OK
    );
}

#[test]
fn person_sign_in_and_machine_tokens() {
    let issuer = start_mock_provider();
    let server = TestServer::with_config(TestServerConfig {
        extra_env: auth_env(&issuer),
        ..Default::default()
    })
    .unwrap();

    // Without credentials: API, config and websocket are refused; health,
    // the auth status and the UI shell stay public.
    assert_eq!(
        get(&server, "/api/v1/devices", None, None).status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&server, "/api/config", None, None).status(),
        StatusCode::UNAUTHORIZED
    );
    let ws = client()
        .get(format!("{}/ws", server.base_url))
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .send()
        .unwrap();
    assert_eq!(ws.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        get(&server, "/health/ready", None, None).status(),
        StatusCode::OK
    );
    let me: Value = get(&server, "/auth/me", None, None).json().unwrap();
    assert_eq!(me, json!({"enabled": true, "authenticated": false}));

    // A family admin signs in.
    let rasse = session_for(&server, "rasse");
    assert_eq!(
        get(&server, "/api/v1/devices", Some(&rasse), None).status(),
        StatusCode::OK
    );
    let me: Value = get(&server, "/auth/me", Some(&rasse), None).json().unwrap();
    assert_eq!(me["kind"], "user");
    assert_eq!(me["username"], "rasse");
    assert_eq!(me["admin"], true);

    // A family member who is not an admin can use homectl but not manage devices.
    let julle = session_for(&server, "julle");
    assert_eq!(
        get(&server, "/api/v1/devices", Some(&julle), None).status(),
        StatusCode::OK
    );
    assert_eq!(
        get(&server, "/auth/devices", Some(&julle), None).status(),
        StatusCode::FORBIDDEN
    );

    // A user outside the allowed groups is refused and gets no session.
    let refused = sign_in(&server, "ada");
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    assert!(set_cookie(&refused, "homectl_session").is_none());

    // A forged or tampered session is ignored.
    let tampered = format!("{}x", rasse);
    assert_eq!(
        get(&server, "/api/v1/devices", Some(&tampered), None).status(),
        StatusCode::UNAUTHORIZED
    );

    // Logging out clears the cookie.
    let logout = post(&server, "/auth/logout", Some(&rasse), json!({}));
    assert!(logout
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .any(|v| v.to_str().unwrap().starts_with("homectl_session=;")));

    // Machine tokens work as bearer tokens.
    assert_eq!(
        get(&server, "/api/v1/devices", None, Some(MACHINE_TOKEN)).status(),
        StatusCode::OK
    );
    assert_eq!(
        get(&server, "/api/v1/devices", None, Some("wrong")).status(),
        StatusCode::UNAUTHORIZED
    );
}

#[test]
fn device_pairing_approval_revocation_and_restart() {
    let issuer = start_mock_provider();
    let dir = std::env::temp_dir().join(format!("homectl_auth_pairing_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let config = || TestServerConfig {
        extra_env: auth_env(&issuer),
        working_dir: Some(dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    };
    let mut server = TestServer::with_config(config()).unwrap();

    // The tablet asks to pair.
    let start: Value = post(
        &server,
        "/auth/pair/start",
        None,
        json!({"name": "Hallway tablet"}),
    )
    .json()
    .unwrap();
    let pairing_id = start["pairingId"].as_str().unwrap().to_string();
    let code = start["code"].as_str().unwrap().to_string();
    assert_eq!(
        start["approveUrl"],
        format!("{PUBLIC_URL}/pair?code={code}")
    );
    let poll = |server: &TestServer| {
        post(
            server,
            "/auth/pair/poll",
            None,
            json!({"pairingId": pairing_id}),
        )
    };
    assert_eq!(poll(&server).json::<Value>().unwrap()["status"], "pending");

    // Approval needs an admin person session.
    let approve = json!({"code": code.to_lowercase(), "name": "Hallway"});
    assert_eq!(
        post(&server, "/auth/pair/approve", None, approve.clone()).status(),
        StatusCode::UNAUTHORIZED
    );
    let julle = session_for(&server, "julle");
    assert_eq!(
        post(&server, "/auth/pair/approve", Some(&julle), approve.clone()).status(),
        StatusCode::FORBIDDEN
    );
    let rasse = session_for(&server, "rasse");
    let details: Value = get(
        &server,
        &format!("/auth/pair/request?code={code}"),
        Some(&rasse),
        None,
    )
    .json()
    .unwrap();
    assert_eq!(details["requestedName"], "Hallway tablet");
    let approved = post(&server, "/auth/pair/approve", Some(&rasse), approve.clone());
    assert_eq!(approved.status(), StatusCode::OK);
    let device_id = approved.json::<Value>().unwrap()["device"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    // The same code cannot be approved twice.
    assert_eq!(
        post(&server, "/auth/pair/approve", Some(&rasse), approve).status(),
        StatusCode::NOT_FOUND
    );

    // The tablet's next poll receives its credential, once.
    let polled = poll(&server);
    let device_cookie = set_cookie(&polled, "homectl_device").expect("device cookie");
    let body: Value = polled.json().unwrap();
    assert_eq!(body["status"], "approved");
    assert_eq!(body["device"]["name"], "Hallway");
    let token = body["token"].as_str().unwrap().to_string();
    assert!(token.starts_with("hcd_"));
    assert_eq!(poll(&server).json::<Value>().unwrap()["status"], "expired");

    // The credential works as a cookie (browsers) and as a bearer token.
    assert_eq!(
        get(&server, "/api/v1/devices", Some(&device_cookie), None).status(),
        StatusCode::OK
    );
    assert_eq!(
        get(&server, "/api/v1/devices", None, Some(&token)).status(),
        StatusCode::OK
    );
    let me: Value = get(&server, "/auth/me", Some(&device_cookie), None)
        .json()
        .unwrap();
    assert_eq!(me["kind"], "device");
    assert_eq!(me["admin"], false);
    // Devices cannot manage devices.
    assert_eq!(
        get(&server, "/auth/devices", Some(&device_cookie), None).status(),
        StatusCode::FORBIDDEN
    );

    // It survives a restart (persisted in the database).
    server.stop();
    let server = TestServer::with_config(config()).unwrap();
    assert_eq!(
        get(&server, "/api/v1/devices", None, Some(&token)).status(),
        StatusCode::OK
    );

    // The Devices list shows it with last-seen data; revoking ends access.
    let rasse = session_for(&server, "rasse");
    let list: Value = get(&server, "/auth/devices", Some(&rasse), None)
        .json()
        .unwrap();
    assert_eq!(list["devices"][0]["id"], device_id);
    assert_eq!(list["devices"][0]["createdBy"], "rasse");
    assert!(list["devices"][0]["lastSeenAt"].is_string());
    assert_eq!(list["apiTokens"], json!(["cli"]));
    let revoke = client()
        .delete(format!("{}/auth/devices/{device_id}", server.base_url))
        .header(COOKIE, &rasse)
        .send()
        .unwrap();
    assert_eq!(revoke.status(), StatusCode::OK);
    assert_eq!(
        get(&server, "/api/v1/devices", None, Some(&token)).status(),
        StatusCode::UNAUTHORIZED
    );

    // A denied pairing reports so to the tablet.
    let start: Value = post(&server, "/auth/pair/start", None, json!({}))
        .json()
        .unwrap();
    let deny = post(
        &server,
        "/auth/pair/deny",
        Some(&rasse),
        json!({"code": start["code"]}),
    );
    assert_eq!(deny.status(), StatusCode::OK);
    let polled: Value = post(
        &server,
        "/auth/pair/poll",
        None,
        json!({"pairingId": start["pairingId"]}),
    )
    .json()
    .unwrap();
    assert_eq!(polled["status"], "denied");

    drop(server);
    let _ = std::fs::remove_dir_all(&dir);
}
