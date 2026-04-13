---
trigger: always_on
---

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
- **Database**: SQLite via sqlx, with DB-optional startup from JSON backup or legacy TOML
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
│   │   ├── db/            # Database layer (SQLite-backed persistence and config export/import)
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
`--config`. Key sections:
- `[core]` – General settings (warmup time, etc.)
- `[integrations.<id>]` – Integration plugin configurations
- `[groups.<id>]` – Device groupings
- `[scenes.<id>]` – Scene definitions
- `[routines.<id>]` – Automation rules

See `Settings.toml.example` for comprehensive examples.

## TypeScript Bindings

The server uses **ts-rs** to generate TypeScript types from Rust structs. Generated bindings are in `ui/bindings/`. These ensure type safety between backend and frontend.

## Environment Variables

- `DB_PATH` – SQLite database path (defaults to `homectl.db`)
- `DB_JOURNAL_MODE` – SQLite journal mode for file-backed databases
- `CONFIG_FILE` – JSON export backup or legacy TOML file used for seeding and fallback startup
- `RUST_LOG` – Logging level (e.g., `homectl_server=info`)

## CI/CD

Uses GitHub Actions with:
- **server-ci.yml** – Lints, tests, builds, and publishes server Docker image to `ghcr.io`
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
