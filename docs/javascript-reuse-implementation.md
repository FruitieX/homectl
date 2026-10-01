# JavaScript reuse implementation

Approved 2026-10-01: implement scripted action blocks, shared functions,
scripted condition blocks and computed helpers, including editor/API support.

## Contracts

- Existing Blocks remains the home for visual action/condition blocks and
  JavaScript action/condition/function definitions. Typed arguments retain
  defaults. Scripted actions return `{ actions }`; conditions return a strict
  boolean or `api.unknown(...)`; functions return a declared typed value.
- Function dependencies are fixed IDs selected by the author. Dependencies
  load in the invocation's fresh worker realm. Cycles, missing functions,
  invalid arguments and return types fail visibly. Arguments are data.
- JavaScript conditions run outside the state actor. Routine filters and
  choose branches use a captured coherent frame; native planning and intent
  guards continue to protect dispatch. Predicate transition triggers retain
  native evaluation; computed helpers provide reusable script-derived values
  for those triggers.
- Computed helpers retain boolean/enum/number/string types. They are read-only,
  have explicit device/group/helper dependencies and a refresh interval, and
  publish change notifications. Missing/failed computations retain the last
  good value with visible freshness; stale values do not authorize conditions.
  A previous successful value remains usable as `updating` while inputs
  recalculate, so native transitions see the real before/after values.
- Shared definition changes revalidate callers and invalidate obsolete runs.
  Everything is database-backed and survives export/import with default-empty
  compatibility. No runtime settings are added to TOML.
- Editors use the approved settings components, source editor, typed inputs,
  dependency pickers and safe draft previews. A preview never dispatches actions.

## Work queue

- [x] Schema, function loader/SDK and block expansion/validation.
- [x] Off-actor condition execution, coherent planning and stale rejection.
- [x] Computed helper scheduling, dependency validation and freshness.
- [x] API preview, concurrency, dependency edits/deletion and persistence.
- [x] Block/function/helper/source/routine editors and usage links.
- [x] Worker, runtime, API and export/import regression coverage.
- [x] Native browser review, documentation, commit and push.

## Verification scope

Use local synthetic fixtures and real supervised workers. No household
configuration or physical device commands are changed during implementation.

## Verification — 2026-10-01

- Server: `cargo test --all --locked -- --test-threads=1`, including SQLite
  reopen/restore, PostgreSQL runtime coverage and real supervised workers;
  `cargo clippy -- -D warnings`; `cargo fmt --all -- --check`.
- New regression coverage: fixed/transitive imports and prototype-like IDs,
  typed arguments/defaults/outputs, literal JSON arguments, condition
  boolean/unknown/errors, captured helper values and branch selection,
  delayed-script manual-intent suppression, helper dependency/revision stale
  rejection, last-good retention and native helper transitions, preview with
  no dispatch, caller revisions/CAS/deletion, database/export/import fields.
- UI: TypeScript, lint, 298 tests and production build pass. Change-review
  formatting now handles generated BigInt cadence/revision fields safely.
- Native Chromium pointer/keyboard review at 1440 × 1000 and 390 × 844:
  function output/argument controls, preview requests/rendering, computed-helper
  mode draft retention, incomplete cadence editing, dependency controls and
  no horizontal overflow. `ui/dev/javascript-reuse-review.mjs` reproduces it.
  The marked fixture stubs only preview response rendering; actual execution
  and absence of effects are verified against real workers in server API tests.

Usage/contracts and examples: [JavaScript reuse](javascript-reuse.md).
