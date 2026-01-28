# Configuration UI Refactor - TODO

This document tracks progress on migrating homectl configuration from TOML files to a PostgreSQL-backed UI system.

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
- [ ] CLI tool for migration (can use UI instead)
- [ ] Remove TOML reader (future - when ready to deprecate)

---

## Quick Start (After Migration)

```bash
# Run the new migration
cd server
export DATABASE_URL="postgres://user:pass@localhost/homectl"
sqlx migrate run
cargo sqlx prepare  # Generate offline query cache

# Start server
cargo run
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
