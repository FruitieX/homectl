# Everyday UI implementation

Status: active. The user authorized implementation of the approved plan and
requested an implementation goal on 2026-09-29. Design authority:
[EVERYDAY-REVIEW.md](EVERYDAY-REVIEW.md), [UI-INVENTORY.md](UI-INVENTORY.md), and
the Study 05 Compact mockups. Settings acceptance remains tracked in
[IMPLEMENTATION.md](IMPLEMENTATION.md).

Remaining work is prioritized in [WORK-QUEUE.md](WORK-QUEUE.md). Use that queue
alongside the delivery gates below; completed checkpoints do not imply that
the entire overhaul is finished.

## Confirmed constraints

- Room details default to controls first, with optional floorplan access.
- Preserve the existing widget system and stored layouts; add three separate
  configurable widget types: Rooms, Scenes, Indoor climate.
- Preserve live command behavior, capability constraints and server outcomes.
  Configuration edits use the shared retained draft and explicit Save/Discard.
- Related entities open their canonical detail views. Preserve useful return
  context. Reuse the advanced preference and backend health evaluator.
- New runtime configuration lives in the database and round-trips through exports.
- Existing settings/calibration changes in the workspace must be preserved.
- Use isolated fixtures for mutating UI journeys; no live household edits needed.

## Delivery gates

- [ ] Controls-first room details, no-map case, nested groups, direct links,
      available/missing/read-only devices and shared attention.
- [ ] Shared device/group state previews, compact live controls and sensor rows;
      capability, mixed/off/unknown, pending and disconnect behavior.
- [ ] Rooms, Scenes and Indoor climate widgets: catalog, options, renderers,
      persistent configuration, sizing/arrangement, backup compatibility.
- [ ] Dashboard/widget chrome and information detail overlays/charts aligned to
      the Compact design, retaining existing widget functions and sources.
- [ ] Scene picker/capture consolidation with the canonical scene draft/editor;
      all color formats preserved, explicit scope and acknowledged outcomes.
- [ ] Floorplan selection/inspector/mobile composition and list fallback.
- [ ] Sensor detail/actions and timer scheduling: useful values first, advanced
      diagnostics, consistent commands versus retained configuration drafts.
- [ ] Assistant conversation/proposal review, state previews and related links.
- [ ] Navigation/search, startup/reconnect, empty/missing/error consistency.
- [ ] Remaining settings integration: calibration and superseded surface cleanup;
      existing implementation acceptance gates remain required.
- [ ] Targeted persistence/semantic regressions, UI type/lint/build, desktop and
      phone browser journeys, keyboard/zoom and final visual review.

## Work log

### Everyday UI delivery checkpoint — 2026-09-29

The working UI is now being delivered with its shared dependencies: controls-first
rooms and embedded previews, Rooms/Scenes/Indoor climate widgets, the visual widget
creator, generic timer UI, shared live controls/scene capture, sensor ordering,
map inspector/placement changes, retained calibration editors and recovery surfaces.
This is a delivery checkpoint; unchecked cross-view acceptance gates above remain
required and are prioritized in WORK-QUEUE.md.

Fresh evidence under `implementation-evidence/everyday/`:

- 21 native keyboard/preview checks at 1440px and 390px cover all 17 widget types,
  finite previews while dimensions are incomplete, blocked invalid creation,
  inert controls and sandboxed embedded-page previews. Weather and timetable
  source shape failures become unavailable states rather than rendering crashes.
- Eight widget creation checks at each size cover retained type drafts, no early
  writes and the exact created record's title, type and dimensions. Headings honor
  configured titles; private source metadata is retained for existing previews.
- Eight bulk calibration checks at each size verify captured scope across
  navigation, Discard, exact removal/assignment and unchanged profile data.
  Selection follows the URL even when entering from the same Devices route.
- Ten phone color-calibration checks include incomplete input retention and
  Reset clearing that point's raw edits. Earlier brightness lifecycle/keyboard
  evidence remains in IMPLEMENTATION.md.
- Five native phone chart checks cover dated readings, Home/End navigation,
  dismissal without closing details, touch persistence and 200% zoom.
- Type checking, lint and production build pass. All 214 UI unit tests pass.
  Screenshot comparisons are browseable from
  `implementation-evidence/comparison/index.html`.

Still open: room/dashboard variant review, map placement/undo and inspector
acceptance, remaining sensor/re-enable checks, timer mode/target review, chart
empty/error visuals, and final shared navigation/recovery acceptance. No physical
household device was changed by these fixture journeys.

### Server checkpoint — 2026-09-29

Generic server timers (countdown, scheduled, ready-by; Helsinki migration),
reviewed assistant action scope, mixed native/script routine actions and
disabled-device scene suppression are implemented. Mixed scripts are prepared
against the triggering snapshot; native actions are dispatched only after all
selected scripts validate. Unselected branches do not execute scripts. Preview
does not execute scripts. Script output cannot recursively invoke script blocks.

Fresh verification during the visual audit:

- 177 automation library tests passed.
- Mixed script/native order, failure, recursive output rejection and stale
  revision test passed.
- Seven configuration diagnostic tests passed, including disabled-device
  suppression while preserving enabled-device errors.
- Both generic timer API tests passed: execution without a browser, restart,
  Helsinki migration, cancellation and end-action recovery.
- UI type/lint/build and 214 library tests passed at this checkpoint.

The visual and interaction acceptance gates above remain open. This is a
server delivery checkpoint, not a claim that the overall overhaul is complete.

### Initial audit

The active room route currently renders the full floorplan. The All devices page
already has basic sensor rows (correcting the initial inventory); these need
detail links and shared presentation. The shared scene picker still opens the
older rename/delete modal.
The three new widget types are absent from the current UI widget type union.
Existing health, state preview, nested group resolution and dashboard draft APIs
can be reused. Starting with room composition and shared live rows establishes
the same content needed by Rooms and Scenes widgets.

### Rooms, widgets and shared controls — implementation in progress

- Room routes now default to controls, scenes and sensors with an optional
  floorplan preview. The full map remains at `?view=floorplan`. Nested membership
  is shared by room controls, room cards and widgets. Missing members stay visible.
- Added Rooms, Scenes and Indoor climate widget types to catalog, options and
  rendering. Room/scene selections have ordering and explicit scopes; empty
  selections do not widen to the home. Climate uses the shared reporting source
  and existing sensor catalog/history; absent values are shown as unavailable.
- Shared light controls now expose power, brightness, color and scenes together.
  Removed duplicate color brightness sliders; color-only changes preserve each
  selected light's brightness. Wheel, swatches, image sampling, sliders and
  temperature remain available. Preview rings distinguish mixed/off/unknown.
- Scene capture opens an independent retained draft in the canonical editor,
  using stable device keys and the capability-aware requested-state capture
  helper. No scene is written before Create. Removed the superseded rename/delete
  scene modal and its unused state hook.
- Room/map sensor overlays lead with value and reporting status. Test events are
  explicitly advanced. Map fallback now exposes device controls when rendering
  is unavailable. Unknown routes show recovery destinations instead of silently
  redirecting home. Shared dashboard chrome has compact headings and borders.

Verification so far (not final acceptance):

- UI TypeScript checks pass. 14 targeted preview/capture unit checks pass.
- `everyday-widgets-journey.js`: 9 checks each at 1440px and 390px against isolated
  fixture API: real readings, missing humidity, option persistence, explicit
  empty scope, three renderer types and no page overflow.
- `everyday-capture-journey.js`: 12 phone checks covering direct controls,
  independent capture review, no early writes, retained navigation draft,
  canonical explicit creation, stable identity and preserved HS color.
- Real Rust integration test
  `everyday_widgets_preserve_options_existing_layouts_and_restart_export` passes:
  widget options persist, existing layout/widget remains unchanged, database
  restart and export/import preserve all three types.
- Fixture WebSocket scenes were corrected to the flattened runtime schema;
  the fixture previously sent authoring rows. This is verification plumbing,
  not a production schema change.

Remaining: actual acknowledged control/failure browser journeys, all room/map
variants and visual review, widget sizing/details/charts, timer persistence and
execution review, assistant previews/selection/link consistency, sensor panel
cleanup, calibration integration and final acceptance. Delivery gates remain
unchecked until their complete requirements are verified. Existing fixture
appearance selected the sky accent; production already has Compact green/slate
base tokens and user-selected accents must remain respected.

### Additional progress and confirmed timer scope

- User explicitly selected **Move scheduling to the server** for car-heater
  timers. Existing browser interval scheduling must be replaced, with migration
  of existing timers and a database-backed target-device association. This is
  required work, not a deferred limitation.
- Color calibration now uses the atomic editor API, shared Save/Discard,
  retained steps and explicit conflict review, preserving brightness points.
  Its 390px fixture journey passed 7 checks including stopped-on-close and no
  implicit preview resume. Individual assignment editor is converted; bulk
  assignment migration is still outstanding.
- Shared live command helper returns runtime outcomes. Power buttons show
  pending state. Desktop fixture journey passed 6 checks: exact device scope,
  no color/brightness mutation for power-only intent, room scene scope and
  honest runtime rejection. No physical-device success is inferred.
- Assistant action review now has explicit selected-device scope enforced by
  the API, current/proposed state rings and canonical entity links. Real API
  regression passed: empty selection writes nothing; invalid/out-of-proposal
  keys reject before writes; repeated requests and old empty-body requests
  remain supported. Browser proposal journey still needed.
- Search now uses display-name overrides, current values and canonical device
  destinations. Shared charts retain touch readings until dismissed. Widget
  chrome and detail surfaces use Compact borders; unsupported widgets preserve
  their type and show a repair link. Visual and interaction acceptance remains.

### Generic timers — confirmed expansion and implementation

The user expanded the old car-heater feature into a **Timers widget** with
configurable names/icons, all three modes (countdown, scheduled, ready by), and
device, room/group and scene targets. Scheduling runs on the server. The user
confirmed **Europe/Helsinki** for existing timers; enabled states, wall times,
repeat days and 40-minute warm-up are preserved in migration. The old UI-state
row is retired with a recovery copy so old browser clients stop scheduling it.

- Canonical schedules and execution checkpoints use reserved database widget
  setting `user_timers`, with typed API/bindings and backup validation. Widget
  instances only select which timer IDs to show; they never own execution.
- `/config/timers` exposes direct fields, retained drafts, Save/Discard and
  conflict checks. Names, icons, start/end actions and time zone are explicit.
  Related target links open canonical device/group/scene pages.
- Countdown expiry recovers after downtime. Scheduled starts over one minute
  late are skipped. A started timer's end action recovers after restart; failed
  end actions remain visible and retry every 30 seconds. Pending state assignments
  may replay after a crash; runtime acknowledgement is not physical delivery.
- DST gaps are skipped; repeated wall times run once at the earlier occurrence.
  Warm-up crossing midnight uses the ready-by day's weekday. Creating a ready-by
  timer during its warm-up window starts immediately and keeps its original end.
- Five scheduler unit tests passed. Two real-server integration tests passed:
  headless countdown execution, exact target and state preservation, conflict and
  import validation, SQLite restart, Helsinki legacy migration, and interrupted
  start recovery to the end action. Additional refinements remain under test.
- Phone and desktop editor journeys passed 11 checks each. Bulk calibration
  assignment now also uses an explicit retained scope and atomic Save/Discard;
  its interaction acceptance remains outstanding.

### Recovery and interaction checks

- Timer editor verification now waits for the newly added row before editing
  (the first version could race React when older timers already existed).
  The corrected phone journey passes; timer widget phone checks pass for selected
  scope, canonical links, start, cancel and overflow. Desktop refresh remains.
- Room phone journey passes 11 checks for deduplicated nested membership,
  unavailable members, no-map room, read-only controls, sensor detail links,
  empty/missing rooms and unknown-route recovery.
- Assistant phone review passes 9 checks: no early writes, labelled state rings,
  exact selected-device API scope, omitted-device labels, partial failure outcome,
  related detail navigation and retained conversation. Updated proposal summary
  no longer labels an entire partially selected proposal “Applied”.
- Color calibration phone journey now passes 9 checks, including an unfinished
  hue retained through closing and reopening. Invalid numeric input does not
  enable point confirmation or save. Shared brightness data remains preserved.
- Floorplan device rows now open the floorplan inspector instead of a separate
  side panel. Shared close controls have the same accessible name and 44px target.
  Rejected brightness commands release pending slider state without waiting for
  the fallback timeout. Chromatic controls exclude temperature-only lights.
- Existing Controls/Home widgets now resolve nested groups and retain scrollable
  contents. Helper widgets expose related settings and useful missing/loading
  states; technical revision details follow the shared advanced preference.
  Text/link/image/embed widgets have configuration recovery links, and images
  have an explicit failed-load state and retry. Acceptance of these refinements
  is still in progress.
