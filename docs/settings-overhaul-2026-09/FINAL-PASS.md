# Interaction review and implementation handoff — studies 03–04

Status: **approved for implementation**. Study 03 behavior is retained; Study 04 revises its routine and scene presentation following user feedback. The Compact visual baseline from Study 02 remains approved. Production implementation is active; [IMPLEMENTATION.md](IMPLEMENTATION.md) records actual progress and outstanding acceptance. The examples below describe the historical prototypes.

Open [the gallery](review.html) or [the study navigation](index.html#study03). All data is synthetic. The outcome selectors are prototype tools, never proposed product controls.

## What to review

### 1. Complex routine

[Try the routine](index.html#complex-routine). Desktop uses the earlier shared flow canvas with three lanes: When, Only if and Then. The Then lane contains native ordered branches, conditions and actions with lighter nesting. Phone follows When → Only if → Then vertically, with the same colored section boundaries as the approved simple routine.

- Starting events are alternatives. The sample combines a motion predicate becoming true and a named timer firing.
- All, Any and Not retain visible nesting. No closed accordion is required to understand the conditions.
- A Choose block checks ordered branches and runs the first match. Unknown/error is distinct from false and can block selection.
- Actions are ordered inside their branch. Arrow controls provide phone and keyboard reordering without dragging. They move the existing block and its values.
- The timer start links to its replacement action. This is a reference between two parts of the definition, not an arbitrary graph cycle.
- The walkthrough explains fixed sample inputs; it does **not** claim to evaluate edits. Production Preview must evaluate the current draft and label its input snapshot.

[The typed fixture](complex-routine.fixture.ts) satisfies the repository's generated `RoutineDefinitionV2` type. It names the synthetic dependencies and preserves stable trigger/action/branch IDs. This verifies its static type shape; it has **not** been compiled or run by the automation engine.

The example checks current motion state rather than inventing a trigger-ID condition source. When its timer fires with motion still detected and its light-needed condition true, it starts a new countdown. When motion is clear, it activates the off scene. Global conditions also apply to the timer event. This is an illustrative definition, not a universal motion-lighting template.

### 2. Scene modes, color and resolution

[Try the scene study](index.html#scene-modes). The approved compact target rows/cards remain the ordinary editor. The complex study now uses that same aligned desktop row structure; source modes and resolved previews appear within rows, and narrow layouts use labeled cards.

- Explicit targets expose power, brightness, transition and a color control. Color opens a focused dialog with white temperature, hue/saturation, exact values and presets. Cancel changes nothing; Use color updates the draft.
- White-only targets do not offer hue controls. Power-only and brightness-only examples show the appropriate controls. Production capabilities determine ranges and supported modes.
- A device link uses a **brightness multiplier**. Sample source 60% × multiplier 50% gives 30%. Omitting the multiplier means use source brightness, not an absolute target override.
- A scene link resolves the source scene **for the same target device**. Its preview is not an average color for the whole scene. A missing target state is unresolved.
- Missing sources retain a repair identifier even with advanced details hidden. Repair or removal changes the draft and clears the sample issue.
- Group ordering and explicit device precedence are explained with a small provenance list. Production resolution must also account for scripts and overrides; the list is an illustration, not a second resolver.
- Switching modes retains the inactive sample controls during this session, including after a related-page visit. Discard restores the saved baseline.

#### Corrected omitted-value semantics

The earlier blanket “Keep current” wording was incorrect for explicit scene states. The active prototype and current interaction rules now distinguish:

| Field | Current behavior | Editor wording |
| --- | --- | --- |
| Explicit power omitted | Scene resolver defaults it to true | Default (On) |
| Explicit brightness omitted | Scene state carries None; the device update path supplies 1.0 when power is on | Use default; show 100% for the known On default |
| Explicit color omitted | No color authored here; final effect depends on integration handling | Not specified |
| Device-link brightness omitted | Multiplier defaults to 1.0 | Use source brightness |
| Scene-link transition omitted | No target override; source/activation transition rules apply | Use source transition |

Sources: `server/src/types/scene.rs`, `server/src/core/scenes.rs::compute_scene_device_state`, and the power/brightness normalization in `server/src/core/devices.rs`.

Preserve omission when saving; do not materialize defaults just because the UI displays their effective result. Zero, absent, unknown and unchanged are distinct. Historical screenshots remain archived and may contain the superseded wording.

### 3. Creation, references and larger catalogs

[Start a new routine](index.html#new-routine), enter its name, select a start, then follow Create a scene. Add targets and create the scene; the routine draft returns with the scene selected. Creating a scene does not activate it.

Creation shares the edit form, target controls and bottom action placement. Optional templates populate a starting point; no mandatory wizard surrounds a small form. IDs are suggested from names until explicitly edited. Creation commits only on Create, rather than inserting empty entities on opening the form.

The user confirmed **Enable after creating is checked by default**: creating the routine makes it ready to run. Keep that choice visible, with the consequence stated.

The target picker contains 240 synthetic entries, including a long name. Search accepts names or IDs; selected items remain visible while filtering. It demonstrates no matches, loading and retry states through a study-only selector. Missing existing references are demonstrated in the companion scene card. Production needs a bounded/virtualized list and honest counts; this sample renders matching rows directly.

Other dirty entities appear in a compact draft-return strip. Production must also retain focus, scroll, search/filter state and editing context; the HTML prototype retains values/dirty state but resets page scroll. It is not the proposed production draft store.

### 4. Save and recovery

[Try Save & recovery](index.html#save-lab). Change a field, choose a study outcome, then Save.

| Outcome | Behavior |
| --- | --- |
| Invalid field | Focus the invalid control; retain all other values; show error summary |
| Server validation | Keep draft and associate the error with the relevant field |
| Network failure | State that success is unconfirmed; retain draft and offer Retry save |
| Concurrent update | Compare latest saved value with draft; Keep my draft closes without a write; Use latest saved explicitly replaces it |
| Applied, not persisted | Commit the active-value baseline, display a persistent database warning across pages, offer backup access; do not present an ordinary success |
| Success | Clear error/dirty state and update the baseline |

“Keep my draft” is not a force overwrite. Production requires a fresh base revision and an explicit merge/review before a later write. No conflict-safe API or database outcome detection is implemented in the prototype.

## Engineering decisions to carry into implementation

### Shared primitives and draft contract

Build shared `SettingsShell`, entity links, list/picker controls, `LightStatePreview`, entity form/draft state, save bar, field errors and dialogs. Names are illustrative. Keep application utilities and parent breadcrumbs in the existing global shell; avoid stacking another full navigation rail beside it.

A draft contains the raw saved object, saved revision/precondition, editable value, validation results and view context. Live evidence and resolved labels may refresh independently. Dirty comparison is semantic; DOM serialization is a prototype shortcut only. Unknown raw fields and inactive variants must not disappear during unrelated edits.

Use one save per entity when one endpoint writes the entity. Independently persisted settings sections have separate named boundaries. Validate, snapshot the submitted draft, submit, then reconcile the exact response; edits made while saving remain dirty. Never clear a newer draft when an older response arrives. Abort/stale-response handling must be shared.

Concurrent-write comparison and mutation must occur atomically through the state actor. A failed transport can have an unknown write outcome: reconcile the current server version before replaying non-idempotent operations, and give creates a stable request identity. A success-shaped HTTP response is insufficient if persistence failed; the response contract must distinguish active/runtime state from durable state.

Unsaved drafts are retained in the current session. Do not put credentials into local/session storage. Navigation to another retained draft needs no warning; actions that actually lose work do. Saving one entity does not save another. Deleting or renaming a referenced entity refreshes reference evidence without replacing the origin draft.

### Routine mapping

- Trigger order and IDs, recursive All/Any/Not, ordered native steps and ordered Choose branches are preserved structurally. No arbitrary parallel joins or free wiring.
- Insertions allocate new stable IDs; rename/reorder preserve them. Removal never renumbers identity. Empty All/Any groups are invalid and must offer removal or a valid child; they do not silently become true.
- Phone arrows and desktop move actions operate on sibling sequences. Moving between scopes is explicit and validated; no implicit flattening of nested branches.
- Script/native conversion is a reviewed replacement. Editing a name never converts legacy v1 or script definitions. Unsupported future variants remain readable/exportable and cannot be overwritten with a reduced form.
- Duration controls convert units at a single boundary. Current generated bindings use bigint for several integer durations; JSON transport must handle this explicitly and reject unsafe numeric precision.

### Coverage ledger for implementation slices

The existing schema inventory is not a claim of complete field coverage. Each slice must attach round-trip fixtures to its controls before replacing the old authoring surface.

| Slice | Required fixture families |
| --- | --- |
| Rooms & groups | Multiple direct devices and linked groups; inherited duplicates; missing members; cycles; hidden and empty groups |
| Scenes | Each explicit/link variant; omitted/zero/off; CT/HS/XY/RGB as actually supported; capability constraints; target maps and group order; device overrides; missing/cyclic links; script and runtime overrides |
| Routine triggers/conditions | Every trigger variant; multiple starts; nested All/Any/Not; all comparison operators/source kinds; group quantifiers; unknown data |
| Routine programs | Every native action; nested Choose and order; multi-target arrays; cycles and per-entry overrides; helper scene mapping; timer capture scope; invocation mode; script declarations; all execution/schedule policies |
| Legacy/future routines | v1 rules/actions; explicit migration preview; unknown version/fields; stable IDs across ordinary edits |
| Integrations | Plugin-specific arrays/maps/nested forms; MQTT field paths and exclusions; dummy device lists; cron/timer lists; masked secret unchanged/replace/clear; reload failure |
| Helpers and sources | Typed defaults/current commands; enum options; aliases; computed expressions/scripts; timezone and cadence; widget/sensor source collections |
| Shared system settings | Database-backed advanced preference; reporting inherit/custom/ignore; assistant provider settings; backup export/import defaults and secret handling |

For each row, record exact Rust/API field → control → omission/default rule → API write scope → fixture/test. Use the current generated bindings; do not hard-code the prototype's fixtures into production. Existing integration schema gaps, revision handling and persistence outcome contracts are implementation work, not more visual approval rounds.

### Health and preference work

The shared advanced preference and user reporting policies are database configuration exposed through API/snapshot. Integration defaults and per-device inherit/custom/ignore must round-trip backup import/export with compatible defaults. Do not put them in TOML.

Health observations are separate from policy. Record report receipt even when sensor values do not change; account for retained/cached reports, reconnect/startup grace and explicit availability. Ignore affects missing-report checks only. One evaluator supplies attention summaries and transition/recovery log events, with deduplication. Do not infer device offline status solely from an overdue report.

## What can proceed without more mockup rounds

The four structural questions now have concrete interaction examples. After reviewing this pass, implementation can start with shared shell/tokens, previews, drafts and collection controls, then an end-to-end Rooms & groups slice. Next build scenes and routines against their complex fixtures, followed by the remaining forms, attention and dense logs.

Ordinary list/details, helper forms and system settings can be reviewed as working screens using this system. There is no need for another color/spacing direction exercise. Production acceptance still requires actual server validation, serialization, persistence/conflict tests, keyboard/screen-reader review and desktop/phone journeys; these prototypes do not replace them.
