# Configuration UI Refactor - TODO

This document tracks progress on migrating homectl configuration from TOML files to a SQLite-backed UI system.

## ✅ Phase 1: Database Schema (COMPLETE)

- [x] Migration `20250117200000_config_tables.sql` with tables for:
  - core_config, integrations, groups, group_devices, group_links
  - scenes, scene_device_states, scene_group_states, routines
  - floorplan, device_positions, dashboard_layouts, dashboard_widgets
  - config_versions (for import/export history)
- [x] CRUD queries in `server/src/db/config_queries.rs`
- [x] Import/export functions for full config backup

## ✅ Phase 2: Server API Layer (COMPLETE)

- [x] REST endpoints in `server/src/api/config.rs`:
  - `/api/v1/config/integrations` - CRUD
  - `/api/v1/config/groups` - CRUD
  - `/api/v1/config/scenes` - CRUD
  - `/api/v1/config/routines` - CRUD
  - `/api/v1/config/floorplan` - GET/POST image + device positions
  - `/api/v1/config/dashboard/layouts` + `/widgets` - CRUD
  - `/api/v1/config/export` / `/import` - Full config backup
- [x] Hot-reload methods in `Groups.reload_from_db()`, `Routines.reload_from_db()`
- [x] AppState reload methods for integrations/groups/scenes/routines

## ✅ Phase 3: JavaScript Scripting Engine (COMPLETE)

- [x] Add `boa_engine` dependency to Cargo.toml
- [x] Create `server/src/core/scripting.rs` module
- [x] Expose device/group/scene state to JS context
- [x] Add `Rule::Script` variant alongside `EvalExpr`
- [x] Integrate JS evaluation in routine rule matching

## ✅ Phase 4: Integration Testing (COMPLETE)

- [x] Scene cycling tests in `tests/scene_cycling.rs`
- [x] Scripting engine tests in `tests/scripting.rs`
- [x] Unit tests in `core/scripting.rs`
- [x] Production config simulation tests in `tests/prod_config.rs`
- [ ] Config import/export roundtrip tests (deferred - needs DB)
- [ ] Hot-reload tests

## ✅ Phase 5: UI - Configuration Editors (COMPLETE)

- [x] `app/config/integrations/page.tsx` - Integration editor with JSON config
- [x] `app/config/groups/page.tsx` - Group editor with device management
- [x] `app/config/scenes/page.tsx` - Scene editor with script support
- [x] `app/config/routines/page.tsx` - Routine editor with rules/actions JSON
- [x] `app/config/import-export/page.tsx` - Import/export functionality
- [x] Config layout with tab navigation
- [x] Config link added to bottom navigation

## ✅ Phase 6: UI - Floorplan Editor (COMPLETE)

- [x] `app/config/floorplan/page.tsx` - Floorplan config page
- [x] Image upload component
- [x] Device position editor (x/y coordinates table)
- [ ] Drag-and-drop positioning (future enhancement)

## ✅ Phase 7: UI - Dashboard Customization (COMPLETE)

- [x] `hooks/useDashboard.ts` - Dashboard hooks with widget registry
- [x] `app/config/dashboard/page.tsx` - Dashboard layout/widget config
- [x] Widget registry with 7 widget types
- [x] Layout and widget CRUD operations
- [x] Add/edit widget modals with options JSON

## ✅ Phase 8: Migration & Cleanup (COMPLETE)

- [x] `app/config/migration/page.tsx` - TOML migration tool UI
- [x] TOML upload, preview, and apply workflow
- [x] CLI `--config` flag for TOML import at startup
- [x] Removed TOML as primary config source (import/export only)

## ✅ Phase 9: SQLite Migration & Config Overhaul (COMPLETE)

- [x] Switched from PostgreSQL to SQLite (file-based, auto-created)
- [x] Consolidated all migrations into a single SQLite schema
- [x] Removed `config` crate dependency, switched to `serde_json::Value`
- [x] Updated all 6 integration constructors
- [x] DB-first startup with TOML fallback seeding (on empty DB)
- [x] CLI args: `--port`, `--db-path`, `--config`, `--warmup-time` (with env vars)
- [x] Collapsed scenes dual storage to single DB source
- [x] Full integration hot-reload: add/modify/remove with `stop()` lifecycle
- [x] Device cleanup on integration removal

## ✅ Phase 10: Simulation Mode (COMPLETE)

- [x] CLI subcommand: `cargo run -- simulate` with `--port`, `--source-db`, `--config`, `--warmup-time`
- [x] In-memory SQLite for ephemeral simulation (no production state pollution)
- [x] Config mirroring: copies production DB or seeds from TOML file
- [x] MQTT→Dummy auto-translation: discovers devices from groups, scenes, and routines
- [x] Sensor detection: devices referenced in sensor rules get `Sensor(Boolean)` init state
- [x] Full UI + API served on simulation port (default 45290)
- [x] Sensor event simulation via existing `PUT /api/v1/devices/{id}`

## ✅ Phase 11: Developer Tooling (COMPLETE)

- [x] `homectl` CLI utility (`cli/` crate) for API interaction via subcommands
- [x] Moon task runner configuration (`.moon/` workspace + per-project `moon.yml`)
- [x] `flake.nix` updated: added `pnpm` and `moon`, removed `postgresql` and `docker-compose`
- [x] UI dev env vars configured for simulation server (API_ENDPOINT, WS_ENDPOINT)

---

## Quick Start

```bash
cd server

# Start server (auto-creates homectl.db, seeds from Settings.toml if DB is empty)
cargo run

# Start with custom options
cargo run -- --port 8080 --db-path /data/homectl.db --config Settings.toml
# Or use environment variables:
PORT=8080 DB_PATH=/data/homectl.db CONFIG_FILE=Settings.toml cargo run
```

## Simulation Mode

```bash
cd server

# Simulate from production DB (mirrors config, replaces MQTT with dummy devices)
cargo run -- simulate --source-db homectl.db

# Simulate from TOML config
cargo run -- simulate --config Settings.toml

# Custom port
cargo run -- simulate --source-db homectl.db --port 45291

# Trigger sensor events during simulation
curl -X PUT http://localhost:45290/api/v1/devices/motion_sensor \
  -H "Content-Type: application/json" \
  -d '{"id": "motion_sensor", "name": "motion_sensor", "integration_id": "dummy", "data": {"Sensor": {"value": true}}}'
```

## API Examples

```bash
# List all groups
curl http://localhost:45289/api/v1/config/groups

# Create a new scene
curl -X POST http://localhost:45289/api/v1/config/scenes \
  -H "Content-Type: application/json" \
  -d '{"id": "my-scene", "name": "My Scene", "hidden": false}'

# Export full config
curl http://localhost:45289/api/v1/config/export > backup.json

# Import config
curl -X POST http://localhost:45289/api/v1/config/import \
  -H "Content-Type: application/json" \
  -d @backup.json
```

## CLI Utility

```bash
# Build the CLI
cargo build -p homectl-cli

# List devices (defaults to simulation server at localhost:45290)
homectl devices list

# List devices in JSON format
homectl -f json devices list

# Activate a scene
homectl action activate-scene evening_lights

# Trigger a sensor
homectl devices set-sensor motion_sensor --name "Motion sensor" --integration dummy --sensor-type boolean true

# Force-trigger a routine
homectl action trigger-routine motion_handler

# Point at a different server
homectl -u http://localhost:45289 devices list
```

## Development Environment (Moon)

```bash
# Enter the nix dev shell (provides rust, pnpm, moon, etc.)
nix develop

# Start simulation server + UI dev server in parallel
moon run server:simulate ui:dev

# Run individual tasks
moon run server:simulate       # Just simulation server
moon run ui:dev                # Just UI dev server
moon run server:test           # Run server tests
moon run server:clippy         # Lint server code
moon run ui:lint               # Lint UI code
moon run ui:typecheck          # Type-check UI code
```
