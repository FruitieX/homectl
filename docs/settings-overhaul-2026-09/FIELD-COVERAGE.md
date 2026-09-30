# Authoring field coverage

Updated: 2026-09-30. Companion to [PLAN.md](PLAN.md#collection-and-variant-coverage-gate)
and [ACCEPTANCE-AUDIT.md](ACCEPTANCE-AUDIT.md). This is an evidence inventory;
rows marked **open** are not acceptance sign-off. Paths below are relative to
`ui/`. Browser fixture writes prove UI serialization, not database durability.

## Evidence rules

- **Edited** means an interaction journey changed the named collection and
  checked the saved API value. **Preserved** means an unrelated edit retained it.
  These are different claims.
- An empty list/map, an omitted optional property, explicit null, false and zero
  must remain distinct where the API distinguishes them.
- Ordering is significant for routine steps/branches/cycles, scene group
  precedence and user presentation order. Membership lists must not acquire
  execution-order semantics from their display order.
- Unknown definitions remain visible and preserved. Legacy routines and
  cron/timer/circadian integrations are read-only or explicitly converted,
  following the user's instruction; they do not need a new legacy editor.
- Tests of a shared primitive do not replace domain validation or a complete
  variant's load/edit/save/reload check.

## Collections required by the plan

Group schema clarification (2026-09-30): the current API accepts `GroupRow`
(`server/src/db/config_queries.rs`) with required `id`, `name`, `hidden`,
`devices[]` and `linked_groups[]`. These fields are not nullable; the older
optional `GroupConfig` is an import/runtime representation, not the editing
contract. `device_keys[]` is derived in responses and deliberately omitted from
editor writes. Group rows have no opaque extension map, so fixture-only unknown
properties must not be used to claim server persistence of extensions. The
shared-picker checkpoint covers staged selection, missing/cyclic references
and keyboard behavior; the following collection checkpoint separately verifies empty/single/multiple
Save/reload and database persistence.

| Contract | Renderer and empty/add/remove behavior | Order | Existing fixture evidence and remaining work |
| --- | --- | --- | --- |
| Group `devices[]`, `linked_groups[]` | `app/config/groups/editor.tsx`, `shared.tsx`: separate direct-device and linked-group pickers; empty group allowed; missing members remain repairable | Membership; preserve submitted arrays | `dev/settings-group-journey.js` edits members and retains drafts/conflicts; `lib/groupGraph.test.ts` checks cycles/missing members. `dev/group-collections-review.mjs` adds 27 checks at 1440/390/360 px: exact empty/single/multiple Save/reload, retained missing references, replacement, deletion and creation races. Database reopen/restore and SQLite/PostgreSQL migration tests cover ordered and unresolved memberships. |
| Scene `group_states`, `device_states` maps | `app/config/scenes/editor.tsx`, `target-row.tsx`: add multiple targets; remove a target; empty maps remain maps | Group map uses `group_state_order`; device overrides are separate | `dev/scene-collections-review.mjs` now edits both link variants, persists multi-add/remove and target replacement, removes all targets, and reloads empty maps. Existing scene journey covers color editing and Discard. |
| Scene `group_state_order[]` | Same editor; target actions move earlier/later; removed targets leave the order list; unresolved order entries normalized by resolver helper | Explicit precedence; remaining targets deterministic | Scene journey edits and saves order; `lib/sceneDraft.test.ts` and `sceneTargets.test.ts` cover ordering/resolution. |
| Scene-link `device_keys[]`, `group_keys[]` | Scene target row's linked-scene scope controls; selected device/group collections | Scope membership, not action sequence | `dev/scene-collections-review.mjs` edits multiple devices/groups, removes unavailable references, and distinguishes empty arrays from omitted default scope. These are stored activation descriptors: target-level scene links resolve the same device regardless of these scopes (`core/scenes.rs` and `lib/sceneDraft.test.ts`). |
| Routine `triggers[]` | `ui/TriggerBuilder.tsx`: add/change/remove start blocks, preserve IDs; empty definition subject to compiler validation | Retained authoring order; multiple subscriptions | `dev/routine-triggers-review.mjs` edits and saves all eight trigger kinds, both schedule modes, bounded catch-up and optional report-field removal. Stable IDs, false predicates, exact duration units, navigation and reload are checked. Existing routine journeys cover ordering/removal; remaining nested predicate/unknown-value contracts are listed below. |
| Nested condition `all.conditions[]`, `any.conditions[]`, `not.condition` | `ui/ConditionBuilder.tsx`: recursive condition rows; All/Any require a child; Not remains unary | Preserve nesting and sibling order | `dev/routine-conditions-review.mjs` edits nested All/Any/Not trees, moves unfinished numeric drafts, changes/restores whole subtrees, saves and reloads. Nine Rust evaluation tests cover three-valued truth tables, errors, missing/offline readings and Not. Existing draft tests reject empty All/Any groups. |
| Native `steps[]` and `choose.branches[].steps[]` | `ui/ProgramBuilder.tsx`: direct fields, add/remove/duplicate/move; empty native sequence shown honestly | Sequential; first matching branch, stable IDs | Routine journey edits/moves/duplicates/saves branch subtrees, including a script. `lib/routineDraft.test.ts` checks identity and opaque payload preservation. **Open:** variant matrix below. |
| `cycle_scenes.scenes[]` | `ProgramBuilder` cycle rows: add/remove/move scenes, per-entry fields | Explicit cycle order | `dev/routine-selection-review.mjs` edits, reorders, removes/adds and saves entries with independent targets/transitions/extensions. The timing journey also checks independent rollout, unfinished transition remapping and removal. Empty cycles now show repair guidance beside Add scene; Save focuses that control without writing, and Discard restores entries. The expanded journey passes 19 checks per size; the corresponding compiler rejection test also passes. |
| `TargetSpec.devices[]`, `groups[]` | `ProgramBuilder.TargetSpecEditor`: independent device and group multiselects; empty means the action's documented default, not invented “all” behavior | Scope membership | `dev/routine-selection-review.mjs` edits multiple activation targets, cycle detection targets, entry scopes and timer capture. **Open:** dim/random-color consumers and empty/default targets; do not infer their semantics from activation. |
| `SceneSelection.mapping` and optional fallback | `ProgramBuilder.SceneSelectionEditor`: helper-option-to-scene rows and fallback selector | Keyed mapping | `dev/routine-selection-review.mjs` edits several mappings (including `__proto__`), removes an obsolete option, switches helper/group/fixed modes, retains independent fallbacks, navigates to the helper, saves/discards and reloads. `dev/routine-reference-review.mjs` adds unavailable helper/scene recovery, exact name-only preservation and explicit repair Save/reload. **Open:** empty mapping compiler validation. |
| Timer `capture_target_intents` | `ProgramBuilder` schedule/replace timer controls with target picker | Optional captured scope | `dev/routine-selection-review.mjs` adds/removes scope members, retains the edited scope through off/on, saves every member and extension, then saves capture disabled as omission. Empty capture is rejected by the compiler (`compile.rs` timer validation test); existing stale-intent tests cover execution separately. |
| Source `aliases[]` | `app/config/sources/detail.tsx`: repeatable text rows, add/remove, validation of unique full keys | Preserve array; aliases have no execution sequence | `dev/source-editor-review.mjs` edits, removes/adds and reloads multiple/empty aliases; duplicate keys are blocked. `source-repair-review.mjs` explicitly repairs a malformed null value. Source creation/color/conflict coverage remains in the existing journey. |
| Helper enum `options[]` | `app/config/helpers/fields.tsx`: direct rows, add/remove/up/down; invalid initial selection must be repaired explicitly | Display order retained | `dev/helper-editor-review.mjs` edits/reorders/removes options; validates empty/duplicate lists and removed initial values; verifies Cancel and confirmed reset when the current choice is removed. Existing helper journey additionally covers creation and conflict review. |
| MQTT `sensor_value_fields[]`, `disabled_device_ids[]` | `app/config/integrations/fields.tsx` `StringEntries`: repeatable rows, add/remove/up/down; malformed values use typed JSON fallback | Preserve configured order | `dev/mqtt-editor-review.mjs` edits both collections, adds/removes/reorders entries, blocks invalid pointers/blank device IDs, saves empty arrays and reloads. `lib/integrationDraft.test.ts` checks every pointer. Malformed non-list repair remains a separate open case. |
| Legacy cron schedules map | `app/config/integrations/detail.tsx`: visible read-only definition and current-format destination/offline conversion guidance | Preserved until explicit conversion | Deliberately not editable. `server/tests/convert.rs` verifies two Helsinki schedules, exact persisted v2 definitions and enabled states, disabling the converted cron integration, idempotent reporting, and restoring every original schedule from the archive. |
| Dummy `devices` map | `app/config/integrations/fields.tsx` `DummyDevices`: keyed add/remove, direct initial-state and capability fields | Keyed identity; no semantic order | `dev/dummy-editor-review.mjs` saves/reloads multiple default/controllable/sensor devices, all four sensor variants and empty maps; remove/recreate clears metadata. Rust tests confirm shapes and null defaults. `dev/dummy-repair-review.mjs` adds 11 checks per size for malformed collections/entries, unknown initial variants and invalid colors; explicit repair, Discard and exact sibling preservation are covered. |
| Sensor catalog `sensors[]`, `groups[]`, group `sensor_ids[]` | `app/config/sensors/page.tsx`: catalog/group/member row controls, empty selections supported | Three independent presentation orders | `dev/sensor-order-input.mjs` verifies saved orders, independent memberships, widgets and group charts; catalog journey covers configuration editing. |
| Dashboard layouts/widgets and per-widget selections | `app/config/dashboard/widget.tsx` and designer: type gallery, sources, size/order, retained per-type options | Layout order, sizes and explicit selection order | `dev/widget-design-journey.js`, `widget-preview-input.mjs`, `sensor-order-input.mjs`. All 17 types and defaults are mapped in WIDGET-OPTIONS.md with edited/empty SQLite reopen/restore payloads. The new 22-check browser journey covers missing scene/room/sensor/timer repair and numeric/selection behavior; remaining external-source/helper recovery follows the cross-family gate. |
| Calibration profile assignments | Calibration configuration and bulk selection flows | Keyed device assignment; profile data preserved | `dev/calibration-bulk-journey.js` checks exact assignment/removal and unchanged profiles. `dev/calibration-recovery-review.mjs` adds 15 checks at 390/1440 px for capability filtering, missing-reference repair, stopped previews and initial/cached catalog Retry with retained edits. See IMPLEMENTATION.md for consolidated evidence; broader recovery/accessibility remains open. |
| Extension JSON maps/lists | `ui/settings/JsonValueEditor.tsx`: recursive typed fields, explicit null/default, add/remove; number input keeps unfinished text without changing the domain type | Lists offer up/down; maps retain keys including escaped names | **Edited:** `dev/collection-editor-review.mjs`, 14 checks at 1440/390 px, numbers/type changes/reorder/remove/re-add/Save/Discard/navigation. `lib/entityDraft.test.ts` covers delayed saves and metadata remapping. Nesting beyond 12 levels is preserved read-only; it is not claimed as fully editable. |

## Variant and optional-field audit still to close

The following are the actual contract groups to reconcile, not a claim that
one generic JSON control completes their product UI. Bindings mirror the Rust
schema; server compiler/resolver behavior remains authoritative.

| Schema group | Current controls | Required remaining fixtures |
| --- | --- | --- |
| `TriggerSpec`, `StateChangeMode`, `ScheduleSpec` | `TriggerBuilder`: report, state change, predicate transition/held, schedule, timer fired, startup, manual; schedule/timezone/backlog controls | Each trigger edited; report field omitted/present; change modes; cron/interval; explicit Helsinki timezone; catch-up lateness required only for catch-up. |
| `ConditionExpr`, `ValueSource`, comparison operators, group quantifiers | `ConditionBuilder`: literal, All/Any/Not, comparison, group; device/helper/source values | The condition journey saves all 11 comparison operators and all four group quantifiers, edits device/helper/computed-source choices, optional scene removal and false/zero/structured values. Value-free operators omit their operand. Source paths and type drafts restore; malformed/future sources remain visible for explicit removal. The compiler rejects top-level null operands, now explained in the JSON dialog; nested nulls persist. Remaining unavailable-reference recovery is part of the final cross-family gate. |
| `NativeAction` | `ProgramBuilder`: script, activate/cycle, power, dim, random color, choose, schedule/replace/cancel timer, helper write, routine invocation | The action journey edits and reloads singular SetPower device/power, multi-device/group dim and random-color targets, timer names/delays, all four helper value types and both invocation modes/references. Other scene/choose/script journeys are recorded separately. Remaining declaration/reference cases stay open. |
| Scene selection, cycle entry, rollout | `ProgramBuilder` scene/target/transition/selection/rollout controls | Direct/helper/group modes, independent fallbacks, stale-key removal and cycle scope/order are edited in the routine selection journey. The timing journey edits rollout source, off/on restoration, omitted/zero/bounded spread, explicit transition precedence and cycle-specific values. **Open:** unavailable references and runtime spatial behavior reconciliation. |
| `ProgramBody`, `ScriptSpec` declarations | `ProgramBuilder`, `RoutineScriptEditor`: native/mixed scripts; explicit whole-script conversion; declaration rows | The declaration journey edits device/group/timer/all-state references, future IDs, empty/multiple lists, type restoration, row removal and independent script blocks. Omitted server defaults, unsupported data review and conversion extensions are covered. Compiler tests verify defaults, supported API/profile and the 32-declaration limit. Database persistence reconciliation remains open. |
| Scene explicit/device-link/scene-link state | `app/config/scenes/target-row.tsx`, shared color controls | Scene collection journey edits explicit/device-link/scene-link modes, source and multiplier, default power, zero brightness/fade, full stored scopes, missing-target replacement, and retained inactive variants. Nullable transition and unknown siblings survive. Color variants/capture and creation-return still need ledger reconciliation. |
| Helper boolean/enum/number/string and initial value | Helper definition fields plus separate current-value control | All four types and initial values now have edited save/reload evidence, including false/zero/empty text/optional bounds. Separate command tests cover rejection, pending state, acknowledgement and retained configuration drafts. Visibility and full dependency-link reconciliation remain open. |
| `SourceCompute`: circadian compatibility, script preset, custom script | Source detail, day/night color controls, params JSON, script editor, draft preview | Edited pinned/custom/built-in computations, exact forked and edited bodies, unknown-pin conversion, null/list/object params, extra-field preservation, switches/Discard/reload and preview recovery now have native browser evidence. Timing-input/error-focus is covered by the source timing checkpoint; complete visibility/reference reconciliation remains open. |
| Integration config primitive/JSON fields; MQTT mode; dummy state/capabilities | Schema fields plus typed adapters | Missing/null/false capability overrides; Kelvin bounds; payload paths; secret unchanged/replace/remove; malformed known collection repair; reload failure without misleading “saved” state. |
| Device overrides, reporting preferences, shared advanced preference | Device settings, reporting field and system preferences | Tie each default/inherit/custom/ignore state to exact backend persistence/export test; disabled-device suppression already has separate regression evidence. |
| Widget types, source references and optional dimensions/settings | Visual widget designer and sources pages | WIDGET-OPTIONS.md now maps every field/default to its renderer and the expanded all-type database round trip. Existing 17-type preview evidence proves composition/inertness; 22 additional native checks per size cover numeric and reference repair. |
| Floorplan metadata/grid/image, calibration profile/session state | Purpose-built editors | Existing placement/bulk journeys prove edits; reconcile omitted/missing references, image failure and session lifecycle cases with the API ledger. |

## Latest verified repair

`JsonValueEditor` previously removed the numeric control when its contents were
cleared. Its index-based type cache could also restore another list item's value
after reordering. Raw numeric drafts now live only in the entity draft store,
block Save while incomplete, survive navigation and follow collection edits.
Completed numeric values alone enter the API payload. Type caches and raw inputs
are remapped on moves/removal, removed object/device entries clear their metadata,
and a save response clears only the raw inputs included in that submission.
Clean refresh/conflict acceptance cannot leave a valid but stale numeric display.

Verification: 14 browser checks at each viewport, ten entity-draft unit checks,
and current UI unit/type/lint/build gates. Captures and logs are in
`implementation-evidence/collections/`. No household configuration was changed.

Scene follow-up: `scene-collections-review.mjs` passes 18 checks at 1440/390 px.
Scene behavior/power use the shared selector; references use the searchable
picker and keep their Open button aligned on phones. Missing selected scope
entries remain removable. Target removal clears cached variants; replacement
moves them to the replacement target without prefix collisions. Captures/logs
are in `implementation-evidence/collections/scene-collections-*`.

Routine follow-up: dynamic/fixed and helper/group choices now retain their own
session drafts, including mappings and fallbacks. Timer capture retains edited
targets through an off/on switch. Mapping rows wrap on phones, have named controls,
and link to helper details. Future or malformed selection shapes remain read-only.
The native interaction journey passes 16 checks at 1440/390 px for selection,
target and cycle entry/detection collections, Save/Discard, repeated saves and
reload. A unit guard verifies unsupported/malformed selection shapes. All 222 UI
unit tests, type/lint/build and the settings-tab regression checks pass. The
server's `v03_range_duration_and_capability_errors_are_rejected` test passes,
including explicit empty capture rejection. Logs/captures are under
`implementation-evidence/collections/routine-selection-*`.

Two shared defects were found during this journey: inline picker result clicks
could activate their enclosing label and reopen the picker on phones, and the
installed query-cache merge dropped an own `__proto__` JSON key on refresh,
causing subsequent expected-value conflicts. Picker result clicks now suppress
that extra label activation. The query cache preserves own keys while retaining
unchanged branch identities. A failing-before/passing-after cache regression
records the actual loss; no household configuration was changed.

Next: typed integration/helper/source cases and the remaining trigger/condition/
policy/action variants. Continue to expand the individual-field and backend
round-trip evidence before closing PLAN.md's coverage gate.

### Typed dummy-device checkpoint

`dev/dummy-editor-review.mjs` performs 19 checks at both 1440 and 390 px on an
isolated, disabled integration. It edits and saves boolean false, numeric zero,
empty text and color-state readings; switches sensor and whole-device types;
retains separate drafts across navigation; checks incomplete numeric inputs,
Discard, multiple devices, remove/recreate, reload and an empty device map.
Null initial state displays the server's default light and remains null after an
unrelated save. Unknown sensor siblings are preserved through a boolean edit;
this is preservation evidence, not a complete unknown-definition repair journey.

Device/type/capability choices use shared selectors. Temperature mode changes
retain the custom range; incomplete Kelvin inputs stay visible instead of
becoming zero. Whole-integer/u16 limits and nullable capability distinctions are
validated. `integrations::dummy::tests` confirms all four sensor shapes and the
capability distinctions against Rust deserialization (2 tests). UI validation
also rejects malformed maps, entries and initial states without silently replacing
them. Dedicated browser repair coverage remains open.

Desktop device cards use two columns; phone cards remain one column. These are
Compact-style adaptations without a dedicated approved integration mockup.
Screenshots/logs are under `implementation-evidence/collections/dummy-*`.
All 225 UI tests, type checking, lint and production build pass. Remaining
integration cases include MQTT collection editing/profile switches, secrets,
management variants, optional-field resets and reload failures. Helper/source
and remaining routine variants are still open.

### MQTT collections and recovery checkpoint

`dev/mqtt-editor-review.mjs` passes 21 checks at 1440/390 px: edited sensor paths
and disabled-device lists, add/remove/reorder, invalid entries, explicit empty
arrays, profile switches and retained navigation drafts, partial management,
null/false/omitted booleans, capability reset after an unfinished number, password
preserve/replace/clear, Discard, reload and retained new-connection type drafts.
Only its own disabled fixture integration is created, changed and removed.

`dev/mqtt-recovery-review.mjs` passes 9 checks at each size. A deliberately injected
HTTP 500 leaves the input and error visible; Retry commits the retained draft and
reload shows the acknowledged value. Its console HTTP 500 is expected evidence.
The shared reporting selector retains a custom interval and saves custom, ignore
and inherited modes. This is UI response handling, not a real broker failure.
The actual server rollback is covered separately by
`core::integrations::tests::invalid_reload_preserves_existing_integration`.
Four `api::config::integrations::tests` pass for credential masking, omitted-secret
preservation, stale/duplicate requests, redacted backup imports and reporting
baselines. Type checking, lint and production build pass.

The schema-backed selects and new-connection type picker now use SettingsSelect.
Switching away from partial management retains its nested flag and extension
fields. Resetting an optional field clears its raw-input and variant metadata,
so a hidden incomplete number cannot keep Save blocked. Stored null booleans are
shown explicitly; selecting their stored value cannot coerce it into false.

Remaining integration audit cases include the complete ESPHome/profile-specific
field inventory, malformed collection repair, and explicit legacy conversion
coverage. The broader helper/source and routine variant gates remain open.

The existing phone health journey was adapted to the shared policy selector and
passes all 10 checks: integration inheritance, device override, retained interval,
deduplicated attention, Ignore preserving explicit offline evidence, and related
log navigation. It uses the normal isolated household fixture and synthetic health
evidence. Log: `implementation-evidence/collections/mqtt-health-390.log`.

### Helper types, choices and commands checkpoint

`dev/helper-editor-review.mjs` passes 21 checks at each 1440/390 px: both ordering
directions, duplicate/empty options, unavailable initial choice, removing the
current choice with cancel/confirmed reset, false/zero/empty text, optional bounds,
type draft retention, navigation, session persistence, Discard and reload.
Definition writes never become a separate `/value` command. A still-valid current
value survives a definition save; an incompatible one resets only after the UI's
explicit confirmation. Empty enum drafts are editable but cannot be saved.

`dev/helper-command-review.mjs` adds six checks at each size: a deliberately
rejected live-value command retains its chosen value; a paused request disables
its control and does not claim success; the acknowledged retry changes the live
value while preserving the unsaved definition. Its HTTP 503 console entry is
expected. Both native journeys create/remove only their own fixture helpers.
The existing phone helper journey now uses shared selectors and passes 11 checks,
including creation, keyboard selection, conflict review and related navigation;
its HTTP 409 is an intentional conflict.

Server evidence: two `core::helpers::tests` validate scalar/enum contracts and
preserve/reset behavior, the helper API concurrency test passes, and
`db::config_queries::consistency_tests::helper_definitions_and_durable_values_round_trip`
passes for durable/session export policy and old-export defaults. This database
fixture covers enum/string definitions; it is not a claim of a complete per-type
restart test. Type checking, lint and build pass. Visibility/picker filtering,
complete dependency links and the wider responsive/accessibility matrix remain
part of the final audit; computed-source variants are next.

### Computed-source variants and preview checkpoint

`dev/source-editor-review.mjs` passes 16 checks at each 1440/390 px: edited
built-in/pinned/custom computations, zero brightness, ordered alias removal/add,
empty aliases, exact edited script text, list/null/object parameters, computation
switches, retained navigation drafts, Discard and reload. Parameter editor paths
are scoped by computation identity; hidden numeric errors cannot block another
computation. Preset forking offers “Return to custom draft” when a custom draft
already exists, preserving its script and parameters.

`dev/source-repair-review.mjs` passes 13 checks at each size. A synthetic unknown
`circadian@99` pin keeps its opaque parameter list visible without the version-1
form. A malformed null alias value remains explicitly repairable. Conversion to
custom preserves those parameters; forking a known preset copies the exact shipped
body and defaults, then removes the pin. Preview states distinguish unsupported
custom scripts, successful empty results, a deliberately injected HTTP 503 and a
successful retry. These preview requests issue no definition writes. Unknown
fixture definitions are converted before saving; this is not a claim that the
real API accepts unknown preset pins.

The existing phone source journey passes eight creation/color/conflict checks,
including Kelvin display, stale preview labeling and remote timing/revision
preservation. Its HTTP 409 is intentional. Three new UI contract tests verify
parameter shapes, aliases and computation identities; all 228 UI tests pass.
Eight targeted Rust preset/preview/API tests pass for strict pins, parameter
contracts, local-day sampling, read-only previews and revision checks. Type/lint/
build pass. The fixture serves the actual shipped preset body; generated chart
samples remain explicitly synthetic. No live household configuration was changed.

Still open: source visibility and complete dependency-link reconciliation, and source database round-trip
coverage in the broader persistence audit. Native browser evidence is serialization
and interaction coverage, not a database restart proof.

### Source timing and numeric draft checkpoint

Nineteen checks in `dev/source-timing-review.mjs` pass at both 1440/390 px.
Cleared and incomplete numbers stay in the session draft, survive navigation,
and reset on Discard. Save focuses the corresponding field without writing.
Validation covers fractional hours, overlapping fades, exact-midnight crossings,
brightness bounds and sub-millisecond refresh values. A 1.001-second refresh
persists as exactly 1001 milliseconds. Zero brightness and an omitted endpoint
remain distinct through Save/reload. Computation switches clear inactive input
errors and retain the last valid per-type values until Save/Discard.

An invalid profile blocks new previews and marks retained samples as stale.
The phone screenshot exposed chart labels shrinking with the SVG; time labels
now retain a 12 px size in Compact mode, and the chart is at least 144 px high.
Both viewports verify those dimensions. The fixture's samples remain synthetic,
not a claim about this edited profile's computed output.

All 230 UI tests, the four circadian curve/validation Rust tests, type checking,
lint and production build pass. Screenshots/logs are in
`implementation-evidence/collections/source-timing-*`. This closes typed timing
and validation-focus review, leaving the reference/visibility and database gates
listed above open. No live household configuration was edited.

### Routine starts and duration controls checkpoint

Fourteen native browser checks pass at each 1440/390 px in
`dev/routine-triggers-review.mjs`. The fixture edits every trigger kind:
calendar/interval schedules, report fields, state-change mode, held and transition
predicates, named timers, startup and manual. It saves false predicates, removes
an optional report field, and preserves stable node IDs. These checks concern
authoring and serialization, not actual scheduling/execution of the fixture.

Calendar/interval switches retain separate schedule drafts until Save/Discard.
Switching catch-up off now omits its lateness field; the old hidden value caused
server validation failures. Switching it back on before Save restores the edited
lateness. Interval schedules cannot acquire calendar-only backlog settings.
Selectors for schedule type, backlog, state-change mode and duration units now
use the shared controls.

Trigger duration fields retain incomplete raw text and the selected units across
navigation, focus validation errors and reset on Discard. Switching away from a
trigger type clears its inactive numeric errors. A 1.001-second duration remains
exactly 1001 milliseconds when displayed in minutes and saved, both in a trigger
and a timer action. The shared duration parser rejects incomplete, negative,
sub-millisecond and unsafe values; all 232 UI tests pass. The server compiler's
`k01_calendar_grammar_and_policy_are_validated` test passes, as do type/lint/build.

Screenshots in `implementation-evidence/collections/routine-triggers-*` retain
Study 04's dotted background, colored columns, direct fields and visible move
buttons. The isolated fixture provides synthetic runtime badges/preview results.
Remaining gates include nested conditions/value sources, unknown definitions,
action-specific targets/rollout and execution-policy fields. The generic duration
control's trigger drafts are covered here; unfinished action/policy durations
still need their per-editor draft paths during that follow-up.

### Nested routine condition checkpoint

`dev/routine-conditions-review.mjs` passes 32 checks at each 1440/390 px.
All/Any/Not subtrees and value types retain their last valid drafts through type
changes. Incomplete numbers stay editable, follow their condition on reorder,
survive navigation and focus on Save. Removing an action with an unfinished branch
condition clears that discarded input state. Stable paths isolate trigger, main
condition and branch editors; indexed child paths move with collection edits.

All 11 comparison operators and all four group quantifiers are explicitly saved.
Exists/Truthy now omit the operand rather than sending a hidden value rejected by
the compiler. Switching back before Save restores the previous operand. The journey
covers false predicates, zero, optional group scene removal, structured values
containing nested null/false/zero, and unrelated extension fields. Device and
computed-source field paths restore when changing references; helper references
remain linked. Group scenes now have related-page links and missing-scene labels.

A malformed future source fixture stays visible without a rendering exception;
it is explicitly removed before Save. This proves repair and preservation while
viewing, not server acceptance of unknown definitions. The JSON dialog rejects a
top-level null with an explanation because the current server treats that operand
as missing. A new compiler test verifies this contract alongside false, zero,
empty text, arrays, objects and value-free operators. No runtime semantics changed.

All 234 UI tests, nine targeted Rust condition evaluation tests, the new compiler
contract test and type/lint/build pass. Screenshot review caught truncated phone
source names; narrow blocks now stack source and field controls. Wider desktop
blocks keep side-by-side controls. The gallery retains Study 04's dotted canvas,
colored columns and nested rails. Evidence is under
`implementation-evidence/collections/routine-conditions-*`.

Remaining routine gates: action/target/rollout fields, execution policy, remaining
script/program variants and cross-family reference/recovery acceptance. All browser
writes use the marked local fixture; runtime badges there are synthetic.

### Routine execution and scene timing checkpoint

`dev/routine-timing-review.mjs` passes 25 checks at each 1440/390 px. All
three execution modes save and reload, with a validated whole-number action
limit (1–64) and optional positive minimum spacing. Incomplete numbers survive
navigation; Discard restores the saved value. Duration units preserve exact
milliseconds, including 1.001 seconds. Invalid fields block writes and receive
focus, including fields inside a previously collapsed optional section.

Activation and cycle transitions use shared selectors and validate positive
explicit overrides. “Instant unless overridden” describes the server's actual
precedence: an explicit transition wins over the scene-transition flag. Rollout
source changes and off/on toggles retain the last valid draft before Save. Fixed
device references and extension fields survive editing. Zero spread, omitted
spread and the ten-minute bound are checked independently. Cycle-entry raw drafts
follow reordering; removing an invalid entry clears its discarded error.

All 234 UI tests, the server compiler's rollout validation test and its v0.3
range/duration/capability test pass, along with type/lint/build. Browser writes
use the marked local fixture; Save/reload demonstrates serialized editor values,
not database durability or live spatial execution. Captures are scrolled to the
controls under review, with synthetic runtime badges. Evidence is under
`implementation-evidence/collections/routine-timing-*`.

Remaining routine fields include dim/random-color/helper/invocation actions,
script declarations, unavailable-reference recovery and final persistence
reconciliation. Unknown execution modes are visibly retained, but that behavior
does not close the full malformed-definition acceptance gate.

### Remaining native routine action fields

`dev/routine-actions-review.mjs` passes 38 checks at each 1440/390 px.
Power remains a single-device action. Dim and random-color actions save multiple
devices plus a group, without changing the other action's scope. Negative and
positive dim amounts, exact 1.001-second fades and omitted transitions persist.
Incomplete numbers remain editable and focus on Save; zero and out-of-range dim
amounts are rejected without silently changing the draft. Random-color bounds
preserve zero, omission and reversed/out-of-range finite values, matching the
server's execution-time clamp/swap contract. A compiler regression covers those
accepted representations rather than claiming a fixture executes random colors.

Start/replace timers require a complete delay, allow zero for queued execution,
reject values beyond seven days and preserve exact milliseconds. Cancel timer
names are edited independently. All four helper write types save/reload, including
false and empty text. Bounded helper numbers retain unfinished text and validate
their range; helper selection restores the last valid value before Save and clears
discarded numeric errors. Fresh numeric defaults respect the declared bounds.
Helper references link to their details. Both invocation modes save with an edited
routine reference. Incompatible/missing helper values are displayed without
coercion; full malformed-reference recovery remains a separate gate.

Desktop screenshot review found the three-column random-color fields clipping a
transition value. The form now uses the action block's width to arrange fields;
phone controls remain stacked. Screenshots and logs are in
`implementation-evidence/collections/routine-actions-*`. Runtime badges are
synthetic, and Save/reload evidence proves fixture serialization, not database
restart durability. All 234 UI tests, three targeted Rust compiler tests and
type/lint/build pass. Remaining: script declarations, unavailable-reference
recovery and the cross-family persistence/accessibility acceptance gates.

### Script declarations and optional metadata

`dev/routine-declarations-review.mjs` passes 20 native browser checks at
1440/390 px. Every declaration kind has edited Save/reload evidence. Device and
group pickers keep related links and offer direct IDs for entities not discovered
yet, matching the compiler's standing-reference contract. Type switches restore
previous values; removing an earlier row remaps those caches. Row, nested device
reference and script extensions survive. Empty lists and multiple independent
script blocks remain distinct. Incompatible declaration shapes and future script
API/profile versions are shown without coercion, then explicitly removed before
Save; the browser fixture does not prove server acceptance of unknown formats.

Omitted declarations and limits use the server defaults for rendering but remain
omitted in the saved JSON when untouched. Three targeted compiler tests verify
forward-reference tracking, all-state scope, omitted defaults, unsupported API and
limits profiles, and the 32-declaration boundary. Six conversion checks per
viewport verify no early writes, Discard, stable action identity, complete script
preservation and program extension fields. Conversion also remaps declaration
cache paths into the new action. All 234 UI tests and type/lint/build pass.

Evidence is under `implementation-evidence/collections/routine-declarations-*`.
The captures are scrolled to the declarations being reviewed; runtime badges are
synthetic. These checks cover authoring and fixture serialization; database
restart/export reconciliation and broader reference/recovery acceptance stay open.

### Database evidence follow-up

[PERSISTENCE-COVERAGE.md](PERSISTENCE-COVERAGE.md) maps the current 16 passing
SQLite consistency tests. New close/reopen plus JSON restore checks cover source
computation variants/aliases/timing/defaults, sensor ordering, user-timer definitions,
floorplan data and everyday widget selections. Helper persistence now exercises all
four types and visibility values. Browser and database evidence remain separate;
source evaluation, all per-widget defaults and final recovery gates are not implied.

### Scene creation and routine return

The native browser journey `ui/dev/scene-return-review.mjs` passes 17 checks
at 1440 and 390 px. Creating a scene from an action retains both drafts,
returns focus to the originating action, selects the created scene exactly once,
and leaves the routine unsaved until Create/Save. Returning before scene creation
retains the scene name and targets. A deleted action produces an honest notice and
a link to the created scene; a deleted scene stays visibly unavailable until the
user chooses a replacement. Related-page navigation preserves that repair draft.
No live HTTP or WebSocket commands were issued.

The return helper only traverses native action/branch lists. Two unit tests cover
nested selection, missing/changed actions, and preservation of opaque script,
condition and extension payloads. All 236 UI tests and type/lint/build pass.
Screenshots and logs: `implementation-evidence/collections/scene-return-*`.
These are authoring/fixture checks, not proof of scene execution or database
durability. Other reference/recovery and final acceptance gates remain open.

Raw automation persistence follow-up: the database consistency suite now passes
17 tests. Scene target ordering, links, script text and nullable/empty values, plus
native/mixed/whole-script routines, stable IDs, revision/version and opaque nested
fields survive actual connection close/reopen and JSON restore. Legacy defaults
remain compatible. This proves storage preservation, not compiler acceptance of
unknown actions or missing references. See PERSISTENCE-COVERAGE.md.

### Empty cycle validation

The native routine-selection journey now passes 19 checks at 1440/390 px.
Removing all entries keeps the action editable and shows guidance beside Add scene.
Save focuses that button without an API write; Discard restores the saved entries.
The warning moved from below optional controls. Unit coverage also checks nested
branches and ignores lookalike objects in script payloads. All 237 UI tests,
compiler test `cycle_scenes_validation_requires_scenes_and_resolves_references`,
and type/lint/build pass. Evidence: `collections/routine-cycle-*`. The reload
harness waits for scene catalog labels as well as routine controls before checking
the restored selection. Other reference/recovery and final gates remain open.


### Widget options and persistence — 2026-09-30

[WIDGET-OPTIONS.md](WIDGET-OPTIONS.md) maps all 17 widget types, field defaults,
legacy representations and renderer behavior. Nine remaining native dropdowns
now use shared selectors or searchable entity pickers. Numeric options require a
complete value before Save; price thresholds accept signed decimals. Missing
references remain visible and repairable, and mode switches retain inactive IDs.

22 native checks pass at each 1440/390 px viewport, with no live commands. The
expanded existing SQLite test now closes/reopens and exports/restores edited and
empty option objects for every type, including synthetic private overrides.
Type/lint/build pass. Captures, driver and exact evidence are linked from the
option ledger. The remaining gates include backup/recovery races, reference and
module reconciliation, shared overlays and the wider accessibility matrix.

### Malformed scene target repair — 2026-09-30

Raw scene target values can be null, primitive JSON or an unsupported shape,
because scene rows retain their original JSON independently of runtime parsing.
The editor, scene summaries and effect summaries now identify those values
without crashing or inventing a known state preview. Repair rows show the reason,
the original JSON, a related entity link, explicit replacement and removal.
Unrelated edits preserve unsupported values; known numeric ranges still validate.

Replacement asks for confirmation and states the default state being introduced.
It updates only the draft. Cancel restores the repair button's focus; replacement
focuses the new state controls. Discard restores the original raw value. Target
multi-selection now checks key presence instead of using a null-coalescing
default, fixing silent conversion of saved null targets into empty state objects.
The desktop scene action column also now fits the shared icon button.

`ui/dev/scene-repair-review.mjs` covers the scene list, read-only repair rows,
saved JSON inspection, unrelated Save/reload, unchanged picker confirmation,
Cancel, confirmation, focus, no early writes, Discard, explicit replacement and
removal, sibling extension/false/zero/null preservation, row containment and no
live commands or page exceptions. It uses temporary local fixture records and
removes them afterward. No household configuration is changed.

245 UI tests, type checking and production build pass. Lint exits successfully
with the existing backup-effect cleanup warning; the build retains its existing
large-chunk warning. A server API test verifies that an unrelated name edit
preserves malformed targets in both its response and runtime configuration. The
database reopen/JSON-restore test now includes null, false, list and unknown-color
target payloads. Evidence: `implementation-evidence/collections/scene-repair-*`.
These tests cover preserved storage and UI repair, not successful execution of
unsupported definitions. Other cross-family recovery/accessibility gates remain
open.

Passing browser runs: 390 px: 16 checks; 1440 px: 16 checks.

### Routine reference recovery — 2026-09-30

Twenty checks at each 1440/390 px cover failed catalog Retry, retained drafts,
unavailable reference repair, exact Save/reload, Discard and picker focus. The
phone selection regression also passes 19 checks. See the
[work queue checkpoint](WORK-QUEUE.md#routine-reference-recovery--2026-09-30)
for evidence and limitations; broader cross-family gates remain open.

### Integration repair, ESPHome and legacy conversion — 2026-09-30

Malformed dummy colors no longer enter a color preview that assumes a supported
shape. Both controllable and color-sensor values expose the original value in
typed repair controls, with an explicit default/removal choice. Validation blocks
unsupported colors until repaired. The existing malformed collection and unknown
variant controls now have browser evidence: 11 checks at each 1440/390 px cover
inspection, staged replacement, Discard, blocked incomplete repairs and exact
Save/reload of repaired values with unrelated false/zero/null/extension data kept.

ESPHome uses the schema-driven shared inputs. The five profile-specific fields are:

| API key | Control | Runtime default | Edited/reloaded value |
| --- | --- | --- | --- |
| `esphome_base_topic` | Base topic | `esphome` | `fixture/esp` |
| `esphome_light_object_id` | Light object ID | `light` | `ceiling` |
| `esphome_discovery_prefix` | Discovery prefix | `homeassistant` | `fixture/discovery` |
| `esphome_warm_white_kelvin` | Warm white, integer 1–65535 | 2700 | 2200 |
| `esphome_cold_white_kelvin` | Cold white, integer 1–65535 | 6500 | 7200 |

The UI now checks warm < cold using the same omitted/null defaults as
`integrations/mqtt/mod.rs`. Fourteen browser checks per size cover all five edits,
invalid endpoints without a write, generic/Zigbee2MQTT/ESPHome switching, retained
navigation drafts, Discard, Save/reload and removing all five optional overrides.
Inactive profile settings and extension data remain intact. The isolated fixture
now includes these real schema fields, bounds, defaults and descriptions. Existing
MQTT collection/management/password evidence remains recorded above; these new
checks do not claim broker discovery or hardware execution.

The previously open multi-schedule legacy conversion item is covered by
`server/tests/convert.rs`. The test uses file-backed SQLite, two cron schedules
with distinct enabled states and Europe/Helsinki, plus convertible/manual routines.
It checks persisted definitions and enabled states, disables the converted legacy
integration, reports the second pass without duplicate conversions, then restores
the original schedules exactly and removes generated routines from an archive.
This respects the decision that legacy entries are read-only in the UI.

Evidence: `implementation-evidence/collections/dummy-repair-*`,
`esphome-editor-*` and `legacy-conversion.log`, with captures in the
[comparison gallery](implementation-evidence/comparison/index.html#integration-repair).
246 UI tests, type checking, lint, build and the conversion test pass. Existing
backup-effect lint, build chunk-size and Rust future-compatibility warnings remain.
No household configuration was changed. Remaining integration work includes
malformed MQTT collection/range repair reconciliation and the broader module and
recovery audit; this checkpoint does not close the entire field gate.

### MQTT repair reconciliation — 2026-09-30

Malformed ranges and known string collections now have 16 native browser checks
at each 390/1440 px, including explicit repair, original-value review, retained
numeric drafts, validation focus, Discard, Save/reload and default removal. Schema
range defaults now match the generic MQTT runtime. All 246 UI tests, type/lint/build
and the targeted Rust schema test pass. See the
[work queue checkpoint](WORK-QUEUE.md#mqtt-range-and-collection-repair--2026-09-30)
for evidence and limits. Broader reference/recovery/accessibility gates remain open.

### Source/helper reference reconciliation — 2026-09-30

The missing scene-selection helper dependency and malformed source scene-target
lookup are fixed. Source details now include direct room and declared routine
references, with independent catalog Retry and explicit limits for indirect, legacy
and script-body dependencies. Four unit tests and 11 browser checks at each
390/1440 px cover declared-field traversal, aliases, malformed values, JSON
lookalikes, retained drafts and related links. All 250 UI tests and type/lint/build
pass. See the [work queue checkpoint](WORK-QUEUE.md#source-and-helper-reference-audit--2026-09-30)
for evidence; visibility, widget-consumer and wider recovery/accessibility gates
remain open.

### Helper visibility / widget consumers — 2026-09-30

The visibility and widget-reference gap is closed by 15 native checks at each
390/1440 px plus the database helper-definition/durable-value round trip. Hidden
helpers remain editable and usable by existing widgets; new selections omit them.
Widget links cover every layout and both option representations, with independent
Retry and retained drafts. Type/lint/build pass. See the
[work queue checkpoint](WORK-QUEUE.md#helper-visibility-and-widget-consumers--2026-09-30)
for evidence and scope; broader recovery/accessibility remains open.
