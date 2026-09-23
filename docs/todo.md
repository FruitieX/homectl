# Todo

Ideas and requested changes that are not implemented yet. Add new items at the
top with enough context to act on them later, and remove an item once it lands.

## Adopt the React Compiler lint rules (2026-09-23)

oxlint 1.85 ships the React Compiler rules (`react/set-state-in-effect`,
`react/refs`, `react/purity`, `react/preserve-manual-memoization`,
`react/immutability`, `react/incompatible-library`); they report 76 findings
across the UI, so `ui/.oxlintrc.json` keeps them off to preserve the lint
policy this repo has always used. Adopting them is a deliberate pass: derive
state during render instead of `setState` inside effects, and keep refs out of
render.

## Migrate the HTTP layer from warp to axum (2026-09-23)

warp is effectively unmaintained next to axum, and it is why the server cannot
just follow the ecosystem: 0.3 to 0.4 was another filter-API churn cycle rather
than progress. The HTTP surface is 638 `warp::` references across 23 files with
41 `warp::path(` segments, plus the websocket endpoint (`server/src/api/ws.rs`),
CORS and the JSON/rejection plumbing (`warp::body`, `warp::reject`).

Do this after the dependency migration, and until then keep warp pinned as-is —
a warp 0.4 bump would be work thrown away. Likely shape: one axum `Router` per
api module composed in `server/src/api/mod.rs`, `tower-http` for CORS/tracing,
`axum::extract::ws` for the websocket, and rejection-based error bodies
translated to axum responses. Keep the `/api/v1/...` paths, JSON shapes and
handler logic as they are (the UI, the CLI and any saved assistant plans depend
on them); change extractors and return types, not semantics.

## Paused/drifted state for scenes after manual tweaks (2026-09-23)

When a group is following a scene and its state is changed outside that scene —
the user tweaking a light in the UI, applying an assistant suggestion, a routine
firing — nothing marks the departure. The scene link is silently cleared on apply
(`server/src/core/devices.rs:1117`, `set_scene(None, …)`; `linked_scene_id` goes
to `None`), and there is no "paused" concept anywhere in the codebase (grepping
for pause finds only a tokio test attribute). There is also no UI surface saying
"this group was in scene X and has since been overridden".

Decide the model first: a paused/drifted flag on the scene link, or per-group
scene state? Then surface it (chip on the group card?), and define what applying
a scene does to a paused group (resume vs re-assert). Related to the item below
about expressing "which scene state is this group in".

## Brightness calibration for lights

Color calibration covers HSV hue and saturation only: `docs/color-calibration.md`
states that brightness, native color temperature, RGB and XY commands are not
calibrated. Brightness is forwarded unchanged, so the same requested value means
different things per bulb:

- Tuya/ESPHome bulbs can get significantly more dim than Hue bulbs (different dim
  curves and usable minimums), so the same percentage is visibly different
  between them.
- The circadian integration's evening brightness is mismatched across bulb types,
  because one profile is emitted for every linked light.

Extend the calibration wizard with a brightness step: pick a reference light and
a few levels (for example 100 / 60 / 30 / 15 / 5 %), adjust the target lamp's
brightness until the illumination matches the reference, and store the pairs as a
piecewise-linear curve on the profile. Apply that curve wherever brightness is
commanded, including scene device links and the circadian brightness output, and
clamp to the device's usable minimum/maximum so a low evening request does not
land below what a bulb can actually do, or above a high floor. Keep the existing
profile persistence and batch validation semantics. Out of scope: native color
temperature, RGB and XY calibration.

## Assistant plans that create what they reference (2026-09-23)

- [ ] Let a plan reference entities its own earlier operations create. Plan: `.hermes/plans/20260923-assistant-and-housekeeping.md`; half-finished WIP is stashed as `staged-creates-wip` in `~/homectl-wt/panel`.
- [ ] Dependency housekeeping: down to 40 open alerts (10 high) after the pnpm-overrides lockfile fix; the to-latest migration is in flight — see `.hermes/plans/20260923-dependency-migration.md` (UI batch landing; Rust batch pending; holds: TypeScript 7 and ESLint 10 toolchain support).
- [ ] Decide how "which scene state is this group in" should be expressed before asking the assistant to write such routines.
