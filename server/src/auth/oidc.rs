//! Person sign-in through an OpenID Connect provider (Pocket ID):
//! authorization code flow with PKCE and a nonce. The result is homectl's own
//! signed session cookie; provider tokens are not kept.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use color_eyre::Result;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::Mutex;

use super::{now, random_token};

/// Lifetime of the short-lived cookie that carries [`LoginState`].
pub const STATE_SECONDS: u64 = 600;

#[derive(Clone, Debug)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    /// Where the provider sends the browser back to (`…/auth/callback`).
    pub redirect_url: String,
    /// Sign-in needs membership in one of these groups; empty allows anyone
    /// the provider lets through.
    pub allowed_groups: Vec<String>,
    /// Members of these groups may manage paired devices.
    pub admin_groups: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
}

/// Login state kept in a short-lived signed cookie between `/auth/login` and
/// the callback.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LoginState {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    /// Same-origin path to return to after signing in.
    pub return_to: String,
    pub exp: u64,
}

/// Who signed in, as checked from the ID token.
#[derive(Clone, Debug, PartialEq)]
pub struct Identity {
    pub sub: String,
    pub username: String,
    pub name: String,
    pub admin: bool,
}

/// Why a sign-in was refused. `NotAllowed` is the expected outcome for a
/// provider user outside the allowed groups and is shown as such.
#[derive(Debug)]
pub enum SignInError {
    NotAllowed(String),
    Failed(String),
}

impl std::fmt::Display for SignInError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SignInError::NotAllowed(message) | SignInError::Failed(message) => f.write_str(message),
        }
    }
}

#[derive(Deserialize)]
struct IdClaims {
    iss: String,
    sub: String,
    aud: Audience,
    exp: u64,
    nonce: Option<String>,
    name: Option<String>,
    preferred_username: Option<String>,
    #[serde(default)]
    groups: Vec<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, id: &str) -> bool {
        match self {
            Audience::One(aud) => aud == id,
            Audience::Many(auds) => auds.iter().any(|aud| aud == id),
        }
    }
}

pub struct Oidc {
    pub config: OidcConfig,
    discovery: Mutex<Option<Discovery>>,
    http: reqwest::Client,
}

pub(crate) fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        verifier.as_bytes(),
    ))
}

pub(crate) fn form_encode(pairs: &[(&str, &str)]) -> String {
    fn encode(s: &str) -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

impl Oidc {
    pub fn new(config: OidcConfig) -> Self {
        Self {
            config,
            discovery: Mutex::new(None),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("homectl")
                .build()
                .unwrap_or_default(),
        }
    }

    /// Fetches the provider's metadata once and caches it.
    async fn discovery(&self) -> Result<Discovery> {
        let mut cached = self.discovery.lock().await;
        if let Some(discovery) = cached.clone() {
            return Ok(discovery);
        }
        let url = format!(
            "{}/.well-known/openid-configuration",
            self.config.issuer.trim_end_matches('/')
        );
        let discovery: Discovery = self
            .http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        *cached = Some(discovery.clone());
        Ok(discovery)
    }

    /// The provider URL to send the browser to, and the state to remember.
    pub async fn start(&self, return_to: String) -> Result<(String, LoginState)> {
        let discovery = self.discovery().await?;
        Ok(self.authorize_url(&discovery, return_to))
    }

    fn authorize_url(&self, discovery: &Discovery, return_to: String) -> (String, LoginState) {
        let login = LoginState {
            state: random_token(),
            nonce: random_token(),
            verifier: random_token(),
            return_to,
            exp: now() + STATE_SECONDS,
        };
        let challenge = pkce_challenge(&login.verifier);
        let query = form_encode(&[
            ("response_type", "code"),
            ("client_id", &self.config.client_id),
            ("redirect_uri", &self.config.redirect_url),
            ("scope", "openid profile email groups"),
            ("state", &login.state),
            ("nonce", &login.nonce),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ]);
        let separator = if discovery.authorization_endpoint.contains('?') {
            '&'
        } else {
            '?'
        };
        (
            format!("{}{separator}{query}", discovery.authorization_endpoint),
            login,
        )
    }

    /// Redeems the authorization code and checks who signed in.
    pub async fn finish(&self, login: &LoginState, code: &str) -> Result<Identity, SignInError> {
        let discovery = self
            .discovery()
            .await
            .map_err(|e| SignInError::Failed(format!("provider discovery failed: {e}")))?;
        #[derive(Deserialize)]
        struct TokenResponse {
            id_token: String,
        }
        let body = form_encode(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &self.config.redirect_url),
            ("client_id", &self.config.client_id),
            ("client_secret", &self.config.client_secret),
            ("code_verifier", &login.verifier),
        ]);
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| SignInError::Failed(format!("redeeming the code failed: {e}")))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SignInError::Failed(format!(
                "token endpoint answered {status}"
            )));
        }
        let tokens: TokenResponse = response
            .json()
            .await
            .map_err(|e| SignInError::Failed(format!("reading the token response: {e}")))?;
        self.check_id_token(&discovery, login, &tokens.id_token)
    }

    /// The ID token comes straight from the token endpoint over TLS, so its
    /// signature need not be checked (OpenID Connect Core 3.1.3.7); the
    /// claims still are.
    pub(crate) fn check_id_token(
        &self,
        discovery: &Discovery,
        login: &LoginState,
        id_token: &str,
    ) -> Result<Identity, SignInError> {
        let failed = |message: &str| SignInError::Failed(message.to_string());
        let payload = id_token
            .split('.')
            .nth(1)
            .ok_or_else(|| failed("malformed ID token"))?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| failed("malformed ID token"))?;
        let claims: IdClaims =
            serde_json::from_slice(&bytes).map_err(|_| failed("unreadable ID token claims"))?;
        if claims.iss != discovery.issuer {
            return Err(SignInError::Failed(format!(
                "ID token from unexpected issuer {}",
                claims.iss
            )));
        }
        if !claims.aud.contains(&self.config.client_id) {
            return Err(failed("ID token is for another client"));
        }
        if claims.exp <= now() {
            return Err(failed("ID token has expired"));
        }
        if claims.nonce.as_deref() != Some(login.nonce.as_str()) {
            return Err(failed("ID token nonce does not match"));
        }
        let username = claims
            .preferred_username
            .clone()
            .unwrap_or_else(|| claims.sub.clone());
        let allowed = &self.config.allowed_groups;
        if !allowed.is_empty() && !claims.groups.iter().any(|g| allowed.contains(g)) {
            return Err(SignInError::NotAllowed(format!(
                "{username} is not in a group allowed to use homectl"
            )));
        }
        let admin = claims
            .groups
            .iter()
            .any(|g| self.config.admin_groups.contains(g));
        Ok(Identity {
            name: claims
                .name
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| username.clone()),
            username,
            sub: claims.sub,
            admin,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oidc(groups: &[&str]) -> Oidc {
        Oidc::new(OidcConfig {
            issuer: "https://id.example.org".into(),
            client_id: "homectl".into(),
            client_secret: "s".into(),
            redirect_url: "https://homectl.example.org/auth/callback".into(),
            allowed_groups: groups.iter().map(|g| g.to_string()).collect(),
            admin_groups: vec!["admins".into()],
        })
    }

    fn discovery() -> Discovery {
        Discovery {
            issuer: "https://id.example.org".into(),
            authorization_endpoint: "https://id.example.org/authorize".into(),
            token_endpoint: "https://id.example.org/api/oidc/token".into(),
        }
    }

    fn login() -> LoginState {
        LoginState {
            state: "st".into(),
            nonce: "n1".into(),
            verifier: "v".into(),
            return_to: "/".into(),
            exp: now() + 60,
        }
    }

    fn token(claims: serde_json::Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        )
    }

    fn claims() -> serde_json::Value {
        serde_json::json!({
            "iss": "https://id.example.org", "sub": "u1", "aud": "homectl",
            "exp": now() + 60, "nonce": "n1", "name": "Rasse",
            "preferred_username": "rasse", "groups": ["family", "admins"],
        })
    }

    #[test]
    fn accepts_valid_id_token_and_maps_admin_group() {
        let identity = oidc(&["family"])
            .check_id_token(&discovery(), &login(), &token(claims()))
            .unwrap();
        assert_eq!(identity.sub, "u1");
        assert_eq!(identity.username, "rasse");
        assert_eq!(identity.name, "Rasse");
        assert!(identity.admin);

        let mut member = claims();
        member["groups"] = serde_json::json!(["family"]);
        let identity = oidc(&["family"])
            .check_id_token(&discovery(), &login(), &token(member))
            .unwrap();
        assert!(!identity.admin);
    }

    #[test]
    fn rejects_bad_claims() {
        let cases = [
            ("iss", serde_json::json!("https://evil.example.org")),
            ("aud", serde_json::json!(["other"])),
            ("exp", serde_json::json!(1)),
            ("nonce", serde_json::json!("n2")),
        ];
        for (key, value) in cases {
            let mut claims = claims();
            claims[key] = value;
            assert!(
                matches!(
                    oidc(&["family"]).check_id_token(&discovery(), &login(), &token(claims)),
                    Err(SignInError::Failed(_))
                ),
                "{key} should be rejected"
            );
        }
        assert!(oidc(&[])
            .check_id_token(&discovery(), &login(), "not-a-jwt")
            .is_err());
    }

    #[test]
    fn refuses_users_outside_allowed_groups() {
        let mut kid = claims();
        kid["groups"] = serde_json::json!(["kids"]);
        assert!(matches!(
            oidc(&["family"]).check_id_token(&discovery(), &login(), &token(kid.clone())),
            Err(SignInError::NotAllowed(_))
        ));
        // Without a group restriction, any provider user is fine.
        assert!(oidc(&[])
            .check_id_token(&discovery(), &login(), &token(kid))
            .is_ok());
    }

    #[test]
    fn authorize_url_uses_pkce_state_and_nonce() {
        let (url, login) = oidc(&[]).authorize_url(&discovery(), "/pair?code=X".into());
        assert!(url.starts_with("https://id.example.org/authorize?response_type=code&"));
        assert!(url.contains(&format!(
            "code_challenge={}",
            pkce_challenge(&login.verifier)
        )));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fhomectl.example.org%2Fauth%2Fcallback"));
        assert!(url.contains(&format!("state={}", login.state)));
        assert!(url.contains(&format!("nonce={}", login.nonce)));
        assert_eq!(login.return_to, "/pair?code=X");
    }
}
