# AGENTS.md - AI Agent Guide for homectl

## Project Overview

**homectl** is a home automation platform built as a monorepo with two main packages:

- **`server/`** – Rust backend: core automation engine, HTTP/WebSocket API
- **`ui/`** – Next.js/React frontend: web interface consuming the server API

The server unifies home automation systems from different brands by assuming control over individual systems, providing a common interface for configuration, advanced scene control, and reliable state management.

## Technology Stack

### Server (Rust)
- **Language**: Rust (edition 2021)
- **Web Framework**: warp
- **Async Runtime**: tokio
- **Database**: Optional PostgreSQL via sqlx, with DB-optional startup from JSON backup, legacy TOML, or an empty in-memory runtime
- **Messaging**: MQTT (via rumqttc)
- **Configuration**: TOML (via config + toml crates)
- **TypeScript Bindings**: ts-rs (generates TypeScript types from Rust structs)

### UI (Next.js)
- **Framework**: Next.js 15
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
│   │   ├── db/            # Database layer (optional PostgreSQL persistence and config export/import)
│   │   ├── integrations/  # Home automation system integrations
│   │   ├── types/         # Shared type definitions
│   │   └── utils/         # Utility modules
│   ├── migrations/        # SQL migrations (sqlx)
│   ├── Settings.toml      # Runtime configuration
│   └── Cargo.toml
├── ui/                     # Next.js frontend
│   ├── app/               # Next.js App Router pages
│   │   ├── api/           # API routes
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

## Configuration

The server uses **TOML** configuration (`Settings.toml`) for normal startup, and
can also bootstrap from a JSON export backup or legacy TOML file passed to
`--config`. When `DATABASE_URL` is set, PostgreSQL persistence is enabled; when
it is unset or unreachable, the runtime can still continue entirely in memory.
Key sections:
- `[core]` – General settings (warmup time, etc.)
- `[integrations.<id>]` – Integration plugin configurations
- `[groups.<id>]` – Device groupings
- `[scenes.<id>]` – Scene definitions
- `[routines.<id>]` – Automation rules

See `Settings.toml.example` for comprehensive examples.

## TypeScript Bindings

The server uses **ts-rs** to generate TypeScript types from Rust structs. Generated bindings are in `ui/bindings/`. These ensure type safety between backend and frontend.

## Environment Variables

- `DATABASE_URL` – Optional PostgreSQL connection string used for persistence
- `CONFIG_FILE` – JSON export backup or legacy TOML file used for seeding and fallback startup
- `RUST_LOG` – Logging level (e.g., `homectl_server=info`)

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
