//! Optional authentication.
//!
//! With no OIDC configuration homectl behaves as it always has: no login, and
//! the API is open to the local network. When `HOMECTL_OIDC_*` and
//! `HOMECTL_PUBLIC_URL` are set, every `/api` and `/ws` request needs one of:
//!
//! - a person session (`homectl_session` cookie) issued after signing in with
//!   the OIDC provider (Pocket ID); sliding, ~365 days;
//! - a paired device credential (`homectl_device` cookie or
//!   `Authorization: Bearer hcd_…`), created by an admin approving a pairing
//!   code; revocable, no expiry;
//! - a machine token from `HOMECTL_API_TOKENS` (`Authorization: Bearer …`).
//!
//! Health checks, the static UI shell and `/auth/*` stay public so the
//! browser can show the sign-in and pairing screens.

pub mod devices;
pub mod oidc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{hmac, rand::SecureRandom};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use warp::http::HeaderMap;

use devices::{DeviceStore, PairingStore};
use oidc::{Oidc, OidcConfig};

pub const SESSION_COOKIE: &str = "homectl_session";
pub const DEVICE_COOKIE: &str = "homectl_device";
pub const STATE_COOKIE: &str = "homectl_oidc";
/// Person sessions slide: a use more than a day after issue renews them.
pub const SESSION_SECONDS: u64 = 365 * 24 * 3600;
pub const SESSION_RENEW_AFTER: u64 = 24 * 3600;
/// Browsers cap cookie lifetimes at about 400 days; the device cookie is
/// re-issued while it is in use, and the credential itself never expires.
pub const DEVICE_COOKIE_SECONDS: u64 = 400 * 24 * 3600;

pub const ENV_ISSUER: &str = "HOMECTL_OIDC_ISSUER";
pub const ENV_CLIENT_ID: &str = "HOMECTL_OIDC_CLIENT_ID";
pub const ENV_CLIENT_SECRET: &str = "HOMECTL_OIDC_CLIENT_SECRET";
pub const ENV_PUBLIC_URL: &str = "HOMECTL_PUBLIC_URL";
pub const ENV_ALLOWED_GROUPS: &str = "HOMECTL_OIDC_ALLOWED_GROUPS";
pub const ENV_ADMIN_GROUPS: &str = "HOMECTL_OIDC_ADMIN_GROUPS";
pub const ENV_API_TOKENS: &str = "HOMECTL_API_TOKENS";

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

pub(crate) fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .expect("system randomness");
    bytes
}

pub fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

/// Hex SHA-256, used to store and compare bearer secrets.
pub fn hash_token(token: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, token.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Signs cookies with a key derived from the OIDC client secret, so rotating
/// the secret signs every person session out.
pub struct Signer(hmac::Key);

impl Signer {
    pub fn new(secret: &str) -> Self {
        let root = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
        let derived = hmac::sign(&root, b"homectl cookie key v1");
        Self(hmac::Key::new(hmac::HMAC_SHA256, derived.as_ref()))
    }

    /// `kind` keeps one cookie's value from being replayed as another's.
    pub fn sign<T: Serialize>(&self, kind: &str, value: &T) -> String {
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).expect("serializable"));
        let tag = hmac::sign(&self.0, format!("{kind}.{payload}").as_bytes());
        format!("{payload}.{}", URL_SAFE_NO_PAD.encode(tag.as_ref()))
    }

    /// Returns the value if the signature matches; callers check expiry.
    pub fn verify<T: DeserializeOwned>(&self, kind: &str, cookie: &str) -> Option<T> {
        let (payload, tag) = cookie.split_once('.')?;
        let tag = URL_SAFE_NO_PAD.decode(tag).ok()?;
        hmac::verify(&self.0, format!("{kind}.{payload}").as_bytes(), &tag).ok()?;
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
    }
}

/// A signed-in person, as stored in the session cookie.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session {
    /// Provider issuer and subject identify the person.
    pub iss: String,
    pub sub: String,
    pub username: String,
    pub name: String,
    pub admin: bool,
    /// Issued at; the session is renewed once this is a day old.
    pub iat: u64,
    pub exp: u64,
}

/// Who is making a request.
#[derive(Clone, Debug)]
pub enum Principal {
    User(Session),
    Device { id: String, name: String },
    Token { name: String },
}

impl Principal {
    pub fn kind(&self) -> &'static str {
        match self {
            Principal::User(_) => "user",
            Principal::Device { .. } => "device",
            Principal::Token { .. } => "token",
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Principal::User(session) => &session.name,
            Principal::Device { name, .. } | Principal::Token { name } => name,
        }
    }

    pub fn is_admin(&self) -> bool {
        matches!(self, Principal::User(session) if session.admin)
    }
}

/// A named machine token from `HOMECTL_API_TOKENS`.
#[derive(Clone, Debug)]
pub struct ApiToken {
    pub name: String,
    pub hash: String,
}

/// Parse `name:token,name2:token2`. A bare token is named `token-<n>`.
pub fn parse_api_tokens(value: &str) -> Vec<ApiToken> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .enumerate()
        .map(|(index, entry)| match entry.split_once(':') {
            Some((name, token)) if !name.trim().is_empty() && !token.trim().is_empty() => {
                ApiToken {
                    name: name.trim().to_string(),
                    hash: hash_token(token.trim()),
                }
            }
            _ => ApiToken {
                name: format!("token-{}", index + 1),
                hash: hash_token(entry),
            },
        })
        .collect()
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect()
}

pub struct Auth {
    pub oidc: Oidc,
    pub signer: Signer,
    pub public_url: String,
    pub api_tokens: Vec<ApiToken>,
    pub devices: DeviceStore,
    pub pairings: PairingStore,
}

/// Outcome of reading the auth configuration.
#[derive(Clone)]
pub enum AuthMode {
    /// No OIDC configuration: no authentication at all (previous behaviour).
    Disabled,
    Enabled(Arc<Auth>),
    /// Some but not all OIDC settings are present. The API refuses requests
    /// rather than silently running open; automations keep running.
    Misconfigured(Arc<String>),
}

/// The result of authenticating one request.
pub struct Authenticated {
    pub principal: Principal,
    /// A `Set-Cookie` value that renews the credential, when due.
    pub renew_cookie: Option<String>,
}

pub fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get("authorization")?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("bearer")
        .then(|| token.trim())
        .filter(|token| !token.is_empty())
}

/// Whether the request reached us over HTTPS (behind the gateway).
pub fn is_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("https"))
}

/// The client address for display: the first `X-Forwarded-For` hop, else the
/// socket peer.
pub fn client_ip(headers: &HeaderMap, remote: Option<std::net::SocketAddr>) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| remote.map(|addr| addr.ip().to_string()))
}

impl AuthMode {
    pub fn from_env() -> Self {
        let var = |name: &str| {
            env::var(name)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let issuer = var(ENV_ISSUER);
        let client_id = var(ENV_CLIENT_ID);
        let client_secret = var(ENV_CLIENT_SECRET);
        let public_url = var(ENV_PUBLIC_URL);
        let configured = [&issuer, &client_id, &client_secret, &public_url];
        if configured.iter().all(|value| value.is_none()) {
            if var(ENV_API_TOKENS).is_some() {
                warn!(
                    "{ENV_API_TOKENS} is set but OIDC is not configured; authentication stays off"
                );
            }
            return AuthMode::Disabled;
        }
        let (Some(issuer), Some(client_id), Some(client_secret), Some(public_url)) =
            (issuer, client_id, client_secret, public_url)
        else {
            let message = format!(
                "Authentication is partially configured: {ENV_ISSUER}, {ENV_CLIENT_ID}, {ENV_CLIENT_SECRET} and {ENV_PUBLIC_URL} are all required"
            );
            error!("{message}; the API refuses requests until this is fixed");
            return AuthMode::Misconfigured(Arc::new(message));
        };
        let public_url = public_url.trim_end_matches('/').to_string();
        let allowed_groups = split_list(&var(ENV_ALLOWED_GROUPS).unwrap_or_default());
        let admin_groups = match env::var(ENV_ADMIN_GROUPS) {
            Ok(value) => split_list(&value),
            Err(_) => vec!["admins".to_string()],
        };
        let api_tokens = parse_api_tokens(&var(ENV_API_TOKENS).unwrap_or_default());
        info!(
            "Authentication enabled: OIDC issuer {issuer}, allowed groups [{}], admin groups [{}], {} machine token(s)",
            allowed_groups.join(", "),
            admin_groups.join(", "),
            api_tokens.len()
        );
        AuthMode::Enabled(Arc::new(Auth::new(
            OidcConfig {
                issuer,
                client_id,
                redirect_url: format!("{public_url}/auth/callback"),
                client_secret: client_secret.clone(),
                allowed_groups,
                admin_groups,
            },
            &client_secret,
            public_url,
            api_tokens,
        )))
    }

    pub fn is_enabled(&self) -> bool {
        !matches!(self, AuthMode::Disabled)
    }
}

impl Auth {
    pub fn new(
        config: OidcConfig,
        signing_secret: &str,
        public_url: String,
        api_tokens: Vec<ApiToken>,
    ) -> Self {
        Self {
            oidc: Oidc::new(config),
            signer: Signer::new(signing_secret),
            public_url,
            api_tokens,
            devices: DeviceStore::default(),
            pairings: PairingStore::default(),
        }
    }

    fn secure_session_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }

    pub fn session_cookie(&self, session: &Session) -> String {
        format!(
            "{SESSION_COOKIE}={}; Path=/; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Lax{}",
            self.signer.sign(SESSION_COOKIE, session),
            if self.secure_session_cookies() {
                "; Secure"
            } else {
                ""
            }
        )
    }

    pub fn state_cookie(&self, login: &oidc::LoginState) -> String {
        format!(
            "{STATE_COOKIE}={}; Path=/auth; Max-Age={}; HttpOnly; SameSite=Lax{}",
            self.signer.sign(STATE_COOKIE, login),
            oidc::STATE_SECONDS,
            if self.secure_session_cookies() {
                "; Secure"
            } else {
                ""
            }
        )
    }

    pub fn clear_cookie(name: &str, path: &str) -> String {
        format!("{name}=; Path={path}; Max-Age=0; HttpOnly; SameSite=Lax")
    }

    pub fn device_cookie(token: &str, secure: bool) -> String {
        format!(
            "{DEVICE_COOKIE}={token}; Path=/; Max-Age={DEVICE_COOKIE_SECONDS}; HttpOnly; SameSite=Lax{}",
            if secure { "; Secure" } else { "" }
        )
    }

    pub fn new_session(&self, identity: oidc::Identity) -> Session {
        let now = now();
        Session {
            iss: self.oidc.config.issuer.clone(),
            sub: identity.sub,
            username: identity.username,
            name: identity.name,
            admin: identity.admin,
            iat: now,
            exp: now + SESSION_SECONDS,
        }
    }

    pub fn session(&self, headers: &HeaderMap) -> Option<Session> {
        let session: Session = self
            .signer
            .verify(SESSION_COOKIE, cookie(headers, SESSION_COOKIE)?)?;
        (session.exp > now() && session.iss == self.oidc.config.issuer).then_some(session)
    }

    fn token_principal(
        &self,
        token: &str,
        ip: Option<&str>,
        via_cookie: bool,
        secure: bool,
    ) -> Option<Authenticated> {
        if token.starts_with(devices::DEVICE_TOKEN_PREFIX) {
            let found = self.devices.lookup(token, ip)?;
            return Some(Authenticated {
                renew_cookie: (via_cookie && found.renew_cookie)
                    .then(|| Self::device_cookie(token, secure)),
                principal: Principal::Device {
                    id: found.id,
                    name: found.name,
                },
            });
        }
        let hash = hash_token(token);
        // Comparing SHA-256 digests: timing differences reveal nothing
        // useful about the token itself.
        let matched = self
            .api_tokens
            .iter()
            .find(|candidate| candidate.hash == hash)?;
        Some(Authenticated {
            principal: Principal::Token {
                name: matched.name.clone(),
            },
            renew_cookie: None,
        })
    }

    /// Identify the caller from a bearer token, a device cookie or a person
    /// session cookie, in that order.
    pub async fn authenticate(
        &self,
        headers: &HeaderMap,
        ip: Option<&str>,
    ) -> Option<Authenticated> {
        self.devices.ensure_loaded().await;
        let secure = is_https(headers);
        if let Some(token) = bearer(headers) {
            return self.token_principal(token, ip, false, secure);
        }
        if let Some(token) = cookie(headers, DEVICE_COOKIE) {
            if let Some(found) = self.token_principal(token, ip, true, secure) {
                return Some(found);
            }
        }
        let session = self.session(headers)?;
        let renew_cookie = (now().saturating_sub(session.iat) >= SESSION_RENEW_AFTER).then(|| {
            let now = now();
            self.session_cookie(&Session {
                iat: now,
                exp: now + SESSION_SECONDS,
                ..session.clone()
            })
        });
        Some(Authenticated {
            principal: Principal::User(session),
            renew_cookie,
        })
    }

    /// Whether a principal authenticated earlier (e.g. for a websocket) is
    /// still valid: devices can be revoked and sessions expire.
    pub fn still_valid(&self, principal: &Principal) -> bool {
        match principal {
            Principal::User(session) => session.exp > now(),
            Principal::Device { id, .. } => self.devices.contains_id(id),
            Principal::Token { .. } => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use warp::http::HeaderValue;

    fn auth(tokens: &str) -> Auth {
        Auth::new(
            OidcConfig {
                issuer: "https://id.example.org".into(),
                client_id: "homectl".into(),
                client_secret: "secret-0123456789".into(),
                redirect_url: "https://homectl.example.org/auth/callback".into(),
                allowed_groups: vec!["family".into()],
                admin_groups: vec!["admins".into()],
            },
            "secret-0123456789",
            "https://homectl.example.org".into(),
            parse_api_tokens(tokens),
        )
    }

    fn headers(pairs: &[(&'static str, String)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    fn session(iat: u64) -> Session {
        Session {
            iss: "https://id.example.org".into(),
            sub: "u1".into(),
            username: "rasse".into(),
            name: "Rasse".into(),
            admin: true,
            iat,
            exp: iat + SESSION_SECONDS,
        }
    }

    #[test]
    fn signed_cookies_round_trip_and_reject_tampering() {
        let signer = Signer::new("secret-0123456789");
        let value = session(5);
        let signed = signer.sign(SESSION_COOKIE, &value);
        assert_eq!(
            signer.verify::<Session>(SESSION_COOKIE, &signed),
            Some(value)
        );
        assert!(signer.verify::<Session>(STATE_COOKIE, &signed).is_none());
        assert!(Signer::new("another-secret")
            .verify::<Session>(SESSION_COOKIE, &signed)
            .is_none());
        let tampered = format!("e30{}", &signed[3..]);
        assert!(signer
            .verify::<Session>(SESSION_COOKIE, &tampered)
            .is_none());
    }

    #[test]
    fn parses_named_and_bare_api_tokens() {
        let tokens = parse_api_tokens(" cli:abc , def ,");
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].name, "cli");
        assert_eq!(tokens[0].hash, hash_token("abc"));
        assert_eq!(tokens[1].name, "token-2");
    }

    #[tokio::test]
    async fn authenticates_sessions_tokens_and_devices() {
        let auth = auth("cli:machine-secret");
        assert!(auth.authenticate(&HeaderMap::new(), None).await.is_none());

        // Fresh session: valid, no renewal.
        let fresh = auth.session_cookie(&session(now()));
        let cookie_value = fresh.split(';').next().unwrap().to_string();
        let found = auth
            .authenticate(&headers(&[("cookie", cookie_value)]), None)
            .await
            .unwrap();
        assert!(found.principal.is_admin());
        assert!(found.renew_cookie.is_none());

        // Two-day-old session slides forward.
        let old = auth.session_cookie(&session(now() - 2 * 24 * 3600));
        let found = auth
            .authenticate(
                &headers(&[("cookie", old.split(';').next().unwrap().to_string())]),
                None,
            )
            .await
            .unwrap();
        assert!(found.renew_cookie.unwrap().contains("Secure"));

        // Expired or foreign-issuer sessions are ignored.
        let mut expired = session(now() - SESSION_SECONDS - 10);
        expired.exp = now() - 1;
        let value = auth.signer.sign(SESSION_COOKIE, &expired);
        assert!(auth
            .authenticate(
                &headers(&[("cookie", format!("{SESSION_COOKIE}={value}"))]),
                None
            )
            .await
            .is_none());

        // Machine token.
        let found = auth
            .authenticate(
                &headers(&[("authorization", "Bearer machine-secret".into())]),
                None,
            )
            .await
            .unwrap();
        assert_eq!(found.principal.kind(), "token");
        assert_eq!(found.principal.name(), "cli");
        assert!(auth
            .authenticate(&headers(&[("authorization", "Bearer nope".into())]), None)
            .await
            .is_none());

        // Device via cookie and bearer; revocation ends both.
        let (record, token) = auth.devices.create("Tablet", "rasse", None);
        let via_cookie = auth
            .authenticate(
                &headers(&[("cookie", format!("other=1; {DEVICE_COOKIE}={token}"))]),
                Some("192.168.1.5"),
            )
            .await
            .unwrap();
        assert_eq!(via_cookie.principal.kind(), "device");
        assert!(!via_cookie.principal.is_admin());
        let principal = via_cookie.principal;
        assert!(auth.still_valid(&principal));
        auth.devices.revoke(&record.id).await.unwrap();
        assert!(!auth.still_valid(&principal));
        assert!(auth
            .authenticate(
                &headers(&[("authorization", format!("Bearer {token}"))]),
                None
            )
            .await
            .is_none());
    }
}
