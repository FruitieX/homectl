# Implementation readiness

The user approved the current desktop/phone prototype and explicitly endorsed the color circle with the brightness ring. Compact styling, open controls, explicit saves, related-entity links, mobile target cards, the phone routine flow, advanced-details preference and attention-policy direction are settled. Production implementation is active; see IMPLEMENTATION.md for current progress.

Study 03 completed the focused pass over interactions likely to change component structure; see [the interaction review and handoff](FINAL-PASS.md). Study 04 supersedes its layout and has been approved for implementation. We do not need another visual-direction study or a separate polished mockup for every ordinary settings form.

## Final targeted prototypes

| Study | Demonstrate | Why it needs an early decision |
| --- | --- | --- |
| Complex routine | Multiple starts, nested All/Any/Not, first-match branches, timer scheduling and timer-fired start, several ordered actions; add, remove and reorder on phone and desktop | A simple three-column example does not yet prove that the editor represents nested structure clearly or preserves the actual schema |
| Complete scene target | Real color/temperature picker with exact inputs; power-only and brightness-only devices; explicit state vs follow-device/follow-scene; omitted/default values; overlapping groups; missing reference and repair | The prototype's fixed color choices and static fixture previews do not establish full editing or resolution behavior |
| Creation and cross-page drafts | Create a routine and scene from empty; create a missing scene from the routine and return; validation at Create; disabled/enabled behavior stated explicitly | Prevent a separate inconsistent wizard system, empty placeholder entities, or lost drafts |
| Shared failure states | Invalid field, failed save with retry, concurrent update, applied-but-not-persisted result; navigate between retained drafts and deliberately discard one | Defines one reusable draft/save/error model instead of each screen inventing its own |

Use representative synthetic fixtures, including long names and a large catalog. A single shared list/picker stress case covers search, selected items, missing selections, no results, loading and retry. Carry these fixtures into production interaction tests. Each study should show desktop and phone behavior; avoid producing another full gallery where a focused state or interaction demonstrates the decision.

## Proposed defaults for that pass

These are recommendations to demonstrate, not additional confirmed preferences:

- Creation uses the same entity editor and controls as editing. Offer optional starting templates and sensible name/ID suggestions; keep a clear path to start from scratch. Only add a guided step if it resolves a real dependency, such as selecting an integration type.
- List items navigate to stable detail pages. Preserve search/filter/scroll when returning. Defer a split-pane desktop editor until the basic list/detail model proves insufficient.
- Internal links retain drafts and do not interrupt with a discard warning. Warn when an action actually loses work. Provide a compact way to return to retained dirty entities without turning Settings into a tab-management application.
- Preview evaluates the current draft; Activate/Run commands explicitly use saved configuration unless a separately designed flow says otherwise. Saving a scene does not activate it.
- Prefer choosing/removing/reordering explicit items over early broad bulk-edit features. Preserve existing necessary bulk behavior; add new bulk workflows only when their value and save scope are clear.
- Do not silently migrate legacy routines or replace script programs while saving unrelated fields. Unsupported definitions remain inspectable and exportable; the editor explains any unsupported operation.

## Engineering contracts to finish before the affected implementation

These are implementation planning tasks, not additional visual approval rounds:

1. **Coverage matrix:** every editable schema field, array/map and variant maps to a control, its empty/default semantics and an appropriate round-trip fixture. Include all integration-specific collections, legacy versions, unknown fields, secrets, stable node IDs and scene target order. An inventory table alone is not proof of coverage.
2. **Graph mapping:** write down valid insert/move operations and lossless native-definition serialization. Unsupported arbitrary graph connections must not be offered. Auto-layout is sufficient for the agreed direction; user-managed canvas-position persistence is not required for the first implementation.
3. **Save and draft lifecycle:** define endpoint scopes, dirty baselines, retained drafts, validation mapping, revision/precondition handling, persistence outcomes, and live-data refresh behavior. Client-only stale-data comparisons cannot guarantee concurrent-write safety.
4. **Health and preferences:** database/API representation for the shared advanced setting and reporting policies; report receipt semantics for sensors/controllable devices; startup grace, ignore behavior, recovery and event deduplication. Keep policy separate from transient health observations.
5. **Preview contract:** structured color/brightness, capabilities, unknown/unchanged/mixed states and provenance. Resolve saved versus draft states honestly; support actual stored color representations, not only the mockup's Kelvin presets. Ring brightness is a visual aid, not a photometric claim.
6. **Replacement map:** destination routes, navigation groups, redirects for existing deep links, reusable components and old authoring surfaces to retire. Existing floorplan/calibration/assistant workflows should adopt the shared shell/actions while retaining their domain-specific behavior unless explicitly redesigned.

## When to stop prototyping

Move into implementation when the four focused studies above have a coherent behavior and any material user-facing choice is resolved. Ordinary forms, empty states and category pages can then be built from the approved shared system and reviewed as working screens. Do not delay the whole overhaul for additional color, spacing or branding exploration.

Start with shared tokens, navigation, preview indicator, collection controls and draft/save behavior, then complete one small entity end to end. Follow with the routine and scene editors using their proven complex cases. Keep desktop/phone checks and schema round-trip verification attached to each slice.

The prototypes demonstrate layout and selected interactions. They are not a validated serializer, a backend simulation, a complete accessibility audit or a substitute for persistence/conflict tests.

## Study 03 completion

The four focused prototypes now exist, including a 240-entry searchable picker with retained selection/loading/retry states. The complex routine has a statically type-checked fixture against generated bindings. Browser checks cover creation/return, color cancellation, reordering, mode drafts, missing-source repair, validation, failed-save retry, conflict choices and a cross-page persistence warning. See REVIEW-NOTES.md for measured scope.

The user confirmed that new routines default to Enable after creating checked. No additional visual-direction decision is blocking a first implementation slice after this review. Field-level coverage and real API save/resolution contracts remain engineering acceptance work for their slices, not a reason to keep generating galleries.

## Layout feedback after Study 03

The user preferred the earlier routine and desktop scene table. Study 04 therefore restores the three-lane flow canvas and extends the aligned scene rows for complex targets. Treat that correction as part of the implementation direction; the Study 03 panel/card layouts are superseded. Behavior and engineering coverage requirements remain applicable.
