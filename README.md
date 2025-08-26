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
- PostgreSQL (optional) for persistence

Build & run (development):
```
cd server
cargo run
```

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
3. Ensure UI builds: `pnpm build` (or `npm run build`).
4. Commit using conventional commit messages for automated release PRs.

## License
MIT – see [LICENSE](LICENSE).
