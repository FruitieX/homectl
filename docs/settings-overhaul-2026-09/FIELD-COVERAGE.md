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

| Contract | Renderer and empty/add/remove behavior | Order | Existing fixture evidence and remaining work |
| --- | --- | --- | --- |
| Group `devices[]`, `linked_groups[]` | `app/config/groups/editor.tsx`, `shared.tsx`: separate direct-device and linked-group pickers; empty group allowed; missing members remain repairable | Membership; preserve submitted arrays | `dev/settings-group-journey.js` edits members and retains drafts/conflicts; `lib/groupGraph.test.ts` checks cycles/missing members. **Open:** enumerate empty/single/multiple fixtures separately. |
| Scene `group_states`, `device_states` maps | `app/config/scenes/editor.tsx`, `target-row.tsx`: add multiple targets; remove a target; empty maps remain maps | Group map uses `group_state_order`; device overrides are separate | `dev/scene-collections-review.mjs` now edits both link variants, persists multi-add/remove and target replacement, removes all targets, and reloads empty maps. Existing scene journey covers color editing and Discard. |
| Scene `group_state_order[]` | Same editor; target actions move earlier/later; removed targets leave the order list; unresolved order entries normalized by resolver helper | Explicit precedence; remaining targets deterministic | Scene journey edits and saves order; `lib/sceneDraft.test.ts` and `sceneTargets.test.ts` cover ordering/resolution. |
| Scene-link `device_keys[]`, `group_keys[]` | Scene target row's linked-scene scope controls; selected device/group collections | Scope membership, not action sequence | `dev/scene-collections-review.mjs` edits multiple devices/groups, removes unavailable references, and distinguishes empty arrays from omitted default scope. These are stored activation descriptors: target-level scene links resolve the same device regardless of these scopes (`core/scenes.rs` and `lib/sceneDraft.test.ts`). |
| Routine `triggers[]` | `ui/TriggerBuilder.tsx`: add/change/duplicate/remove start blocks, preserve IDs; empty definition subject to compiler validation | Retained authoring order; multiple subscriptions | `dev/settings-routine-journey.js`, `lib/routineDraft.test.ts`. **Open:** edited fixture for each of eight trigger variants and optional report field. |
| Nested condition `all.conditions[]`, `any.conditions[]`, `not.condition` | `ui/ConditionBuilder.tsx`: recursive condition rows; All/Any require a child; Not remains unary | Preserve nesting and sibling order | `lib/routineDraft.test.ts` rejects empty logic groups; current visual audit covers nested layout. **Open:** save/reload multi-child All/Any/Not edits and unknown-value semantics. |
| Native `steps[]` and `choose.branches[].steps[]` | `ui/ProgramBuilder.tsx`: direct fields, add/remove/duplicate/move; empty native sequence shown honestly | Sequential; first matching branch, stable IDs | Routine journey edits/moves/duplicates/saves branch subtrees, including a script. `lib/routineDraft.test.ts` checks identity and opaque payload preservation. **Open:** variant matrix below. |
| `cycle_scenes.scenes[]` | `ProgramBuilder` cycle rows: add/remove/move scenes, per-entry fields | Explicit cycle order | **Open:** round-trip several entries with different scope and transition settings; clear/re-add an entry. |
| `TargetSpec.devices[]`, `groups[]` | `ProgramBuilder.TargetSpecEditor`: independent device and group multiselects; empty means the action's documented default, not invented “all” behavior | Scope membership | Used by activate, dim, random color, cycle detection/entries and timer capture. **Open:** named fixture for each consumer, with multiple devices/groups and omitted/empty distinction. |
| `SceneSelection.mapping` and optional fallback | `ProgramBuilder.SceneSelectionEditor`: helper-option-to-scene rows and fallback selector | Keyed mapping | **Open:** edit several mappings, clear one, preserve obsolete/missing helper options, save/reload fallback. |
| Timer `capture_target_intents` | `ProgramBuilder` schedule/replace timer controls with target picker | Optional captured scope | **Open:** omitted vs explicit empty vs multi-target editing; backend stale-intent tests are execution evidence only. |
| Source `aliases[]` | `app/config/sources/detail.tsx`: repeatable text rows, add/remove, validation of unique full keys | Preserve array; aliases have no execution sequence | `dev/settings-source-journey.js` creates two aliases and checks the API result. **Open:** empty/removal and malformed alias repair. |
| Helper enum `options[]` | `app/config/helpers/fields.tsx`: direct rows, add/remove/up/down; invalid initial selection must be repaired explicitly | Display order retained | `dev/settings-helper-journey.js` creates three options, reorders, switches type away/back and verifies saved order. **Open:** empty/duplicate validation and removal of selected current/initial values. |
| MQTT `sensor_value_fields[]`, `disabled_device_ids[]` | `app/config/integrations/fields.tsx` `StringEntries`: repeatable rows, add/remove/up/down; malformed values use typed JSON fallback | Preserve configured order | Integration journey edits/saves multiple sensor paths; `lib/integrationDraft.test.ts` checks every pointer. **Open:** edited disabled-device collection and empty/removal fixtures. |
| Legacy cron schedules map | `app/config/integrations/detail.tsx`: visible read-only definition and current-format destination/offline conversion guidance | Preserved until explicit conversion | Deliberately not editable. **Open:** identify conversion round-trip test for multi-schedule legacy input. |
| Dummy `devices` map | `app/config/integrations/fields.tsx` `DummyDevices`: keyed add/remove, direct initial-state and capability fields | Keyed identity; no semantic order | **Open:** typed multi-device save/reload across default/controllable/sensor/unknown states. Removed device now clears its numeric/type editor metadata. |
| Sensor catalog `sensors[]`, `groups[]`, group `sensor_ids[]` | `app/config/sensors/page.tsx`: catalog/group/member row controls, empty selections supported | Three independent presentation orders | `dev/sensor-order-input.mjs` verifies saved orders, independent memberships, widgets and group charts; catalog journey covers configuration editing. |
| Dashboard layouts/widgets and per-widget selections | `app/config/dashboard/widget.tsx` and designer: type gallery, sources, size/order, retained per-type options | Layout order, sizes and explicit selection order | `dev/widget-design-journey.js`, `widget-preview-input.mjs`, `sensor-order-input.mjs`. **Open:** reconcile every widget option with export/import evidence and missing-source repair. |
| Calibration profile assignments | Calibration configuration and bulk selection flows | Keyed device assignment; profile data preserved | `dev/calibration-bulk-journey.js` checks exact assignment/removal and unchanged profiles. **Open:** remaining capability/missing-catalog fixtures from implementation ledger. |
| Extension JSON maps/lists | `ui/settings/JsonValueEditor.tsx`: recursive typed fields, explicit null/default, add/remove; number input keeps unfinished text without changing the domain type | Lists offer up/down; maps retain keys including escaped names | **Edited:** `dev/collection-editor-review.mjs`, 14 checks at 1440/390 px, numbers/type changes/reorder/remove/re-add/Save/Discard/navigation. `lib/entityDraft.test.ts` covers delayed saves and metadata remapping. Nesting beyond 12 levels is preserved read-only; it is not claimed as fully editable. |

## Variant and optional-field audit still to close

The following are the actual contract groups to reconcile, not a claim that
one generic JSON control completes their product UI. Bindings mirror the Rust
schema; server compiler/resolver behavior remains authoritative.

| Schema group | Current controls | Required remaining fixtures |
| --- | --- | --- |
| `TriggerSpec`, `StateChangeMode`, `ScheduleSpec` | `TriggerBuilder`: report, state change, predicate transition/held, schedule, timer fired, startup, manual; schedule/timezone/backlog controls | Each trigger edited; report field omitted/present; change modes; cron/interval; explicit Helsinki timezone; catch-up lateness required only for catch-up. |
| `ConditionExpr`, `ValueSource`, comparison operators, group quantifiers | `ConditionBuilder`: literal, All/Any/Not, comparison, group; device/helper/source values | Every source/quantifier/operator family; valueless operators; false/zero/null/missing distinctions; optional group power/scene. |
| `NativeAction` | `ProgramBuilder`: script, activate/cycle, power, dim, random color, choose, schedule/replace/cancel timer, helper write, routine invocation | Each variant edited through Save/reload, including singular SetPower device; no false multi-target claim. |
| Scene selection, cycle entry, rollout | `ProgramBuilder` scene/target/transition/selection/rollout controls | Direct scene vs helper mapping; entry scopes and transitions; rollout fields and optional defaults; stale mapping keys. |
| `ProgramBody`, `ScriptSpec` declarations | `ProgramBuilder`, `RoutineScriptEditor`: native/mixed scripts; explicit whole-script conversion; declaration rows | Mixed script and whole-program conversion journeys already pass. Still name each declaration collection and persistence/limits default fixture. |
| Scene explicit/device-link/scene-link state | `app/config/scenes/target-row.tsx`, shared color controls | Scene collection journey edits explicit/device-link/scene-link modes, source and multiplier, default power, zero brightness/fade, full stored scopes, missing-target replacement, and retained inactive variants. Nullable transition and unknown siblings survive. Color variants/capture and creation-return still need ledger reconciliation. |
| Helper boolean/enum/number/string and initial value | Helper definition fields plus separate current-value control | Boolean false, number zero/optional bounds, string empty, enum options/invalid values; initial configuration save must never become a current-value command. |
| `SourceCompute`: circadian compatibility, script preset, custom script | Source detail, day/night color controls, params JSON, script editor, draft preview | Preset id/version, unknown preset, optional source body, parameter null/list/object values and extra fields; type change and discard. |
| Integration config primitive/JSON fields; MQTT mode; dummy state/capabilities | Schema fields plus typed adapters | Missing/null/false capability overrides; Kelvin bounds; payload paths; secret unchanged/replace/remove; malformed known collection repair; reload failure without misleading “saved” state. |
| Device overrides, reporting preferences, shared advanced preference | Device settings, reporting field and system preferences | Tie each default/inherit/custom/ignore state to exact backend persistence/export test; disabled-device suppression already has separate regression evidence. |
| Widget types, source references and optional dimensions/settings | Visual widget designer and sources pages | Existing 17-type preview evidence proves composition/inertness; pair each persisted field with round-trip/default compatibility evidence. |
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

Next: close routine collection rows with edited fixtures, then typed
integration/helper/source cases. Code inspection found that switching dynamic
scene-selection kinds, or dynamic/fixed selection, discards the nested mapping
and fallback draft in `ProgramBuilder`; fix and verify this next. Continue to expand this matrix to
individual persisted fields before closing PLAN.md's coverage gate.
