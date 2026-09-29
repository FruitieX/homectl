# Approved overhaul — implementation tracker

Status: **active**. User approved Study 04 and authorized the entire plan on 2026-09-29. Goal: implement PLAN.md + INTERACTION-SYSTEM.md + FINAL-PASS.md, using Study 04 for routine/scene presentation. This file is the durable progress ledger; unchecked work is still required.

## Scope and working rules

- Preserve the unrelated in-progress automation/script/scenario changes present at kickoff. Do not overwrite or revert them.
- Work in the current workspace. On 2026-09-29 the user explicitly requested a commit and push checkpoint before continuing with other views. Deployment is not requested.
- Database is canonical for shared advanced-details and reporting policies. No runtime settings in TOML.
- Match actual schemas, omission semantics and write outcomes. Preserve raw unknown fields, meaningful order, secrets and stable node IDs.
- Complete each slice with real integration/type/interaction checks. Prototype images are design references, not production evidence.

## Delivery checklist

- [ ] 1. Foundation: tokens, one location hierarchy, navigation, shared sections/controls, retained typed drafts, one entity save bar, errors/conflicts, return links, scroll/focus context, preferences and preview primitive.
- [ ] 2. Rooms & groups: open direct editing, direct/linked multi-member selection, missing reference repair, usage links, cycle validation, create/delete, save/reload and retained navigation.
- [ ] 3. Scenes: aligned desktop rows / phone cards, all state/link/color variants and capabilities, maps/order/precedence, draft resolution, scripts/overrides, related links, create-from-routine return.
- [ ] 4. Routines: approved three-lane guided flow, every trigger/condition/action/program/policy variant, nested branches and timers, reorder and stable IDs, unknown/version preservation, actual preview/activity, enabled-by-default creation.
- [ ] 5. Devices: metadata editing, source/membership links, capability-aware live controls distinct from config, reporting overrides, calibration/shared shell.
- [ ] 6. Integrations: directly editable fields, typed arrays/maps/nested collections for all modules, secrets, reload/error semantics, reporting defaults.
- [ ] 7. Remaining settings: helpers, computed sources, sensors/widget sources, assistant/preferences, floorplan/dashboard shell, backups/restore and compatibility routes.
- [ ] 8. Backend contracts: atomic write preconditions, useful conflict responses, unambiguous persistence results, database preferences/policies with export/import round trips.
- [ ] 9. Health: fresh receipt evidence including unchanged sensor reports, retained-message/startup rules, one attention evaluator, transition/recovery logs with structured references.
- [ ] 10. Troubleshooting: compact logs, activity/diagnostics, overview attention, bounded search/filtering and direct repair links.
- [ ] 11. Cleanup/acceptance: remove superseded edit surfaces, field coverage ledger, round-trip tests, failure tests, typecheck/lint/build/Rust checks, real phone/desktop/keyboard/zoom screenshots.

## In progress

Replacement editors are implemented for the main entity families, sensor catalogs, shared widget sources, assistant/system/appearance, dashboard layouts/widgets/arrangement, backup/restore and legacy import. Reporting policies, receipt evidence and shared attention have targeted backend/browser verification. Floorplan editing now has a combined draft/save contract and native-input verification. Routine activity now has compact rows, recorded references, filtering and targeted browser/backend verification. Calibration consistency and the complete cross-family acceptance audit remain. Existing public routes and useful API hooks are retained while authoring surfaces are replaced. The unchecked delivery gates remain required.

### Latest: dashboard arrangement (2026-09-29)

- Resizing, reordering and removal now share a retained arrangement draft and explicit Save/Discard. Related widget navigation keeps the arrangement discoverable. Keyboard controls support resize and reorder; canceled pointer gestures restore the prior arrangement.
- One batch API checks a complete baseline and preserves widget content/credentials. Explicit removals cannot silently delete widgets added since review. Database writes use one transaction; a rejected transaction leaves runtime unchanged.
- Eleven browser checks pass on desktop and phone, including failed-save retention, conflict review preserving remote content, and staged removal. Native Chromium mouse/touch checks pass, including touch cancellation. Two Rust tests prove API preconditions and transaction rollback after an injected failure. Production build passes. Evidence is in implementation-evidence/.
- Remaining dashboard acceptance: all option/omission variants, malformed-definition repair, creation retry and deletion races, broader keyboard/zoom coverage. Backup/restore is the next slice; inspection found runtime replacement versus database upsert inconsistency that must be corrected.

## Verification log

Record commands, outcomes, and concrete limitations here as each slice lands. Do not mark the goal complete while any required slice remains.

### Foundation / Rooms & groups progress (2026-09-29)

Implemented:

- Settings category rail replaces the application rail while inside settings; phone category menu; one parent breadcrumb in the app header. Removed shared detail/list Back + breadcrumb duplication.
- Overview has visible category destinations, counts, configuration search, recent links and actual diagnostics. No category accordions or duplicate creation shortcuts. Fresh-report health is still pending.
- Session-only typed entity draft store, one Save/Discard bar, retained-draft return links, reload warning, per-field validation/focus, explicit concurrent-change review and preservation of edits made during an in-flight save. Existing persistence warnings remain visible.
- Group list/detail/create replaced with direct editing, multi-select member pickers, missing-reference repair, linked-group navigation, inherited membership, usage links, consistent removal controls, and requested-state preview rings. The API rejects duplicate creation, stale expected values and nesting loops inside the state actor.
- Shared `StatePreview` supports structured HS/RGB/XY/temperature, independent brightness arc, off/unknown/mixed/unchanged states and accessible values. Scene/routine integration remains pending.
- `GET/PUT /api/v1/config/preferences`: shared `show_advanced_details`, stored as the reserved `settings_ui` database setting. Explicit save in App & system → Appearance, expected-value conflict check, preservation of unknown preference fields, legacy defaults and database export/import coverage.
- Settings scroll/focus context retained in memory. Group search query is retained in URL. Application's timed refresh now skips unsaved drafts.
- Device catalog requests are shared/cancelable, expose errors and refresh. A failed catalog read no longer labels all group members missing.

Verified:

- TypeScript check and targeted frontend lint pass.
- 12 draft/group-graph tests pass (draft retention, conflict review, save-in-flight edits, nesting and v1/v2 usage).
- Rust group API conflict/nesting tests pass. Preferences legacy/unknown-field test and database export/import round trip pass.
- Production UI build passes; existing bundle-size warning remains.
- Chromium at 1440×1000 and 390×844: edit → related scene → return retains draft; navigation does not save; explicit Save and Discard work; 409 review preserves unrelated remote changes; multi-select updates one draft; validation focuses Name; no horizontal overflow. Saved evidence under `implementation-evidence/`.
- Repeatable browser journey: `ui/dev/settings-group-journey.js`, runnable through `ui/dev/cdp-probe.mjs --eval-file ...`; it requires the marked isolated development fixture on port 3021. Expected 409 is part of the test; fixture assistant-status 404 is unrelated to these flows.

Remaining foundation acceptance: expand draft/CAS coverage to every editor, secret-safe field-specific conflict presentation, full keyboard/zoom/failure verification across page families, nested return-from-create context, and final navigation taxonomy/compatibility cleanup. Scenes are the next implementation slice. The entire goal remains active; the top-level checklist is intentionally not marked complete yet.

### Scene slice source notes for the next work block

Read the current backend again before implementing (other scenario/script work is ongoing):

- `core/scenes.rs::compute_scene_device_state`: DeviceLink reads controllable state **or Color sensor state**, multiplies brightness while powered on (missing source brightness/multiplier each defaults to 1), and supports DeviceRef lookup. SceneLink resolves the **same destination device** in the linked scene and may override transition. Explicit state preserves optional brightness/color/transition and defaults omitted power to true.
- Group target order is saved `group_state_order`, then **alphabetically sorted** unlisted group IDs (`core/scenes.rs` near 674). Current `sceneTargets.ts` says insertion order and must be corrected.
- Scene script materialization is last-good cached output; script execution is off-actor. Rechecked during the scene implementation: ordered group targets are followed by explicit device targets, then evaluated script output, then stored runtime overrides. The earlier note that scripts are inserted first was incorrect. A frontend draft must not claim that a changed script was evaluated when it only has saved output.
- Current `sceneEffects.ts` is insufficient: HS-only color, treats empty explicit `{}` as invalid, uses scene-link scope as destinations, and does not resolve device-link brightness. Replace its authoring preview path with a structured resolver validated against backend behavior; preserve other consumers until migrated.
- Current schema includes `mirror_from_group` on scene activation descriptors and action rollout fields. Inventory against the live bindings/source, not only the original planning table.

### Scenes progress (2026-09-29)

Implemented:

- Replaced list/detail/new with one retained entity draft and explicit Save/Discard. Desktop uses aligned target rows; phones use labeled cards. Existing IDs are compact metadata; ordinary controls are directly editable.
- Explicit state, follow-device and follow-scene targets; all four wire color formats; staged color dialog; separate hue and brightness ring; target filtering, multi-add, removal/repair and group precedence reordering. Inactive mode values are retained in the session draft. Omitted values are kept omitted; turning off retains color and brightness.
- Related group/device/scene links and Used by; create-from-routine return route; duplicate; requested-state capture in the device section. Saved activation is a separate confirmed command with timeout uncertainty messaging.
- Read-only `POST /config/scenes/preview` uses isolated runtime copies and the actual script worker. It does not save, publish materializations or command devices. Native and script states show provenance; changed inputs mark the result stale. Saved runtime overrides are visible.
- Scene writes check expected values atomically. Fixed scene-link cycles in both state resolution and dependency traversal after the native preview test exposed a stack overflow.

Verified:

- 24 pure scene/color tests pass; existing 13 core scene tests pass.
- Three Rust scene API tests pass, including worker execution, script errors, precedence, source links, cycle termination, unchanged runtime and stale-save rejection. The worker test is explicitly run with `--include-ignored` after building `script-worker`; it is marked ignored for a bare library-only build that has no worker executable.
- Browser journey at 1440×1000 and 390×844: 10 checks each pass (off/color preservation, color Cancel, related navigation, save round trip, target ordering, native preview, multi-add, no overflow). Test: `ui/dev/settings-scene-journey.js`; evidence under `implementation-evidence/`.
- Typecheck and targeted lint pass. Script preview was verified against Rust, not the fixture, which explicitly rejects scripts.

Remaining scene acceptance: field coverage ledger/unknown legacy target repair, capability and partial-resolution warnings, keyboard/zoom and failure matrix, and create-from-routine return once the new routine editor lands. Foundation conflict review still needs nested/secret-safe presentation. Routines are the next slice.

### Routines progress (2026-09-29)

Implemented:

- One retained draft and explicit Save/Discard for creation and editing; new routines enable after creating by default. Atomic expected-value checks and revision increments reject stale writes.
- Open three-lane When / Only if / Then flow, responsive colored vertical lanes, inline controls, ordered branches and nested conditions, stable node IDs, duplication/reordering, timers, native and script programs, execution policies, actual preview and saved activity.
- Related entity links and create-scene → return-to-action flow retain all pending edits; no intermediate routine is saved.
- User clarification: **legacy routines are read-only, including metadata and enable state, until converted**. Removed legacy RuleBuilder/ActionBuilder editing surfaces and legacy duplication. Conversion review reuses the server’s existing pure converter; using the proposal creates a v2 draft and does not write until Save. Unsupported definitions remain inspectable/exportable.
- Existing offline conversion remains available: `cargo run --manifest-path server/Cargo.toml -- convert --source-db <database> --cron-timezone Europe/Helsinki` reports a dry run. `--apply --archive <archive.json>` writes convertible rows with the server stopped; `--restore <archive.json>` supports rollback. Do not infer the household timezone for an actual conversion; use its original cron timezone. No household upgrade was run during UI development.

Verified:

- Repeatable `ui/dev/settings-routine-journey.js`: 12 checks pass at 1440×1100 and 390×844, including enabled-by-default creation, new-scene return, explicit save, stable IDs and branch reordering.
- Eight pure draft/routine serialization tests pass. Four API tests pass, covering stale writes, duplicate creation, racing saves and conversion-preview non-mutation.
- Inspection of the complex phone fixture found nested grid content extending outside its block despite no document overflow; fixed minimum grid sizing and based field columns on each block’s available width. Controls now fit the viewport.

Remaining routine acceptance: complete variant/omission field ledger, malformed/unknown input repair, multi-value preview assumptions, conversion UI/error verification, keyboard/zoom/failure matrix and final screenshot review. The overall overhaul remains incomplete.

### Devices, logs and conflict review progress (2026-09-29)

Implemented:

- Replaced the 2,400-line expanding device list/editor with compact searchable rows, stable detail pages, shared sections, retained drafts, directly editable display names and sensor-control mappings, related integration/group/scene links and requested/reported preview rings. Kept color/brightness calibration wizards, profile assignment and bulk assignment/removal.
- New GET/PUT /config/device-settings combines the existing label and sensor-config tables into one editing scope. Atomic actor baseline checks; one database transaction saves both values or neither. Unknown sensor configuration is preserved. No new configuration storage format is introduced.
- Compact logs with 36–37 px desktop rows in the checked fixture, 54–73 px phone rows for its one-/two-line messages, full message dialog, source/level/search URL filters, pause/resume and bounded rendering. No fabricated explanatory messages; health transition messages and entity links remain pending.
- Conflict review now offers nested object field choices, masks credential values including nested collections, and preserves unrelated remotely changed siblings. Arrays and changes of variant are reviewed as units so reordering cannot merge unrelated indices.

Verified:

- Device journey: 12 checks each at 390×844 and 1440×1100. Direct editing, related navigation, no implicit save, metadata+sensor save, unknown-field preservation, Discard, conflict retention, latest-value Discard and viewport fit.
- Two Rust tests pass: actor stale-write/scope handling and transaction rollback after an injected database failure. Existing sensor payload survives; explicit clearing removes both settings.
- Logs: full details and pause/resume checked in Chromium; row heights measured at both viewports.
- Nested conflict and credential masking unit tests pass. Typecheck and targeted lint pass; production build passes after the compact-log/conflict refinements; existing bundle-size warning remains.

Remaining device acceptance: reporting-policy controls and unified health evidence, complete referenced-routine links, missing/error states for related catalogs, calibration keyboard/mobile/failure checks and final field coverage. Remaining logs acceptance: structured health references, recovery messages, large-buffer/keyboard checks.

Next engineering slice: integration editor replacement and complete typed collection coverage. Investigation found that ordinary integration list/get/create/update responses currently return stored secrets directly; use the schema’s password fields and existing assistant redaction/preserve-omitted helpers for the API contract, including masked conflict baselines and backup export/import behavior. Existing integration reload is two-phase under config_write_lock and must retain that structure. Do not run upgrades against the household database.

### Connections, helpers and computed sources progress (2026-09-29)

Implemented:

- Replaced connection list/detail/new with compact rows and one retained draft. Schema-driven direct fields include multiple MQTT sensor paths and disabled IDs, ranges, capability overrides, partial management and dummy-device maps with nested initial state. Unknown extension fields have recursive controls. Cron/timer/circadian integrations are read-only and excluded from new creation, with links to their replacement concepts.
- Integration API responses now omit schema-defined passwords and report presence only. Omitted secrets survive ordinary saves/import; explicit clearing is distinct. A process-keyed revision token detects stale writes, including secret changes. Conflict responses are redacted; ordinary exports omit these integration credentials. Download saved integration configuration never includes an entered draft password.
- Replaced helper list/create/detail with direct fields, ordered enum options, cached type variants, explicit definition saves and a separate current-value command. Current values follow websocket updates without overwriting pending definition edits. A save that would reset an incompatible current value explains and confirms that reset. Helper writes compare definition baselines inside the actor, reject duplicate creation, and return the full status.
- Replaced computed-source list/create/detail with open settings, day/night profile controls, color/brightness rings, multiple alias rows, retained computation variants, custom scripts, typed parameter collections, output-device and scene references. Preview is explicitly requested, bounded/cancelable, and visibly stale after input changes. Unsupported custom-script preview remains honestly unsupported by the existing backend; no invented evaluation. Source writes compare baselines and increment revisions atomically inside the actor.
- Found and corrected a temperature-unit error in the shared scene/device preview code during source-schema review: `DeviceColor.ct` and capability ranges are **Kelvin**, not mireds. Controls, labels, defaults and preview colors now use Kelvin directly. Earlier scene tests checked representation preservation without proving this unit; the added backend and browser assertions close that specific gap.
- Shared config request timeouts retain drafts and explain that a timed-out save may already have been applied.

Verified:

- Integration API tests: 3 pass (credential omission/token changes; preserve/clear/stale/duplicate writes; redacted backup import). Connection browser journey: 12 checks pass at 390×844 and 1440×1100, including multi-entry save, related navigation, conflict review and password removal from the saved browser draft.
- Helper API test passes: duplicate creation and stale/deleted definitions rejected; an immediate value change does not invalidate a definition-only baseline. Browser journey: 11 checks pass at both viewports, including type-variant retention, enum ordering, command/config separation, conflict merge, reset confirmation/cancellation and Discard.
- Source API tests: 2 pass (strict source validation; create/stale/revision behavior and actual 3000 K wire output). Browser journey: 8 checks pass at both viewports, including 4200 K editing/preview/save, aliases, stale preview, variant retention and conflict review. Fixture preview samples are explicitly synthetic; this journey verifies the UI contract, not curve evaluation.
- Added pure Kelvin behavior and integration range/extension-key regression coverage. Typecheck and targeted lint pass; production build passed after helper replacement, with final source build recorded separately below.

Remaining for these slices: complete module/variant field-coverage ledger; dummy multi-device browser coverage; malformed/unknown-definition repair; integration reload-failure verification; source preset/custom-script replacement and unsupported-version handling; complete routine/source reference indexing; keyboard/zoom and failure matrix. Recursive JSON number staging and variant-cache behavior after collection reordering need final acceptance. Integration/device reporting-policy controls and unified attention remain unimplemented.

Next major work: database-backed reporting policies and receipt evidence/unified health, followed by the remaining settings families (sensor/widget sources, assistant/system, backup/restore, floorplan/dashboard integration). The full goal and all top-level acceptance gates remain active.

Final checks for this pass: 27 selected pure draft/color/integration tests pass; TypeScript and targeted lint pass; production build passes after the computed-source changes (`/tmp/homectl-settings-source-build.log`, existing bundle-size warning). `git diff --check` passes. Browser evidence for connections/helpers/sources is copied into `implementation-evidence/`. No live household configuration was modified.

### Reporting policies, attention and diagnostics progress (2026-09-29)

Implemented:

- Database-backed inherit/custom/ignore policies use reserved per-integration/per-device widget-setting rows, included in normal backups. Direct controls participate in the owning entity's existing Save/Discard and conflict scope. Integration defaults commit with the connection configuration after successful lifecycle work; combined database writes are transactional. Deleting an integration removes its default. Per-device metadata remains associated with its stable device key, like existing labels and sensor settings.
- Shared health evaluator records fresh receipt evidence even when a sensor value stays unchanged. Cached/discovery replay does not refresh deadlines; superseded integration events cannot change evidence. Monotonic deadlines survive wall-clock jumps. Warmup, new devices, re-enabling and MQTT transport reconnects get reporting grace without manufacturing receipts. Automatic defaults only impose an interval where the integration/source guarantees a cadence.
- Ignore suppresses missing-report warnings while explicit offline signals and configuration references remain visible. Health warnings and recovery messages occur on transitions, with structured device/integration links and policy evidence in the bounded UI log buffer.
- GET /config/device-health provides one health snapshot plus deduplicated affected device keys from diagnostics. Overview, device list/detail, integration attention, diagnostics, report status and floorplan indicators now consume shared evidence. Removed the floorplan's separate ten-minute timeout. Logs support structured device filtering and related entity links.
- Diagnostics now uses compact open rows, direct repair/log links, the shared advanced-details preference, URL-backed filters, request cancellation/timeouts and automatic refresh.

Verified:

- Six Rust health tests pass: integration/device policy precedence, event-only defaults, unchanged sensor receipts, retained messages, wall-clock jumps, Ignore/offline behavior, warmup/startup/re-enable/reconnect grace, transition deduplication/recovery and rejected stale integration epochs. Reconnect event handling is checked without counting it as a device report.
- Four integration API tests pass, including policy-only token invalidation, omitted-policy preservation and invalid-policy rejection, alongside existing credential checks. Two device API/database tests pass with policy included in the editing scope and rollback assertions.
- Three reporting-policy tests pass: integration API scope; database export/import/default-compatible omission and malformed-policy rejection; rollback of integration settings when policy persistence fails. Invalid reserved policy rows are rejected before runtime import applies.
- Browser journey `ui/dev/settings-health-journey.js`: ten checks pass at 1440×1100 and 390×844, covering inheritance, explicit saves, mode retention, device overrides, deduplicated attention, Ignore retaining offline evidence and device → log details → device links. Fixture health is explicitly synthetic: it verifies presentation/interactions; Rust tests verify receipt/deadline behavior.
- Diagnostics rendered at both viewports with six warning rows and no row overflow. Three floorplan presentation tests pass using the shared evaluator, including unknown state when health is unavailable. The old test's TypeScript transpiler dependency was replaced with Node's native type stripping because the installed compiler does not provide that legacy API.
- Generated UI bindings updated. Typecheck, targeted lint, git diff --check and production build pass after diagnostics/health changes (existing bundle-size warning). Evidence under implementation-evidence; logs in /tmp/homectl-health-*.log and /tmp/homectl-settings-health-build.log.

Remaining health acceptance: computed-source failures before any successful output are not yet represented by a source health record; complete source-error/alias coverage, real MQTT reconnect/discovery fixture coverage, health-plus-broken-reference deduplication against the actual API, and broader keyboard/failure checks. Integration reconnect event tests prove actor behavior, not a live broker session. The full overhaul remains incomplete.

Next slices: sensor catalogs/widget sources, assistant/system, backups/restore, floorplan/dashboard shell and activity consistency; then complete the field-coverage ledger and the remaining acceptance matrix across every editor. No household configuration was modified.

### Sensor catalog, system behavior and assistant progress (2026-09-29)

Implemented:

- Dedicated Sensor catalog page with directly editable sensor names, enabled state, ordered sensor/group collections and multiple group members. Related navigation retains drafts; Save/Discard and stale-write review use the shared editing system. Removing a sensor stages removal from catalog groups. Widget selections remain separate. Removed the old sensor name/group autosave authoring from the widget overlay and linked it to the catalog.
- Catalog API validates identifiers, duplicates and group references, preserves unknown fields and ordering, allows an empty catalog, and compares the expected catalog inside the actor. Dashboard sensor reads now respect disabled entries and supported sources.
- System Behavior uses explicit saves for warmup and transition defaults, retained mode values and atomic baseline checks. The core API now distinguishes omitted transition fields from explicit null and zero.
- Assistant provider settings use open direct controls, retained drafts, explicit Save/Discard, context-window editing and staged credential replacement/removal. API responses expose credential presence and a process-keyed revision token; secret-only changes invalidate stale saves. Omitted keys and unknown stored fields survive updates. First stored saves preserve effective environment defaults, including credentials.

Verified:

- Sensor catalog browser journey: nine checks pass at desktop and phone sizes, including multiple entries/members, explicit saves, navigation retention, conflicts, extension preservation, validation focus and viewport fit.
- System behavior browser journey: eight checks pass at desktop and phone sizes, covering tab navigation, retained modes, null versus zero, conflict merge, validation and Discard.
- Assistant browser journey: eleven checks pass at desktop and phone sizes, including secret-safe conflict review, staged credential removal, navigation retention, explicit saves and validation. Expected 409 responses are deliberate conflict tests.
- New catalog and core API regression tests pass. All 48 selected assistant tests pass, including secret-only conflict detection and preserve/clear behavior.
- TypeScript, targeted lint and diff checks pass. Production UI build passes with the existing bundle-size warning. Latest logs: /tmp/homectl-settings-system-build.log and /tmp/homectl-settings-assistant-tests.log. Browser screenshots currently reside in /tmp/settings-{catalog,behavior,assistant}-{desktop,phone}.png.

Remaining: appearance controls and widget source/selection editing still need the full shared interaction treatment; malformed stored catalog repair, large catalog navigation, complete optional-field coverage, dashboard data verification and environment-fallback credential regression coverage remain. Backups/restore, floorplan/dashboard shell, activity consistency and the full cross-page acceptance matrix are still outstanding. This is implementation progress, not completion of the overall goal. No live household configuration was changed.

### Appearance and shared widget sources progress (2026-09-29)

Implemented:

- Appearance now uses open compact sections, native labeled radio controls, one retained browser draft and explicit Save/Discard for theme, accent, density, blur and developer mode. Existing browser-local scope is unchanged; shared advanced details remain a separate database-backed scope. Shared preference requests now have cancellation/timeouts.
- Browser tests exposed an existing density initialization problem: a saved compact choice could render with comfortable density after reload. Existing appearance atoms now initialize from storage. The system-theme listener remains active outside the Appearance page.
- Added Widget sources list/detail routes for weather, trains, InfluxDB and calendar, with independent retained drafts, source links from the sensor catalog, direct controls, credential presence, staged replacement/removal, validation and conflict review. These edit shared services; per-widget selections and overrides remain separate.
- New GET /config/widget-sources and PUT /config/widget-sources/{key} use runtime snapshots and actor baseline checks, existing widget-setting database rows and normal persistence status responses. A process-keyed revision token includes secrets and unknown stored fields. Unknown fields survive saves; tokens/private calendar URLs are absent from responses, including conflicts.
- Explicitly empty source values now suppress the deployment environment fallback. Previously clearing a token could reactivate its environment value. Omitted fields still use the fallback. No new bootstrap settings or persistence format was added.

Verified:

- Appearance journey: seven checks pass at desktop and phone sizes, covering pending edits, tab navigation, Discard, explicit application/persistence, directly available troubleshooting controls, native radio labeling and viewport fit.
- Widget source journey: eleven checks pass at both sizes, covering related navigation with a pending credential, no implicit writes, credential-safe conflict review, staged removal/Discard, URL validation/focus and fit. Fixture responses verify the UI contract; Rust tests verify actual API behavior.
- Two backend source tests cover credential omission/preservation/clear, token invalidation, stale writes, unknown-field preservation, invalid URL rejection and explicit-empty versus omitted fallback semantics. The source-list test also checks private calendar URL redaction.
- TypeScript, targeted lint and diff checks pass. Production UI build passes with the existing bundle-size warning. Screenshots for appearance/widget sources and the previous catalog/behavior/assistant slice are copied into implementation-evidence/.

Remaining: dashboard/widget authoring still needs retained drafts and the shared editing treatment, including per-widget credential override masking and complete selections. Shared source malformed-data repair and complete failure/keyboard acceptance remain. Backups/restore, floorplan/dashboard shell, activity and the broader acceptance ledger remain outstanding. The implementation goal is active; no live household configuration was changed.

### Dashboard forms, widget selections and credential contracts (2026-09-29)

Implemented:

- Added Dashboards settings list, layout detail/create and widget detail/create routes. Open sections expose names, default layout, content controls, widget size/position/order, extension fields and related entity/source links. Forms use retained drafts, explicit Save/Discard, validation focus and stale-write review. New widget type switching retains each type's pending options and credentials. Unknown/malformed widget definitions remain read-only.
- Dashboard edit/add entry points now navigate to these shared editors. Removed the superseded layout/widget authoring overlays. Existing browser-only resize-snap/screen-preview preferences have their own explicit-save scope. Dashboard layout selection accepts a URL parameter so related links return to the intended layout.
- Replaced comma-separated device selection with multi-pickers. Sensor widgets distinguish All from Selected, including an explicitly empty selection. Unavailable selections remain visible/removable and survive mode changes. Related helper/group/device links and shared source links retain widget drafts. Dashboard data rendering respects disabled catalog entries and displays an explicit empty-selection state.
- Dashboard layout/widget API writes now check expected revision tokens inside the actor, serialize configuration writes, report actual persistence status, validate dimensions/layout existence and preserve omitted widget credentials. Tokens detect credential-only changes. Widget tokens and private calendar URLs are absent from reads/save/conflict responses and ordinary backups; redacted reimports preserve existing credentials.
- Widget data requests use a saved widget ID to resolve overrides on the server. A caller cannot combine a widget ID with an arbitrary URL/token override. Calendar transport errors strip private URLs before logging.
- Fixed divergent creation IDs: actor-assigned layout/widget IDs are now inserted/upserted exactly in the database, including explicit IDs during import. Layout default changes remain transactional. Layout removal accurately states that its widgets are deleted too.

Verified:

- Widget browser journey: twelve checks pass at desktop and phone sizes, including retained credential drafts across source navigation, type switching, empty selections, extensions, secret-only conflicts, Discard, dimensions and creation.
- Layout journey: six checks pass at both sizes, covering widget navigation, explicit rename, stale-save retention, latest-value Discard, validation focus and fit.
- Dashboard rendering journey: four checks pass against synthetic sensor readings: catalog names/disabled flags, displayed values, credential-free request URLs and an empty selection staying empty with available data. This exposed and fixed a missing empty-state message. The catalog was changed through the fixture API; the check waits for its normal polling interval.
- Backend API regression passes for masked credentials, preserve/clear, stale saves, extension/selection preservation, backup redaction/reimport, widget-source identity checking and layout deletion. SQLite regression passes for assigned IDs, fractional dimensions, empty selection/extension round trip and one-default behavior.
- TypeScript, targeted lint, four existing dashboard structural checks and git diff --check pass. Production build passes with the existing bundle-size warning. Evidence is copied into implementation-evidence/.

Remaining dashboard work: the visual drag/resize/reorder tool still writes on release and needs a retained arrangement draft with explicit save and an atomic batch contract; complete field/omission validation, malformed-definition repair, create retry/idempotency behavior, deletion/concurrency acceptance and keyboard/zoom/failure checks. The structural tests only guard source-level regressions; browser journeys supply interaction evidence. Backups/restore, floorplan shell, activity and the overall acceptance audit remain outstanding. No live household configuration changed; the goal remains active.

### Backup/restore review and atomic persistence (2026-09-29)

Implemented:

- Replaced the old two-card/immediate-import overlay with open export/restore sections and an inline affected-entry review. Each configuration collection has add/replace/remove/unchanged counts; changed field names and IDs respect the advanced-details preference. Existing entity links retain the uploaded backup and review in session memory. Filtering and bounded rendering handle long change lists. Review receives focus and scrolls into view on completion.
- Credentials remain excluded by default; the export choice explicitly includes them when needed. Restore uses a separate destructive confirmation only for replacement/removal. Invalid files, failed requests and stale reviews cannot be applied through the primary action; the file remains available for review or Discard. API requests are bounded/cancelable; JSON backup uploads have a 32 MB limit.
- Read-only POST /config/import/preview validates the backup and lists every ConfigExport collection, core settings and scenario suite. It returns identities and changed field names without credential values. Version/section mismatches, duplicate IDs, broken group links/cycles, invalid helpers/sources/catalogs/policies/calibration/widget placement and invalid enabled routines fail review. Existing omitted matching credentials are preserved. A process-keyed token binds both the current snapshot and exact candidate, including credential changes; POST /config/import?expected=... rejects stale reviews before applying anything.
- Fixed a runtime/database inconsistency: runtime import already replaced the full snapshot, but database import previously upserted many collections and let absent rows reappear at restart. Database restore now replaces configuration in one transaction, with child rows ordered correctly, exact dashboard IDs, forward group links and secret payload preservation. Operational history and cached device observations are outside the configuration replacement. Named timer jobs are canceled as before. An injected write failure rolls back the entire database snapshot.
- Fixed save_version=true storing the incoming backup as “Before import”; it now records the current setup. Restore outcomes use actual persistence status, invalidate configuration caches, and retain global memory-only warnings. A persisted full restore clears obsolete persistence warnings for the replaced configuration.

Verified:

- Backup browser journey: thirteen checks pass on desktop and phone, including non-mutating review, related navigation, confirmation cancellation, injected failure, conflict/re-review, explicit restore, memory-only warning, invalid file and Discard. The fixture is synthetic; Rust tests establish actual parsing/precondition/persistence semantics.
- Six selected backend backup tests pass, including a read-only secret-safe preview, secret-only stale conflict, exact-candidate binding, successful runtime restore with credential preservation, memory-only response, unknown-version/section rejection and transactional replacement/rollback.
- All sixteen database configuration regression tests pass, covering existing helpers, calibration, reporting preferences/policies, scenarios and dashboards alongside restore. TypeScript, targeted lint, diff check and production build pass. Final phone review screenshot confirms focus on Review changes and no overflow. Evidence lives in implementation-evidence/.

Remaining backup acceptance: full large-file/large-change-list and keyboard/zoom matrix, complete nested unknown-field/legacy-format coverage, and end-to-end integration lifecycle failure/restart checks with a real database. The database failure test proves rollback of persistence; the existing API can still apply a runtime snapshot and then report failed or unavailable persistence, which the UI explicitly presents as not saved. This is not an all-or-nothing claim across external integration lifecycle work and database persistence.

Next slice: floorplan editing currently saves the name, grid and image separately; image upload/removal writes immediately and navigation loses the grid draft. Replace that authoring shell with a retained per-floorplan draft and shared Save/Discard, preserving FloorplanGridEditor drawing behavior. Investigated ui/app/config/floorplan/page.tsx and server/src/api/config.rs floorplans/floorplan routes; no floorplan edits made in this pass. Activity/migration and the full field/failure/accessibility ledger also remain required. No live household configuration was modified; the goal is active.

### Floorplan editing and native input (2026-09-29)

Implemented:

- Floorplan name, grid and background image now share one retained entity draft and explicit Save/Discard, including creation, staged image replacement/removal, related device/room navigation, and confirmed deletion. Unsupported stored layouts remain preserved and downloadable; users can import a supported replacement without silent normalization.
- New GET/PUT/DELETE /config/floorplans/{id}/editor exposes image metadata without bytes and a revision token covering name, layout and image. Updates reject stale/missing baselines and duplicate creation, validate changed layouts/image payloads, commit one runtime row and persist the complete row with honest write outcomes. Compatibility floorplan writes now serialize with this scope and report persistence failures. Removing the last floorplan no longer invents an empty default.
- Drawing preserves labels and unknown layout/placement fields. Dimensions commit on blur/Enter, reject invalid values and limit total canvas cells. Native touch/mouse gestures, cancellation rollback, keyboard tile selection/painting, zoom and panning are supported. Rendering is bounded independently of grid coordinates. Display options remain open beneath the canvas; placed-device removal uses separate accessible buttons. Editing is disabled during a save, including keyboard interactions.

Verified:

- Thirteen browser journey checks pass on desktop and phone for combined save, staged images, retained navigation, conflict recovery, creation/deletion cancellation, extensions and fit; the final phone rerun includes the control rearrangement. Native desktop checks (four) and phone checks (five) pass for drawing, Discard, keyboard input, zoom/pan without page overflow, and touch cancellation. Evidence is in implementation-evidence/settings-floorplan-*.
- Two actual Rust editor tests pass for complete-row writes, image preservation/removal, duplicate/stale rejection, invalid geometry/image validation and deletion. Two backup API regressions pass after the legacy-default correction. Four frontend layout/conflict tests, typecheck, targeted lint and production build passed before beginning the activity slice. The build retains the existing bundle-size warning.

Remaining floorplan acceptance: large-grid performance, geometry-specific conflict presentation, full legacy upload endpoint validation and real database failure/restart journeys. The API can apply runtime state then report unavailable/failed persistence; tests do not claim cross-runtime/database rollback. No live household configuration was modified.

Next: routine activity and migration consistency, followed by the complete field/failure/accessibility ledger. The overall goal remains active.

### Routine activity, recorded references and navigation (2026-09-29)

Implemented:

- Replaced tall repeated history cards and stat panels with compact outcome rows. Recorded reasons and coalesced blocked counts are visible; expanding a row shows full evidence, steps, conditions, triggers and direct routine/device/log links. Advanced metadata follows the shared preference. Container width controls the desktop/phone row layout, including enlarged text beside the sidebar.
- Search, exact routine selection, outcome and event-type filters live in the URL. The routine editor's existing `?routine=` activity link now actually filters the page. Pause freezes displayed records; Resume restores polling. Results sort by timestamp and render 100 entries at a time. Failed refreshes preserve the last successful response; empty history does not invent evidence of absent device events.
- Routine history reads now share React Query state with cancellation and a 15-second timeout. Routine detail uses the same outcome summaries and orders recent entries by timestamp. Sparse evaluation records no longer claim that a run occurred; legacy records without a condition trace still correctly describe a recorded run.
- Native steps carry optional typed related-entity references recorded from the actual action payload. Scene/device/group/helper/routine/integration IDs retain their kinds, including colliding scene/group IDs and scene-cycle candidates. Older persisted records deserialize with no references and keep their original target text. Recorded trigger/action links focus the matching current flow block; missing blocks receive an explicit explanation that the definition changed.
- Boxed configuration filter boundaries after an actual library build exposed Warp's recursive filter type exceeding the compiler's query-depth limit. Routing order and rejection behavior are retained. Regenerated and formatted TypeScript bindings. Updated prototype documentation headers to accurately link to active implementation status.

Verified:

- Seventeen browser journey checks pass on desktop and phone: compact rows, blocked evidence, typed links, exact trigger focus, retained draft navigation, exact routine filtering, pause/resume, failed-refresh retention, bounded larger lists and viewport fit. Synthetic 503s are deliberate failures. `ui/dev/settings-activity-journey.js` runs only against the marked local fixture.
- Native Chromium keyboard checks pass for opening/closing evidence and tabbing to related links. A 200% CSS zoom check exposed clipped rows; container-based layout fixed this, and the final check now verifies both page and row overflow. This checks CSS enlargement; it does not substitute for the remaining browser-zoom/screen-reader matrix across all settings.
- Four frontend evidence-semantics tests pass. Fifteen Rust native planning tests pass, including typed-reference serialization, identifier collisions and backward-compatible history. Eleven routine-history tests pass, including SQLite round trip/pruning and clearing old run evidence from blocked entries. Binding export, TypeScript, targeted lint and production build pass; build retains the existing bundle-size warning.

Remaining activity acceptance: end-to-end real-server traces covering every suppression kind, reference labels from current catalogs, current-definition versus historical revision navigation, and screen-reader review. Existing history keeps only bounded records; this slice does not introduce durable unlimited audit history. No live household configuration changed.

Next required slice: legacy migration. Inspection found that changing import scope clears the uploaded file, preview navigation loses state, failed requests discard review, and the apply contract has no preview precondition. Migration currently merges selected sections by ID and imports legacy routines as read-only entries. Replace its authoring shell with a retained upload/selection/review; preserve merge semantics, expose replacement/skipped-entry consequences and bind apply to a reviewed snapshot. Calibration consistency and the full cross-family acceptance/field ledger remain required. The goal is active.

### Legacy import review and retained upload (2026-09-29)

Implemented:

- Legacy import now retains its upload, selected sections and reviewed changes across related navigation. Changing scope invalidates review without clearing the file. After a successful connections pass, the file remains available for a later discovery/import pass. Open sections, shared confirmation and explicit Import/Discard replace the former shell.
- Read-only `/config/migrate/review` and guarded `/config/migrate/import` bind import to the exact uploaded text, selected scope, current configuration and resolved device references. Stale reviews fail before applying changes. Selected rows merge by ID; unrelated saved entries remain intact. Missing integration plugins and invalid selected core values are rejected, while unselected malformed sections do not interfere.
- Review exposes additions/replacements and skipped references without credential values. Omitted existing credentials survive import. Skipped references require explicit acknowledgment; routines whose references were dropped are disabled. Imported legacy routines remain read-only until converted. Syntax errors do not echo uploaded credential-bearing lines.
- Failed/uncertain imports keep the upload but require a fresh review. Actual persistence status remains visible. Backup and legacy-import tabs now use consistent labels; the backup legacy-routine warning links to the filtered routine list.

Verified:

- Nine Rust migration tests pass for merge behavior, sanitized review, credential preservation/clear, stale file/configuration/discovery rejection, explicit skip acknowledgment and affected-routine disabling.
- Desktop journey: 15 checks; phone journey: 16 checks including navigation after a successful first pass. Four native-keyboard/CSS-enlargement checks pass. Evidence and screenshots are in `implementation-evidence/settings-migration-*`.
- Production Rust library build passed; its unused-import warning was subsequently fixed. UI typecheck, lint and production build pass. CSS enlargement is not a substitute for the remaining full browser-zoom/screen-reader acceptance matrix.

### Calibration save contract groundwork / checkpoint (2026-09-29)

- Added a revision-bound calibration editor API that can save a profile and assign it in one operation. Profile/assignment persistence uses one database transaction; an injected second-assignment failure proves that both changed and newly created profiles roll back. Shared-profile changes validate all affected devices and refuse changes while a relevant preview session is active.
- Calibration retains its existing database-first policy: unavailable/failed persistence leaves calibration configuration unchanged. Successful changes reapply normal device state using the new calibration. This API does not start live previews.
- **The existing calibration wizards are not yet connected to this contract.** Retained wizard drafts, shared actions, conflict review, preservation of the other calibration channel in the UI, and preview stop/save ordering are still required. This is groundwork, not a completed calibration slice.
- The user requested this commit/push checkpoint before further view work. Everyday dashboard/room/live-floorplan/assistant redesign is outside this checkpoint and has not been added to the active implementation scope. The overall settings goal remains active.
- Checkpoint verification: all 210 frontend library tests pass; full frontend lint, TypeScript and production build pass. Rust library suite passes 787 tests with one ignored, including calibration transaction rollback and actual API stale/invalid-write rejection. The API test caught differing float serialization between read/conflict responses; both now serialize the same typed view directly. Logs are under `implementation-evidence/homectl-checkpoint-*`. These checks do not close the unchecked acceptance gates above.
- Push preparation merged `origin/main` without rewriting remote history, retaining its route-type bounding fix and Motion dependency update. Equivalent scenario changes were deduplicated; scenario-suite validation and transactional import remain covered. The frontend was rebuilt after a frozen-lockfile dependency install.
- Rust formatting and Clippy with `-D warnings` pass after formatting fixes and use of `BuildHasher::hash_one`. The full workspace test sweep (`cargo test --all --locked --no-fail-fast -- --test-threads=1`) exercised SQLite restart, hot reload, assistant, HTTP, script worker and six PostgreSQL tests. Older tests expecting leaked passwords, an invented default floorplan or no disabled-routine warning were updated to assert the new contracts. The final sweep's only failures were three such configuration expectations; a subsequent focused run of all five relevant floorplan/migration tests passed. The original sweep log and successful rerun are both retained rather than presenting the sweep as a single green invocation. No production code changed after that sweep; only those test expectations and documentation changed.

### Brightness calibration drafts and live preview lifecycle (2026-09-29)

Implemented:

- Brightness calibration uses a retained session draft and the combined calibration editor API. Device links, Close/reopen and the retained-draft strip preserve input values and wizard position. A URL parameter opens the retained wizard; related-link matching correctly handles its section hash. Incomplete numeric input remains visible and blocks review rather than snapping to an old number.
- Save stops the live preview first, creates/assigns the profile atomically, preserves the color channel and its matching metadata, and keeps other lights on their existing shared profile. Removing brightness is staged until Save and retains color calibration. Subsequent edits use a fresh profile ID; retries retain the pending ID. Failed saves leave the draft available.
- Stale saves offer an explicit review of changed profiles/assignments before rebasing the API baseline. Keeping local brightness edits uses the latest saved color values on retry. Shared inline Save/Discard and preview rings are used; Discard remains available while conflict review is pending.
- Reusable preview sessions have unique IDs, ordered requests, bounded fetches, heartbeat handling and queued cleanup. Reopening a draft does not restart a live preview. Leaving during an in-flight start queues its stop after that request, preventing a late response from leaving the lights in a preview session. The misleading old “Looks matched” action that reset output is now labeled “Reset this point.”

Verified:

- Desktop browser journey passes 14 checks; final phone run passes 15, adding pending-start navigation cleanup. Both cover no implicit writes, draft retention, stop failure preventing save, failed persistence with no orphan profile, conflict review, other-light isolation, staged removal and viewport fit. Fixture failures are intentional; the fixture does not simulate physical light behavior.
- Four native Chromium keyboard checks pass for radio selection, incomplete numeric editing, step controls, Discard and no writes. A 200% CSS-enlargement check verifies page/input fit. This does not replace the full browser-zoom and screen-reader acceptance matrix.
- A real-server integration test proves active-preview save rejection without mutation, combined persisted writes, both channels preserved, stale rejection, isolation of another assignment, and profile/assignment survival across a SQLite restart. TypeScript, targeted lint and production UI build pass. Evidence is in `implementation-evidence/settings-brightness-*` and `homectl-calibration-editor-api.log`.

Remaining calibration work: connect the color wizard and profile assignment controls to the shared draft/save contract; preserve original unedited color anchors; provide equivalent conflict/navigation/session coverage; complete capability, missing-device and failure acceptance. Calibration as a whole and the full settings goal remain incomplete. No live household configuration was changed.
