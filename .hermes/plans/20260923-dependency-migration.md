# Migration plan — bump every dependency to latest

Authorised 2026-09-23: major bumps allowed, migrations expected. Work in
`~/homectl-wt/panel`, one ecosystem per batch, one Conventional Commit per batch,
full gates before each push. Never pipe `cargo`/`pnpm` into `grep`/`tail` — a
masked exit code once pushed a red build to `main`.

## Structural findings (do these first)

1. **`pnpm.overrides` lives in the wrong file.** pnpm 11 no longer reads the
   `pnpm` field of `package.json` — it warns "The following keys were ignored:
   pnpm.overrides". Move the overrides into a tracked `ui/pnpm-workspace.yaml`
   (the file pnpm 11 auto-generates is currently untracked) so both pnpm 10
   (flake/CI) and pnpm 11 (dev) honour them. The lockfile's `overrides` block
   must match, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
2. **`testcontainers-modules` is a blocking upgrade.** Latest `0.15.0` requires
   `testcontainers ^0.27`, but the manifest pulls `testcontainers ^0.28`, and
   `cargo` cannot resolve the pair. Either hold `testcontainers-modules` or move
   the whole testcontainers family together once upstream catches up.
3. **Obsolete features already warn:** `sqlx` feature `runtime-tokio-rustls`
   (obsolete in 0.9.0) and `reqwest` feature `rustls-tls` (obsolete in 0.13.5).
   They warn today and will fail on upgrade; fix the feature lists as part of
   the Rust batch.

## Batches

- **B1 — npm majors.** `pnpm up --latest` in `ui/`, then work the fallout
  (expect: eslint flat config, vite/rolldown, tailwind, react-router 7.18.x).
  Gates: `pnpm tsc && pnpm lint && pnpm test && pnpm exec vite build`.
- **B2 — Rust majors.** `cargo upgrade --incompatible` (cargo-edit), fix
  feature lists from finding 3, handle finding 2, then `cargo build` +
  `cargo test --quiet --lib` (706 tests). Known flakes:
  `scene-cycling-mixed.hurl`, `trigger-modes.hurl`.
- **B3 — CI/toolchain.** Land Renovate #891 (Actions pinned to SHAs, pnpm
  10.34.5, node 22) once rebased; keep the flake's pnpm, node and the CI
  versions consistent with whatever the lockfile is written by.

## Verification bar

- UI: tsc, lint, tests, `vite build`. Server: `cargo build`, `cargo test --lib`.
- Re-query `gh api repos/FruitieX/homectl/dependabot/alerts?state=open` after
  pushing to see the real delta (Dependabot only rescans the pushed branch).
- Report per batch: commit SHA + CI status once; do not babysit pipelines.
