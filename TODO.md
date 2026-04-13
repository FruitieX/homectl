# DB-Optional Postgres Runtime - TODO

This document tracks the remaining work to finish the database-optional runtime rewrite.

## Completed Foundation

- [x] Add shared backup config parsing for JSON export files and legacy TOML
- [x] Use backup config loading in normal startup and simulation fallback paths
- [x] Build one runtime config snapshot at startup instead of separate boot-time DB reads
- [x] Allow the server to keep booting from backup config or empty in-memory config when DB startup fails

## Status

All tracked phases in this rewrite are complete on this branch.

### 1. Memory-First Runtime Config

- [x] Store the runtime config snapshot inside `AppState` as the live config source
- [x] Move config API GET routes to read from in-memory runtime config instead of DB queries
- [x] Make `/api/v1/config/export` return the in-memory runtime snapshot
- [x] Cover floorplan/dashboard/device metadata reads that still depend on DB-only query paths
- [x] Move floorplan group-position reads off the remaining DB-only path

### 2. Memory-First Config Mutations

- [x] Change config CRUD POST/PUT/DELETE routes to mutate in-memory config first
- [x] Keep DB persistence as best-effort for config CRUD routes
- [x] Replace DB-triggered hot reload flow with direct in-memory apply/invalidate logic for integrations, groups, scenes, and routines
- [x] Keep JSON export/import behavior working in memory-only mode
- [x] Keep TOML migration apply behavior working in memory-only mode

### 3. Optional Postgres Backend

- [x] Replace SQLite-specific sqlx setup with Postgres connection management
- [x] Make Postgres connectivity optional rather than required for startup
- [x] Rewrite migrations for Postgres schema and seed behavior
- [x] Replace SQLite query syntax in config and action query modules

### 4. Runtime Persistence

- [x] Batch/coalesce device state writes instead of spawning one DB write per update
- [x] Revisit scene override and UI state persistence under optional DB availability
- [x] Keep remaining runtime persistence paths resilient when database writes fail

### 5. Reconnect Handling

- [x] Retry Postgres connection in the background when configured but unavailable
- [x] Seed an empty DB from the in-memory snapshot after reconnect
- [x] Keep the running in-memory snapshot authoritative until restart when PostgreSQL reconnects with existing config
- [x] Require manual DB edits to happen while the server is stopped

### 6. Simulation Mode

- [x] Remove SQLite-specific simulation assumptions
- [x] Support simulation startup from Postgres, JSON backup, or legacy TOML
- [x] Keep MQTT-to-dummy conversion working with the new runtime config source

### 7. UI And Operator Visibility

- [x] Expose runtime persistence status from the server
- [x] Show a banner when the server is running in memory-only mode
- [x] Explain JSON export durability expectations in the import/export UI

### 8. Verification And Tooling

- [x] Add tests for JSON-only startup with no database
- [x] Add tests for reconnect recovery behavior
- [x] Add Postgres-backed test provisioning with Rust testcontainers
- [x] Update CI, dev shell, and helper tasks for DB-backed and DB-optional workflows

### 9. Docs And Cleanup

- [x] Update README and docs to describe DB-optional startup and JSON backup usage
- [x] Remove stale SQLite-first wording from source comments and docs
