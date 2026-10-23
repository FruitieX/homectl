# Authentication

Authentication is optional. With none of the `HOMECTL_OIDC_*` variables set,
homectl behaves as before: no login, and anyone who can reach the server can
use the UI and API. The origin guard (`HOMECTL_ALLOWED_ORIGINS`) still applies.

When OIDC is configured, every `/api/*` and `/ws` request needs one of:

| Credential | Who | How it is sent | Lifetime |
| --- | --- | --- | --- |
| Person session | People signing in with the OIDC provider (Pocket ID passkeys) | `homectl_session` cookie (HMAC-signed, HttpOnly) | 365 days, sliding (renewed when more than a day old) |
| Device credential | Paired wall tablets and dashboards | `homectl_device` cookie, or `Authorization: Bearer hcd_…` | No expiry; revocable |
| Machine token | Scripts, the CLI, the UI preview proxy | `Authorization: Bearer <token>` | Until removed from `HOMECTL_API_TOKENS` |

Unauthenticated `/api` and `/ws` requests get `401`. Health checks
(`/health/*`), `/auth/*` and the static UI shell stay public, so the browser can
show the sign-in and pairing screens and probes keep working.

Code: `server/src/auth/` (model, OIDC, device store) and
`server/src/api/auth.rs` (routes and guard); UI in `ui/ui/auth/AuthGate.tsx`,
`ui/app/pair/page.tsx` and `ui/app/config/paired-devices/page.tsx`.

## Configuration

| Variable | Meaning |
| --- | --- |
| `HOMECTL_OIDC_ISSUER` | Issuer URL (discovery at `<issuer>/.well-known/openid-configuration`) |
| `HOMECTL_OIDC_CLIENT_ID` | Client id |
| `HOMECTL_OIDC_CLIENT_SECRET` | Client secret (confidential client). Also derives the cookie signing key, so rotating it signs everyone out |
| `HOMECTL_PUBLIC_URL` | Public base URL, e.g. `https://homectl.example.org`. The redirect URL is `<public>/auth/callback`; pairing QR codes link to `<public>/pair?code=…` |
| `HOMECTL_OIDC_ALLOWED_GROUPS` | Comma-separated groups allowed to sign in (empty: anyone the provider lets through) |
| `HOMECTL_OIDC_ADMIN_GROUPS` | Groups that may pair and revoke devices (default `admins`; set empty to make every signed-in person an admin) |
| `HOMECTL_API_TOKENS` | Comma-separated machine tokens, `name:token,…` |

Issuer, client id, client secret and public URL are all required. If only some
are set, homectl logs an error and answers `/api` and `/ws` with `503` instead
of running open; automations keep running.

The provider client uses the authorization code flow with PKCE (S256) and a
nonce, scopes `openid profile email groups`. Claims are checked as in OIDC Core
3.1.3.7 (the ID token comes straight from the token endpoint over TLS). People
are identified by issuer and `sub`; homectl has no local user accounts.

"Admin" only gates device management (`/auth/pair/*` approval and
`/auth/devices`). Every signed-in person and paired device can otherwise use and
configure homectl as before. The admin flag is taken from the groups at sign-in
and kept for the session's lifetime.

## Device pairing

1. The unpaired display opens homectl and chooses "Set up as a wall display"
   (or opens `/pair-device`, which is a good kiosk start URL). It calls
   `POST /auth/pair/start` and shows a code like `ABCD-2345` and a QR code
   for `<public>/pair?code=ABCD-2345`. It keeps that mode across reloads and
   renews the code when it expires (codes last 10 minutes).
2. An admin scans the QR code (signing in with a passkey if needed) or types the
   code under Settings → Paired devices, checks the browser/address shown, names
   the device and approves (`POST /auth/pair/approve`).
3. The display polls `POST /auth/pair/poll` with its secret pairing id and
   receives the device token once, both as the `homectl_device` cookie and in
   the JSON body (for non-browser clients). It then reloads into the app.

Paired devices are stored in the `auth_devices` table (only a SHA-256 hash of
the token) and cached in memory, so a database outage does not lock displays
out. They are auth state, not configuration: config export/import does not
include them. Settings → Paired devices lists them with last-seen time and
address, and can rename or revoke them. Revoking closes the device's open
websockets within 30 seconds and its next request gets `401`, which brings the
UI back to the sign-in screen. Browsers cap cookie lifetimes (about 400 days),
so the device cookie is re-issued daily while it is used.

A non-browser client can pair the same way:

```sh
start=$(curl -s -X POST https://homectl.example.org/auth/pair/start \
  -H 'content-type: application/json' -d '{"name":"My script"}')
echo "$start"   # approve .code under Settings → Paired devices
curl -s -X POST https://homectl.example.org/auth/pair/poll \
  -H 'content-type: application/json' \
  -d "{\"pairingId\":\"$(echo "$start" | jq -r .pairingId)\"}"
# → {"status":"approved","token":"hcd_…",…}; send it as Authorization: Bearer
```

## Clients

- **Browser UI:** `GET /auth/me` decides between the app, the sign-in screen and
  the pairing screen. The gateway-injected feedback widget is unaffected.
- **CLI:** `homectl --token …` or `HOMECTL_TOKEN=…` (a machine token or a device
  token).
- **UI preview** (`scripts/preview.sh`, Vite dev proxy):
  `HOMECTL_DEV_PROXY_TOKEN=…` adds the bearer token to proxied requests.
- **MQTT** paths are unaffected.

## Tests

- Unit tests: `server/src/auth/` and `server/src/api/auth.rs`.
- Server end-to-end with a mock provider: `cargo test -p homectl-server --test auth_api`.
- Browser end-to-end (real server, built UI, mock provider):
  `cargo build --bin homectl-server`, then from `ui/`
  `nix shell nixpkgs#chromium --command pnpm test:auth-e2e`.
