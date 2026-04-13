# homectl monorepo

This repository contains the homectl home automation platform split into two packages:

- `server/` (Rust) – core automation engine and HTTP/WebSocket API
- `ui/` (Next.js / React) – web interface consuming the server API

## Packages

### Server (Rust)
See [server/README.md](server/README.md) for detailed usage, configuration, and integration docs.

Key technologies:
- Rust (edition 2021)
- warp, tokio, sqlx, mqtt, etc.
- Optional PostgreSQL persistence with DB-optional startup from JSON backup, legacy TOML, or an empty in-memory runtime

Build & run (development):
```
cd server
cargo run

# optional: use PostgreSQL persistence
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo run

# optional: bootstrap from a JSON export or legacy TOML backup
cargo run -- --config ./config-backup.json
```

If the database named in `DATABASE_URL` does not exist yet, the server creates
it automatically before running migrations when the configured PostgreSQL role
has permission to create databases.

### UI (Next.js)
See [ui/README.md](ui/README.md) for UI specific documentation.

Development:
```
cd ui
pnpm install   # or npm / yarn
pnpm dev
```

## CI/CD
Root GitHub Workflows:
- `server-ci.yml` – Lints/tests/builds and publishes the server image (`ghcr.io/<owner>/<repo>-server`).
- `ui-ci.yml` – Builds and publishes the UI image (`ghcr.io/<owner>/<repo>-ui`).
- `release-please.yml` – Uses manifest mode to create independent releases for `server` and `ui`.

Legacy per-package workflows were deprecated in-place and converted to no-op callable workflows.

## Releases & Versioning
`release-please` manages versions independently using:
- `.release-please-manifest.json` – current versions
- `release-please-config.json` – package metadata

## Coding Style
Unified formatting via root `.editorconfig`.

## Directory Overview
```
server/   Rust backend source, migrations, scripts
ui/       Next.js frontend, generated TypeScript bindings
.github/  Workflows (monorepo aware)
```

## Contributing
1. Create a feature branch.
2. Ensure server tests pass: `cargo test`.
3. If you changed Postgres persistence or reconnect behavior, also run `cargo test -p homectl-server --test postgres_runtime -- --test-threads=1` from `server/`.
4. Ensure UI builds: `pnpm build` (or `npm run build`).
5. Commit using conventional commit messages for automated release PRs.

## License
MIT – see [LICENSE](LICENSE).
