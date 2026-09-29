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
| `cycle_scenes.scenes[]` | `ProgramBuilder` cycle rows: add/remove/move scenes, per-entry fields | Explicit cycle order | `dev/routine-selection-review.mjs` edits, reorders, removes/adds and saves entries with independent targets/transitions/extensions. **Open:** explicitly empty cycle validation against the compiler; remaining optional rollout fields. |
| `TargetSpec.devices[]`, `groups[]` | `ProgramBuilder.TargetSpecEditor`: independent device and group multiselects; empty means the action's documented default, not invented “all” behavior | Scope membership | `dev/routine-selection-review.mjs` edits multiple activation targets, cycle detection targets, entry scopes and timer capture. **Open:** dim/random-color consumers and empty/default targets; do not infer their semantics from activation. |
| `SceneSelection.mapping` and optional fallback | `ProgramBuilder.SceneSelectionEditor`: helper-option-to-scene rows and fallback selector | Keyed mapping | `dev/routine-selection-review.mjs` edits several mappings (including `__proto__`), removes an obsolete option, switches helper/group/fixed modes, retains independent fallbacks, navigates to the helper, saves/discards and reloads. **Open:** unavailable helper/scene recovery and empty mapping compiler validation. |
| Timer `capture_target_intents` | `ProgramBuilder` schedule/replace timer controls with target picker | Optional captured scope | `dev/routine-selection-review.mjs` adds/removes scope members, retains the edited scope through off/on, saves every member and extension, then saves capture disabled as omission. Empty capture is rejected by the compiler (`compile.rs` timer validation test); existing stale-intent tests cover execution separately. |
| Source `aliases[]` | `app/config/sources/detail.tsx`: repeatable text rows, add/remove, validation of unique full keys | Preserve array; aliases have no execution sequence | `dev/settings-source-journey.js` creates two aliases and checks the API result. **Open:** empty/removal and malformed alias repair. |
| Helper enum `options[]` | `app/config/helpers/fields.tsx`: direct rows, add/remove/up/down; invalid initial selection must be repaired explicitly | Display order retained | `dev/helper-editor-review.mjs` edits/reorders/removes options; validates empty/duplicate lists and removed initial values; verifies Cancel and confirmed reset when the current choice is removed. Existing helper journey additionally covers creation and conflict review. |
| MQTT `sensor_value_fields[]`, `disabled_device_ids[]` | `app/config/integrations/fields.tsx` `StringEntries`: repeatable rows, add/remove/up/down; malformed values use typed JSON fallback | Preserve configured order | `dev/mqtt-editor-review.mjs` edits both collections, adds/removes/reorders entries, blocks invalid pointers/blank device IDs, saves empty arrays and reloads. `lib/integrationDraft.test.ts` checks every pointer. Malformed non-list repair remains a separate open case. |
| Legacy cron schedules map | `app/config/integrations/detail.tsx`: visible read-only definition and current-format destination/offline conversion guidance | Preserved until explicit conversion | Deliberately not editable. **Open:** identify conversion round-trip test for multi-schedule legacy input. |
| Dummy `devices` map | `app/config/integrations/fields.tsx` `DummyDevices`: keyed add/remove, direct initial-state and capability fields | Keyed identity; no semantic order | `dev/dummy-editor-review.mjs` saves/reloads multiple default/controllable/sensor devices, all four sensor variants and empty maps; remove/recreate clears metadata. Rust tests confirm shapes and null defaults. **Open:** browser repair of unknown/malformed states. |
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
| Scene selection, cycle entry, rollout | `ProgramBuilder` scene/target/transition/selection/rollout controls | Direct/helper/group modes, independent fallbacks, stale-key removal and cycle scope/order are edited in the routine selection journey. **Open:** rollout fields/defaults and unavailable references. |
| `ProgramBody`, `ScriptSpec` declarations | `ProgramBuilder`, `RoutineScriptEditor`: native/mixed scripts; explicit whole-script conversion; declaration rows | Mixed script and whole-program conversion journeys already pass. Still name each declaration collection and persistence/limits default fixture. |
| Scene explicit/device-link/scene-link state | `app/config/scenes/target-row.tsx`, shared color controls | Scene collection journey edits explicit/device-link/scene-link modes, source and multiplier, default power, zero brightness/fade, full stored scopes, missing-target replacement, and retained inactive variants. Nullable transition and unknown siblings survive. Color variants/capture and creation-return still need ledger reconciliation. |
| Helper boolean/enum/number/string and initial value | Helper definition fields plus separate current-value control | All four types and initial values now have edited save/reload evidence, including false/zero/empty text/optional bounds. Separate command tests cover rejection, pending state, acknowledgement and retained configuration drafts. Visibility and full dependency-link reconciliation remain open. |
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
