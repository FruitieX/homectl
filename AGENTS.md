# AGENTS.md - AI Agent Guide for homectl

## Project Overview

**homectl** is a home automation platform built as a monorepo with two main packages:

- **`server/`** – Rust backend: core automation engine, HTTP/WebSocket API
- **`ui/`** – Vite/React Router frontend: web interface consuming the server API

The server unifies home automation systems from different brands by assuming control over individual systems, providing a common interface for configuration, advanced scene control, and reliable state management.

## Technology Stack

### Server (Rust)
- **Language**: Rust (edition 2021)
- **Web Framework**: warp
- **Async Runtime**: tokio
- **Database**: SeaORM query builders/migrations with default SQLite (`./homectl.db`), optional PostgreSQL, and fallback startup from JSON backup, legacy TOML, or an empty in-memory runtime
- **Messaging**: MQTT (via rumqttc)
- **Configuration**: TOML (via config + toml crates)
- **TypeScript Bindings**: ts-rs (generates TypeScript types from Rust structs)

### UI (Vite + React Router)
- **Framework**: Vite with React Router
- **Language**: TypeScript
- **UI Components**: React, daisyui, react-daisyui
- **Styling**: TailwindCSS 4
- **State Management**: jotai
- **Animation**: framer-motion
- **Charts**: @visx suite
- **Canvas**: konva, react-konva
- **Package Manager**: pnpm

## Directory Structure

```
/
├── server/                 # Rust backend
│   ├── src/
│   │   ├── main.rs        # Application entry point
│   │   ├── api/           # HTTP/WebSocket API routes
│   │   ├── core/          # Core automation logic
│   │   ├── db/            # SeaORM database layer (default SQLite, optional PostgreSQL, config export/import)
│   │   ├── integrations/  # Home automation system integrations
│   │   ├── types/         # Shared type definitions
│   │   └── utils/         # Utility modules
│   ├── migrations/        # Legacy SQL migrations retained for reference
│   ├── Settings.toml      # Runtime configuration
│   └── Cargo.toml
├── ui/                     # Vite frontend
│   ├── app/               # Route page components
│   │   ├── api/           # API helpers/routes
│   │   ├── config/        # Configuration UI
│   │   ├── dashboard/     # Dashboard views
│   │   ├── groups/        # Group management
│   │   └── map/           # Map visualization
│   ├── bindings/          # Auto-generated TypeScript types (from ts-rs)
│   ├── hooks/             # React hooks
│   ├── lib/               # Shared utilities
│   └── ui/                # Reusable UI components
├── .github/workflows/     # CI/CD pipelines
│   ├── server-ci.yml      # Server build/test/publish
│   ├── ui-ci.yml          # UI build/publish
│   └── release-please.yml # Automated releases
└── flake.nix              # Nix development environment
```

## Key Concepts

### Integrations
Plugins that connect to various home automation systems:
- **mqtt** – Generic MQTT devices with configurable message formats
- **circadian** – Virtual device for circadian rhythm color following
- **cron** – Scheduled actions
- **timer** – Timed actions (e.g., delay motion sensor re-activation)
- **dummy** – Testing/development without physical hardware

### Devices
Individual controllable units (lights, switches, sensors). Each device has:
- `id`, `name`, `integration_id`
- `state` (power, brightness, color, sensor values)
- `capabilities` (color modes, temperature ranges)

### Groups
Collections of devices that can be controlled together. Groups can contain other groups for hierarchical control.

### Scenes
Preset states for groups/devices. Scenes can:
- Set explicit states (power, color, brightness)
- Reference other scenes
- Link to other devices (e.g., circadian rhythm device)

### Routines
Event-driven automation rules with:
- **Rules** – Conditions that must match (sensor values, device states, group states)
- **Actions** – Operations to perform (ActivateScene, CycleScenes, DimAction, IntegrationAction)

Routine history (`server/src/core/routine_history.rs`) records completed v1
rule matches, force triggers, and v2 runs in a bounded 500-entry in-memory
ring exposed at `GET /api/v1/config/routine-history`. The same newest 500
entries are persisted to the `routine_history` table (full entry JSON) and
restored into the ring at startup, so the history view survives a server
restart; the table is pruned on startup and every 100 written entries.

### State actor & runtime snapshot
The server uses an actor-model architecture for `AppState`:

- **`AppState`** (`server/src/core/state/mod.rs`) is owned by a single
  tokio task, the **state actor** (`server/src/core/state/actor.rs`).
  There is no `Arc<RwLock<AppState>>`; the actor is the sole writer.
- **`StateHandle`** is the only way for non-actor code to mutate state.
  Use `handle.send_event(event)` for fire-and-forget events, or
  `handle.mutate(|state| Box::pin(async move { ... })).await?` for
  admin writes that need to read back a typed result. Each command runs
  to completion before the next is dequeued.
- **`SnapshotHandle`** is an `Arc<ArcSwap<RuntimeSnapshot>>` published
  after every command. Readers (HTTP handlers, widgets, websockets) use
  `snapshot.load()` — no locking, no `await`. The snapshot carries
  `runtime_config`, `devices`, `flattened_groups`, `flattened_scenes`,
  `routine_statuses`, `ui_state`, and `warming_up`.
- HTTP route builders take `&SnapshotHandle` + `&StateHandle`; they
  never see `AppState` directly. Warp filters `with_snapshot` and
  `with_handle` inject them into handlers.

Implications for contributors:
- For a new read endpoint, extract the data from `snapshot.load()`.
- For a new admin write, add an `AppState` method and call it from the
  handler via `handle.mutate(|state| Box::pin(async move { ... })).await`.
- Do **not** reintroduce `Clone` on `AppState` or wrap it in a lock.
- Long-running external work (HTTP calls, integration reloads) belongs
  **outside** the mutate closure. Use the two-phase pattern in
  `apply_runtime_integrations_change` as a template: first mutate to
  clone out what you need, run the external work, then a second mutate
  to commit.

### Per-integration actors
Each integration instance is owned by its own tokio task
(`server/src/core/integrations/actor.rs`). `Integrations` stores a
`HashMap<IntegrationId, IntegrationHandle>` where
`IntegrationHandle` wraps an `mpsc::UnboundedSender<IntegrationCmd>`.
There is no `Mutex` around `Box<dyn Integration>` anywhere.

- **Lifecycle commands** (`register`, `start`, `stop`) are dispatched
  via `handle.register().await` / etc. and carry a oneshot reply so
  hot-reload can await completion and surface errors.
- **Data-plane commands** (`set_device_state`, `run_action`) are
  fire-and-forget to match the old `DeferredEventWork` semantics; the
  state actor never blocked on them.
- **Reload** (`Integrations::reload_config_rows`) stops removed /
  modified integrations via their handle, drops the handle, then
  spawns a fresh actor via `load_integration`. The per-integration
  actor exits when the last handle drops and its `Box<dyn Integration>`
  is dropped inside the task.
- Adding a new integration requires **no actor plumbing**: implement
  `Integration` as usual in `server/src/integrations/<name>/mod.rs` and
  register the module-name branch in
  `server/src/core/integrations/mod.rs::load_custom_integration`.

## Development Commands

### Server
```bash
cd server
cargo run                           # Run development server
cargo run -- --config ./config-backup.json
cargo test                          # Run tests
cargo build --release               # Production build
RUST_LOG=homectl_server=info cargo run  # With logging
```

### UI
```bash
cd ui
pnpm install                        # Install dependencies
pnpm dev                            # Development server
pnpm build                          # Production build
pnpm lint                           # Run linter
pnpm tsc                            # Type check
```

## API Information

### Health Endpoints
- `GET /health/live` – Liveness check (always 200 if process is up)
- `GET /health/ready` – Readiness check (200 when warmup complete + DB reachable)

### Default Port
Server runs on port **45289** by default.

### WebSocket
Real-time updates available via WebSocket connection for device state changes and events.

### AI configuration assistant

Optional natural-language configuration assistant. It is disabled unless
provider settings exist; `GET /api/v1/config/assistant/status` reports whether
it is enabled and which model it uses.

- `GET`/`PUT /api/v1/config/assistant/settings` – stored provider settings (API
  key masked in responses)
- `POST /api/v1/config/assistant/draft` – draft a v2 routine definition for
  editor review; never persisted automatically
- `POST /api/v1/config/assistant/chat` – the unified assistant turn used by the
  UI. Responds with `text/event-stream`: `status` (progress), `delta` (provider
  text deltas when the provider streams), `usage` (token counts, approximate
  when the provider reports none), then exactly one of `plan`, `action`, or
  `answer` (plain markdown prose for questions and troubleshooting, which
  writes nothing), or `error`. The prompt context includes a read-only
  `live_state` block: current device values, configured integrations, and a
  bounded tail of recent server logs, so the assistant can explain what the
  system is doing and why. Accepts `history` (capped/truncated server-side) and
  an optional `deviceKeys` light-state scope; aborts upstream work when the
  client disconnects.
- `POST /api/v1/config/assistant/actions/{action_id}/apply` – apply a stored
  light-state action through the normal device command path (single-use,
  re-validated against the live catalog)
- `DELETE /api/v1/config/assistant/actions/{action_id}` – discard a stored
  action
- `POST /api/v1/config/assistant/apply` – legacy one-off light-state request
  with an optional `deviceKeys` scope, applied immediately; kept for
  compatibility, the UI no longer calls it
- `GET /api/v1/config/assistant/search?kind=&q=` – deterministic entity search
  (exact > prefix > substring on id/name); used by the plan context builder and
  by the UI to attach entities
- `POST /api/v1/config/assistant/plan` – build a reviewed plan from a prompt and
  attachment list (optional `history`); the non-streaming predecessor of
  `assistant/chat`, kept for compatibility
- `GET /api/v1/config/assistant/plans/{plan_id}` – fetch a stored plan
- `DELETE /api/v1/config/assistant/plans/{plan_id}` – discard a stored plan
- `POST /api/v1/config/assistant/plans/{plan_id}/apply` – apply accepted
  operation ids

Plans and light-state actions live in an in-memory store for as long as the
server process runs, are capped at 50 entries (oldest evicted first), and are
single-use: applying or discarding removes them, and unknown ids return 404.
Proposals do not expire on a timer. Every
operation is re-validated against the live snapshot at apply time and executed
through the existing `StateHandle`/config write paths; secrets are masked in
plans and preserved when an update omits them. A unified `assistant/chat` turn
classifies the prompt into either a plan or a light-state action with one
provider call (`kind` field, inferred from `changes` vs `operations` when
absent); light-state actions are never written before the user applies them.
Conversation history is client-held and session-only: it is sent with each
request and capped/truncated server-side (16 messages / 8000 chars, 2000 chars
per message).

## Configuration

The server uses **TOML** configuration (`Settings.toml`) for normal startup, and
can also bootstrap from a JSON export backup or legacy TOML file passed to
`--config`. When `DATABASE_URL` is unset, homectl creates or opens
`./homectl.db` as a SQLite database. Explicit PostgreSQL and SQLite URLs are
also supported; if the target database does not exist yet, homectl creates it
before running SeaORM migrations when the backend permits it. If an explicitly
configured database is unreachable, the runtime can still continue in memory.
Key sections:
- `[core]` – General settings (warmup time, etc.)
- `[integrations.<id>]` – Integration plugin configurations
- `[groups.<id>]` – Device groupings
- `[scenes.<id>]` – Scene definitions
- `[routines.<id>]` – Automation rules

See `Settings.toml.example` for comprehensive examples.

### Runtime configuration persistence policy

The database is the canonical store for all user-managed runtime configuration.
New settings, device metadata, sensor catalogs, sensor groups, widget selections,
source mappings, scenes, routines, and similar user data must be represented in
the database and exposed through the API/UI. Do not add new runtime features to
`Settings.toml`, `Settings.toml.example`, or other configuration text files.

`Settings.toml` is limited to bootstrap/deployment concerns that must exist before
the database is available. `CONFIG_FILE` JSON exports and legacy TOML are import
and fallback compatibility inputs; they are not a second ongoing configuration
store. New database-backed entities may be accepted from an import format only
when the import immediately persists them to the database and runtime reads come
from the database snapshot. Every new importable field needs a default-empty
backward-compatible representation and a round-trip export/import test.

When deciding where a value belongs, ask whether a user can edit it during normal
operation. If yes, it belongs in the database. Keep secrets out of browser config
responses and text exports unless the user explicitly requests a secret-inclusive
backup.

## TypeScript Bindings

The server uses **ts-rs** to generate TypeScript types from Rust structs. Generated bindings are in `ui/bindings/`. These ensure type safety between backend and frontend.

## Environment Variables

- `DATABASE_URL` – Optional database connection string used for persistence
  (SQLite and PostgreSQL are supported; defaults to `./homectl.db` SQLite)
- `CONFIG_FILE` – JSON export backup or legacy TOML file used for seeding and fallback startup
- `RUST_LOG` – Logging level (e.g., `homectl_server=info`)
- `HOMECTL_ALLOWED_ORIGINS` – Comma separated list of additional browser
  origins allowed to call the API cross-origin (same-origin and loopback
  origins are always allowed; all other origins are rejected before routing)
- `HOMECTL_ASSISTANT_BASE_URL` – Optional OpenAI-compatible API base (hosted
  provider or a local runtime such as Ollama) that enables the routine drafting
  assistant. OpenCode Zen uses `https://opencode.ai/zen/v1` and the Go
  subscription uses `https://opencode.ai/zen/go/v1` (both with model
  `deepseek-v4.1-flash`). Requests identify themselves with a
  `homectl-assistant` user agent and a stable per-draft `x-opencode-session`
  header.
- `HOMECTL_ASSISTANT_MODEL` – Model name used for drafting (required with the
  base URL)
- `HOMECTL_ASSISTANT_API_KEY` – Optional bearer token for the assistant
  provider; local endpoints usually omit it
- `HOMECTL_ASSISTANT_TIMEOUT_MS` – Optional provider timeout, default 60000
- `HOMECTL_ASSISTANT_MAX_TOKENS` – Optional completion token cap, default 2048
- `HOMECTL_ASSISTANT_CONTEXT_WINDOW` – Optional context window (tokens) used by
  the UI context meter, default 128000; also editable as `contextWindow` in the
  stored assistant settings
- `HOMECTL_ASSISTANT_REASONING_EFFORT` – Optional `reasoning_effort` value for
  thinking models (e.g. `high`); dropped automatically when a provider rejects it
- `HOMECTL_ASSISTANT_TIMEZONE` – Optional IANA zone used for drafted
  schedules; inferred from existing routines when unset

Assistant settings are normally edited in the Settings UI and stored in the
database under the reserved `assistant` widget setting
(`GET`/`PUT /api/v1/config/assistant/settings`). The environment variables above
are only fallback defaults: once a stored `assistant` setting exists, it is the
sole source of truth. The API key is masked in responses and redacted from
exports unless `?include_secrets=true` is requested.

Assistant drafts are validated by the v2 compiler and returned for review;
they are never persisted or enabled automatically.

The assistant panel (`ui/assistant/AssistantPanel.tsx`) is the single review
surface for both configuration plans and light-state actions. It opens from the
header button (the only assistant button on every page, including the
floorplan AppBar; it is icon-only), the command palette, config pages, and room
pages; entry points may preload an attachment chip, and the panel itself can
search for entities to attach via `GET /api/v1/config/assistant/search`. A turn
streams over `POST /api/v1/config/assistant/chat`: provider deltas and progress
states appear live, a Cancel button aborts the turn (the server stops provider
work on disconnect), and a context meter shows approximate tokens used this
thread against the configured context window. The thread is in-memory only, is
sent back as `history` with each request, and a "New thread" button clears it
along with the attachment chips.

Plan responses render as a `PlanCard`: collapsed rows show the operation and
target entity, expanding reveals field-level diffs, destructive operations are
never selected by default, and Apply submits only the accepted op ids. Discard
calls `DELETE /api/v1/config/assistant/plans/{id}` and removes the card
client-side even if that request fails. Light-state responses render as an
`ActionCard` with a per-device change list and an explicit "Apply now" button;
applying calls `POST /api/v1/config/assistant/actions/{id}/apply`, which
re-validates and applies through the normal device command path. Nothing is
written before the user applies. The AppBar has no search field: search lives
in the navigation rail / bottom navigation and the Ctrl+K command palette.

Room previews (`GroupFloorplanPreview` in `ui/ui/floorplan/`) render on the
rooms list and room detail pages. The floorplan is picked by the group's
placement mask (`grid.groups[groupId]`) when one exists, otherwise by which
floorplan holds the most of the group's nested-resolved member devices, with
deterministic tie-breaks; the Pixi renderer's `focusBounds` option zooms to the
bounding box of the group's placed devices plus padding. Groups with no placed
devices render no preview.

Device state travels to websocket clients as targeted `Patch` messages
(upserted/removed devices only). `State`/`Patch` carry a monotonic `revision`;
clients apply a patch only when it follows the last seen revision and send
`{"Resync":{}}` when a gap means an update was missed. Full state is sent on
connect and after explicit resyncs.

## CI/CD

Uses GitHub Actions with:
- **server-ci.yml** – Lints, tests, runs Postgres testcontainers coverage, builds, and publishes server Docker image to `ghcr.io`
- **ui-ci.yml** – Builds and publishes UI Docker image to `ghcr.io`
- **release-please.yml** – Automated versioning and release PRs using conventional commits

## Coding Conventions

- **Commits**: Follow conventional commit format for automated releases
- **Formatting**: Unified via root `.editorconfig`
- **Rust**: Standard rustfmt, clippy lints
- **TypeScript**: Prettier + ESLint

## Testing

### Server
```bash
cargo test                          # Unit + integration tests
```

### Development Testing
The `dummy` integration allows testing without physical hardware. Use HTTP to toggle virtual sensor states:
```bash
# Toggle a dummy sensor
xh PUT localhost:45289/api/v1/devices/sensor \
  id=sensor name="Test sensor" integration_id=dummy \
  state:='{ "Sensor": { "OnOffSensor": { "value": true }}}'
```

## Common Tasks for AI Agents

1. **Adding a new integration**: Create a new module in `server/src/integrations/`, implement the integration trait, register in `mod.rs`

2. **Adding new API endpoints**: Add routes in `server/src/api/`, update types if needed (regenerate ts-rs bindings)

3. **Adding UI features**: Create components in `ui/ui/`, add pages in `ui/app/`, use bindings from `ui/bindings/` for type safety

4. **Modifying device/scene types**: Update Rust types in `server/src/types/`, regenerate TypeScript bindings

5. **Database changes**: Add migration in `server/migrations/`, update queries in `server/src/db/`
