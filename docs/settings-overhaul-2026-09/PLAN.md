# Settings overhaul — design working document

Status: **approved and implementation active**. Study 04 restores the earlier routine flow and desktop scene table after user feedback. Started 2026-09-29. See [implementation progress and outstanding acceptance](IMPLEMENTATION.md), [the final interaction review](FINAL-PASS.md) and [implementation readiness](IMPLEMENTATION-READINESS.md).

This proposal supersedes the interaction recommendations in `../settings-ux-redesign-plan.md` and `../settings-mockups/IMPLEMENTATION_PLAN.md` for this new design effort. Their checked boxes describe previous work, not acceptance of this redesign. In particular, do not carry forward their collapsed-by-default sections, read/change/edit sequence, or one-section-at-a-time restriction.

## Decisions from this conversation

| Topic | Decision |
| --- | --- |
| Audience | Both the owner/power user and less technical household members |
| Devices | Phone and desktop matter equally |
| Persistence | Explicit Save per page or section, with a clear unsaved indicator |
| Groups | Call them **Rooms & groups**; no artificial schema distinction |
| Routine authoring | Explore a **visual flow or node editor** |
| Routine layout | **Guided flow**, automatic layout, controls inside blocks |
| Phone flow | Optimize the arrangement for each screen; vertical connected blocks are accepted |
| Visual direction | **A — Compact**, including its spacing and colors, selected after study 01 |
| Landing page | Blend quick category navigation with a concise configuration/status overview |
| Priority journeys | All proposed everyday configuration and troubleshooting workflows matter |
| Technical detail | Useful details inline, controlled by a shared **Show advanced details** preference; assume one shared user until accounts exist |
| Relationships | Make referenced entities easy to open; preserve the originating draft |
| Scene layouts | **Desktop table/columns explicitly preferred over card grids**, including complex target modes; retain phone target cards |
| Complex routine presentation | Use the earlier `#routine` canvas and three-lane layout as the reference; extend its nodes for branches/timers rather than replacing it with large section panels |
| Phone routines | Existing open, connected flow is liked; retain its clear section treatment |
| State previews | Color circle with surrounding brightness indicator explicitly approved; reuse it wherever a relevant state can be shown accurately |
| Device attention | Integration reporting defaults, per-device overrides, and an Ignore option |
| Consistency | Shared action placement, styles and spacing across pages; no promotional slogans |
| New routine default | **Enable after creating is checked**; creation makes the routine ready to run |
| Work now | Implement the entire approved plan; verify against current schemas and the acceptance requirements |

The user approved the desktop and phone prototype after study 02, explicitly endorsing the color circle and brightness ring. The baseline is settled. Study 03 now demonstrates complex editor behavior, creation and recoverable failures; see FINAL-PASS.md for behavior and source-backed corrections. The approved phone routine structure should not be replaced merely to make its page shorter.

## Product thesis

Settings should feel like a workspace you can immediately use. Visible values should already be controls when their meaning is clear. Open a routine and see its starting events, conditions, and actions. Open a scene and see its target states. Open a room and see its members. Changing a value creates a draft; Save commits it.

Use progressive disclosure for uncommon complexity, never for the basic purpose of the page. A node's advanced scheduling policy may be folded; its device, event, and threshold must not be. Existing non-default advanced values have a visible summary. Errors open their owning area and focus the relevant field.

Names, spacing, typography, and alignment carry the hierarchy. Cards group genuinely related things. Avoid a card around every label, repeated status badges, repeated descriptions, and metadata that crowds out the control it describes.

## Schema and API findings

The source of truth is the Rust storage/API schema, not the shape of the existing editors. Paths below are relative to the repository root. This is an initial coverage inventory; implementation begins with field-by-field fixtures and serialization checks.

| Entity | Actual authoring contract | UI consequences |
| --- | --- | --- |
| Rooms & groups | `server/src/db/config_queries.rs`: `GroupRow` has name, hidden, **devices[]**, **linked_groups[]** | Multi-select direct members and linked groups independently; distinguish inherited membership; missing references stay repairable; no one-room-per-device assumption |
| Scenes | `SceneRow`: device_states map, group_states map, **group_state_order[]**, optional script, hidden | Editable target rows; visible state/link mode; ordered group targets and separate device overrides; preserve omitted state fields |
| Scene target variants | `server/src/types/scene.rs`: explicit state, device link, scene link; scene activation can scope **device_keys[] / group_keys[]** | No single-target controls for list fields; preserve omitted properties and expose their actual defaults: omitted power defaults On; omitted brightness defaults 100% when powered on; omitted color is Not specified |
| Routine storage | `RoutineRow`: authoritative semantics_version, revision, raw definition_v2, legacy rules/actions | Preserve v1, opaque/new fields, stable node IDs and v2 version semantics; never silently convert or flatten |
| Routine starts | `automation_definition.rs`: **triggers[]**, Report, StateChange, PredicateTransition, PredicateFor, Schedule, TimerFired, Startup, Manual | Multiple start nodes; label report versus change versus held condition accurately; fields and durations directly editable |
| Routine conditions | All/Any lists, nested Not, Comparison over device/helper/computed source, Group quantifiers All/Any/None/Partial | Visible AND/OR grouping and negation; nested groups remain nested; unknown is distinct from false |
| Routine program | Native **steps[]** or Script; activate/cycle scenes, power, dim, random color, **choose branches[] with steps[]**, timers, helpers, invoke routine | Structured graph reflects ordered sequence and first-match branches; script is a first-class node/editor, not a fake native sequence |
| Routine targets | `TargetSpec.devices[]`, `groups[]`; scene cycles have multiple scenes and per-scene target/transition overrides; helper scene selection has mapping map | Multi-select with removable selected rows; repeatable mapping editor; ordered cycle editor; distinguish empty/default scope from explicit targets |
| Scheduling | Cron or interval, timezone, backlog policy and optional catch-up lateness | Human time/day controls with explicit timezone plus advanced cron; preserve valid schedules that cannot be represented by a simple day picker |
| Devices | `device.rs`: controllable/sensor variants; capabilities, requested state, latest report, availability, management policy | Capability-specific controls; distinguish command from configuration; show sensor fields/history and unknown availability honestly |
| Connections | `IntegrationRow` plugin/config/enabled; `integration.rs` schema describes primitive fields and JSON | Structured repeatable controls need additional schema metadata or typed plugin adapters; existing generic schema cannot describe nested array items |
| MQTT | `integrations/mqtt/mod.rs`: **sensor_value_fields[]**, **disabled_device_ids[]**, ranges/pointers/modes | Multiple field rows, explicit range pairs, preserved inactive mode values, device exclusions with search |
| Other integrations | Cron schedules map, dummy devices map; module-specific definitions | Typed row editors for keyed records and nested actions; lossless advanced JSON fallback |
| Helpers | `automation_value.rs`: boolean, enum **options[]**, number bounds, string, initial value, persistence | Editable options list; definition save separate from immediate current-value action |
| Computed sources | `automation_source.rs`: timezone, refresh interval, **aliases[]**, circadian parameters or script; preview endpoint | Multiple aliases; visible day/night controls and sample curve; separate draft preview and current output |
| Sensor catalog | `api/config.rs`: sensors[] and groups[] with **sensor_ids[]**; device sensor config separately | Every catalog/group membership must be editable; do not confuse sensor group with a device group |
| Layouts/calibration | Floorplan metadata, grid/image, group placements; dashboard layouts/widgets; calibration profiles/assignments/sessions | Purpose-built layout/session tools linked from settings; preserve separate API lifecycles |
| System/provider | Core patch, widget settings, assistant settings with masked keys | Independent save boundaries by actual endpoint; stored-secret placeholder means unchanged, never a replacement value |
| Logs | `types/logs.rs`: timestamp, level, target, message; `core/logs.rs`: newest **500 in memory**; GET returns buffer | Dense searchable table; expand full message. No invented payload object, persistent archive, cursor, or server search |

Scene precedence must follow the actual resolver (`core/scenes.rs`): ordered group targets are applied, then explicit device targets, then evaluated script output, then stored runtime overrides. Preview and explanation must be checked against the resolver, not assumed from labels such as “script overrides.”

### Transport facts that affect design

- Groups, scenes, integrations, and routines have entity CRUD under `/api/v1/config`. Helpers and sources use PUT upserts, not a generic POST-create assumption. Device-key endpoints require careful encoding/body handling.
- Config responses include `write.applied`, persistence, and warning. “Saved” is only appropriate when persisted. An applied but memory-only change needs a durable visible warning and backup path.
- Entity GET data comes from snapshots. Writes go through the state actor. Integration reload work must keep its two-phase lifecycle outside long actor mutations.
- Routines have a server-managed revision, but the inspected update route does not implement an expected-revision precondition. A client comparison alone cannot eliminate a concurrent-save race.
- Logs have no pagination/search query contract. Start with filtering the supplied buffer and pausing display refresh. Durable history/export beyond the buffer requires explicit backend scope.
- Routine preview accepts a draft definition, trigger ID, and value overrides. Schedule preview and value-fields/value-history also exist. Use these rather than inventing successful simulation evidence.
- Existing routine history is evidence about recorded attempts; current condition readings must not be used to invent a past explanation. Universal connection health is not available simply because an integration is enabled.

## Proposed information architecture

Desktop: one application navigation surface. Within Settings, a grouped category list provides direct destinations. Integrate it with the existing app rail so we do not end up with three navigation columns. Phone: one Settings/category menu, a compact parent breadcrumb, the page title, and the content. Browser Back remains native.

```
Settings
  Home setup       Rooms & groups · Devices · Floorplans
  Automation       Scenes · Routines · Helpers · Computed sources
  Connections      Integrations · Sensor catalog · Widget data sources
  System           Preferences · Assistant · Backups & restore
  Troubleshooting  Diagnostics · Routine activity · Logs
```

These are navigation groups, not collapsed containers. The home page provides clean destination rows with counts and concise descriptions. Add room belongs on Rooms & groups; add routine belongs on Routines. Show real actionable issues once, in a small attention area. No duplicate create controls or giant dashboard of statistics.

The AppBar holds application-wide utilities. Breadcrumbs express location once. A detail page does not have an additional Back to X row above the breadcrumb. Do not repeat the same title in AppBar, breadcrumb current item, and page heading; breadcrumbs show parents, heading names the item.

Existing deep links, filters, `?section=`, and `?target=` map to the equivalent destination/focus target. Do not break links from diagnostics, assistant, history, command palette, or room pages.

### Relationships are navigation

Every resolvable entity reference should offer a real link to its detail: routine → scene, invoked routine, helper, device or group; scene → target device/group or linked scene/device; room/group → members and linked groups; device → integration and memberships; source → aliases; diagnostics/history → exact entity and relevant node/field. Keep link and picker separate so opening a target never changes selection. Use native anchors for open-in-new-tab and keyboard support.

Show concise **Used by** relationships where they help understand impact. Derive them from actual references; script dependencies may be unknown. Missing targets remain visible with repair controls rather than a link to nowhere. Navigating from a draft to a related entity and back must retain draft values, dirty state, focus/scroll context, and graph position. Preserve several entity drafts in memory with explicit scope; no implicit save when following a link. After a related entity is changed or deleted, refresh its resolved label/availability without replacing the originating draft. A session ends with explicit save/discard or the normal leave warning.

## Editing contract

1. Controls are available on arrival. No Edit, Change, or unlock step for ordinary fields. A readable text field is still visibly a field; do not require hover to discover editing.
2. An entity has one draft and one Save/Discard boundary where the API writes one object. You can change name, members, and visibility together. This avoids partially saving a routine with mismatched triggers and actions.
3. System settings spanning unrelated endpoints use clearly named section saves. Do not offer an apparently atomic Save all unless the backend can honor it; report partial failures individually if batching is later added.
4. A compact persistent save bar appears only when dirty. Explain scope: “Unsaved changes to Evening motion.” Save progresses and reports persistence; failures retain the draft. Discard restores the saved baseline. Local undo is separate from saving.
5. Internal navigation that retains an entity draft does not prompt merely because it is dirty; related-page visits and browser Back restore it. Prompt once before an action would actually discard unsaved work, including leaving/reloading the application; cancel preserves focus and draft. Make any retained drafts discoverable so navigating away cannot silently orphan work. For multi-step creation or linked creation journeys, preserve non-secret drafts with a deliberate lifecycle. Never store credentials in browser storage.
6. Background updates refresh live evidence without overwriting the draft. Use entity revisions/preconditions for reliable conflict rejection if implemented; otherwise disclose and handle the remaining limitation in engineering acceptance.
7. Validation is beside the field plus a linked summary. Missing references stay visible with their identifier and Replace/Remove. Preserve unknown keys on unrelated edits. Do not destroy complex values when switching between visual and advanced views.
8. Commands are labeled by action: Activate scene, Set value, Run routine. A configuration save does not double as a command. Clearly label whether a command uses saved configuration; preview of a draft is harmless and separate.

## Routine flow editor

The graph is a view/editor of `RoutineDefinitionV2`, not a new automation language. The native schema expresses ordered sequences, nested first-match choices, and trigger subscriptions; it cannot express arbitrary cycles or arbitrary parallel joins. Affordances must restrict connections to valid structures. A diagram which looks like a general DAG but loses meaning on save is unacceptable.

The user selected guided automatic layout while the concepts were being prepared:

- **Guided flow:** multiple visible start blocks converge on a condition group; connected action blocks form a sequence with branch lanes. Layout is automatic. Device/event/value controls are directly in the blocks. Add buttons sit at legal insertion points. This is the recommended starting hypothesis for mixed household use.
- **Canvas + inspector (parked alternative):** pan/zoom, drag placement, valid connection handles, and a contextual inspector for complex fields. This was considered but is not in the first mockups after the guided-flow preference. Revisit only if real complex routines make automatic layout inadequate.

Phone direction: an adaptive vertical connected flow with branch lanes represented by nested labeled blocks. It preserves the same underlying graph and stable node IDs. A phone user must be able to create, reorder, and repair a branch without pixel-precise dragging.

Condition groups have visible All / Any controls, child rows, and negation. Choose branches say “First matching branch,” not simultaneous execution. Timer scheduling and Timer fired are distinct node types; their relationship can be explained without drawing an execution loop that the schema does not have. Multiple triggers mean any can start the routine; do not draw them as an AND join.

Whole-routine Save preserves the node IDs, unknown raw fields, and execution policy. Converting program kind between script/native is a deliberate reviewed replacement. Legacy v1 routines are read-only, including metadata and enable state, until explicitly converted to the new format. Reuse the existing converter for an in-editor proposal or the offline upgrade command. Unsupported future versions remain readable/exportable without lossy saving. This incorporates the user’s implementation-stage clarification.

Canvas positions, if persisted, are user-managed configuration and need database representation/API support, not a new Settings.toml setting. Auto-layout can avoid this requirement. A possible separate visual-model field must round-trip export/import with a default-empty representation.

## Screen briefs

| Screen | Primary content and editing | Secondary detail |
| --- | --- | --- |
| Settings home | Destination rows; counts; a few actual issues | No repeated add buttons, closed category accordions, or duplicate lists |
| Rooms & groups list | Name, direct/inherited counts, visibility; compact optional floorplan thumbnail; search; Add | Filter hidden, nested groups, missing members |
| Room/group detail | Editable name, visibility; selected device/member rows and linked-group rows; searchable Add | Resolved members read-only with provenance; placement; references; cycle errors |
| Devices list | Name, type, groups, integration, evidence-based availability | Filters and later bulk actions based on actual needs |
| Device detail | Editable display name/metadata; sensor fields or capability controls; requested/reported status nearby | Raw payload, IDs, policy, calibration, replace/delete workflows |
| Scenes list | Name, target summary, small swatches; one add action | Hidden/missing-target filters; activation clearly separate from opening |
| Scene detail | Direct target-state controls: power, brightness, color/temperature, transition; mode for explicit/link | Group precedence and device overrides, script editor, resolved view and conflicts |
| Routines list | Name, enabled, short event → outcome, latest recorded result | Filter type/status, open trace; no accordion per routine |
| Routine detail | Visual flow and immediately editable node controls; save bar; draft preview | Execution policy, schedule details, evidence/activity, script/raw definition |
| Connections | Plugin name/mode, enabled; detail with ordinary fields immediately editable | Typed repeatable mappings and schedules; secrets; advanced JSON; device evidence |
| Helpers | Name/type and current value; open definition fields and option rows | Immediate set-value command separated from default/persistence config |
| Computed sources | Current output, editable day/night parameters or script, timezone, curve preview | Alias list, refresh cadence, quality, draft-vs-saved preview |
| Sensors / widget sources | Editable source definitions and group membership; repeatable entries | Do not conflate widget selections with source definitions; masked credentials |
| Floorplans / dashboards | Large canvas with compact tools and selection inspector | Layout list, undo/redo, saving, linked room placement; preserve existing special editors where sound |
| Preferences / assistant | Labeled controls, explicit logical section saves | Advanced provider fields, retained credentials, connection errors |
| Diagnostics / activity | Compact issue/attempt rows with useful direct repair links | Expand recorded evidence; support missing/unknown evidence without fabricated conclusions |
| Logs | 28–32 px desktop data rows; time, level, source, message; search/level/source filters | Full message expansion, wrap toggle, copy; phone uses 44 px minimum interactive targets; buffer limit visible |
| Backups / restore | Export and import/restore choices with clear scope | Preview affected entities, secrets excluded by default, destructive confirmation only when needed |

## Collection and variant coverage gate

Every `Vec`, map, tagged enum, optional value, and nullable property in the authoring schema gets a UI mapping. The implementation matrix must name the renderer, empty behavior, add/remove behavior, ordering semantics, and round-trip fixture.

At minimum cover: group direct and linked members; scene device/group maps and order; scene-link target scopes; routine triggers; nested All/Any; ordered steps; choose branches and their steps; cycle entries and scopes; helper-to-scene mapping; timer capture targets; source aliases; helper enum options; MQTT sensor paths and disabled devices; cron schedules; dummy devices; sensor-catalog members; dashboard/widget selections; calibration assignments.

Do not fake arrays by editing the first element. Some schema fields genuinely are singular (for example a Report trigger's device and SetPower's device). A multi-device convenience UI must explain that it generates multiple native nodes, or stay singular; do not claim backend semantics that do not exist.

## Proposed backend work, separate from visual work

1. Extend integration form schema to describe repeatable arrays/maps and nested objects, or ship typed per-plugin adapters with tests. Decide after the inventory; primitive `Json` alone is inadequate for friendly completeness.
2. Add reliable expected-version/hash write preconditions for entities if we promise conflict-safe editing. Keep comparison and mutation atomic within the actor/write path; define 409 response and UI merge/reload handling. Routine revision alone is not currently enough.
3. Consider reference/dependency reporting if deletion impact cannot be derived reliably, particularly script references. Mark script dependencies as unknown rather than claiming complete impact analysis.
4. Persist graph placement only if a free canvas is chosen. Use database-backed metadata and compatible export/import.

Other core redesign elements fit current endpoints. Do not add runtime configuration to TOML. No need for a backend rewrite to remove edit gates or make logs compact.

### Additional scope agreed during study 02

- **Shared advanced-details preference:** stored in the database and read through the settings API. This applies across configuration pages for the current shared user. Keep the setting scoped so future account overrides can be added, but do not invent an account system now. The prototype stores it only for its current tab. Existing browser-local theme storage is not a reason to add a second canonical store for this new preference.
- **Reporting policies:** database-backed per-integration defaults, with per-device inherit/custom/ignore overrides. Show effective policy and where it came from. Ignore suppresses missing-report checks; it does not conceal explicit offline evidence or broken references. Defaults must respect event-only/battery devices and integration capabilities rather than imposing one universal timeout.
- **Report evidence and health snapshots:** current `ControllableDevice.last_report` covers controllable devices, while sensor data does not provide an equivalent universal receipt timestamp. Add explicit report-observation metadata before promising sensor freshness detection. Count valid fresh reports even when the value has not changed; value-history timestamps are not heartbeat timestamps. Retained/cached messages are not fresh evidence.
- **Consistent issue computation:** one source of truth for overview counts, device/integration details and diagnostics; deduplicate affected device keys across issues. Present late reports, explicit offline, missing references and unknown observation separately. Do not infer gateway disconnection from one quiet device. Account for startup/warmup, polling cadence, late scheduling and recovery to avoid alert flapping.
- **Useful log events:** emit warning and recovery messages on health transitions, not every UI refresh or poll. Include friendly name, stable device/integration key, last fresh report timestamp, policy deadline and reason where supported. The current log payload is only timestamp/level/target/message; add backward-compatible optional structured reference fields if reliable device links/filtering are required. Never recover references by guessing from a human message string. Existing logs remain an in-memory 500-entry buffer; persistent device-health history would be separate explicit scope.
- **Import/export:** new preferences and reporting policies need default-compatible representations and export/import round-trip coverage. Health observations are runtime evidence, not silently fabricated persisted configuration. New reads use runtime snapshots and writes use the state actor/database paths.

Concrete examples: “Window light has not reported since 16:42:05; expected within 30 minutes” and “Window light is reporting again; missing-report warning cleared.” These are proposed new events, not messages claimed to exist in the current server.

## Visual concepts and review

**Current:** [Study 02 review](review.html), [interactive prototype](index.html), and [shared interaction rules](INTERACTION-SYSTEM.md). Study 01 comparisons remain in `review-01.html` as historical artifacts.

`index.html` is a standalone, synthetic-data prototype; `previews/` contains rendered screenshots. No production backend is contacted. Mock saves are explicitly demo-only. Two treatments share content so density/style can be judged independently from functionality:

- A — **Compact workspace:** neutral cool surface, tighter rows, low visual ornament, structured navigation, data-first lists.
- B — **Soft workspace:** warmer background, larger spacing and controls, rounded groups, more breathing room.

First study includes settings home, routine guided flow, scene targets, rooms & groups list/detail, connection multi-fields, device list/detail, and dense logs. Phone versions are real responsive layouts, not desktop screens shrunk into a device outline. Treat screenshots as proposals, not API execution evidence. All controls use synthetic data; some actions explain intended behavior instead of fully simulating it. Study 03 now covers representative branches/timers, creation, scene modes, collections and conflict/error states. Remaining ordinary system pages can use the shared patterns during implementation.

First review: choose density and routine interaction, identify missing content, try editing a field and a repeatable entry, inspect phone flow. Second review: complex branches, long lists, validation/missing references, draft/conflict states, creation journeys. Only then agree on implementation scope and sequencing.

Study 01 review chose Compact, useful technical details, and retained the phone routine structure. Study 02 prioritizes the requested phone-scene refinement and shared patterns, plus attention summaries and preferences. The complex-branch/creation/conflict work remains a subsequent design pass.

## Delivery sequence after design agreement

1. **Contract inventory:** authoritative fields/variants/endpoints, semantic fixtures, reference/secret handling, route mapping; resolve identified API gaps.
2. **Foundation:** single navigation hierarchy, design tokens, responsive rows, directly editable controls, repeatable collections, entity drafts/save bar, conflict/validation/dirty guards. Implement one small entity to prove the model.
3. **Routine vertical slice:** supported-schema graph model, serialization/round-trip checks, node controls, nested branches, phone operation, preview and recorded evidence. Validate with simple and complex routines before migrating the remaining builders.
4. **Scenes and home structure:** target rows and resolved output, rooms/groups, devices, bulk/membership behavior where agreed.
5. **Complete coverage:** connections and typed collections; helpers/sources/sensors/widgets; preferences/assistant; floorplans/calibration integration; backup/restore.
6. **Troubleshooting and cleanup:** compact logs/activity/diagnostics; deep-link compatibility; remove duplicate authoring surfaces; update old design docs to point to the agreed contract.
7. **Acceptance:** representative household tasks, phone/desktop review, accessibility, correct persistence and failures. Final implementation review before deployment.

Each phase is a coherent reviewable slice. Replacement of visual components does not imply throwing away reliable API hooks, domain logic, or serialization tests.

## Acceptance criteria

- Ordinary visible field: **zero disclosure/edit gates** before interacting. Complex node: at most one selection/open action before its controls.
- A normal routine's starts, condition, and actions are visible on desktop on arrival; phone shows a readable connected sequence without collapsed primary content. Large routines navigate by overview/search/zoom, not tiny illegible nodes.
- Settings home has one link per destination and no duplicate entity-creation actions. Each screen has one location hierarchy.
- Simple desktop log messages occupy at most 32 px per row. Interactive targets remain accessible; phone/zoom wrap naturally. No mandatory 150 px card shell.
- Empty, single, and multi-item collections survive load/edit/save/reload without truncation. Preserve unknown fields, order where meaningful, null/default semantics, and stable identifiers.
- Save failure retains edits. Cancel restores baseline. Live updates preserve drafts. Conflicts and memory-only results never masquerade as saved success.
- Phone widths 360/390/430, desktop 1280/1440, keyboard-only, 200% zoom, reduced motion, light/dark contrast, and software keyboard. No unreachable Save, clipped picker, nested scroll trap, or drag-only operation.
- Device commands, scene activation, routine invocation, helper value changes, config writes, and previews keep their distinct contracts.
- Task review: create a two-trigger routine; change a nested threshold; add/reorder a branch; set a scene for multiple groups with one device override; add several sensor paths; rename a device; repair a missing group member; find a relevant log and read the full message.
- Meaningful verification: schema round-trip fixtures and graph legality tests; save/conflict/failure interaction tests; narrow/wide screenshots; existing typecheck/lint/build and relevant Rust gates. No claims of usability acceptance until the user has reviewed.

## Questions for subsequent review

- Do creation pages use the same direct editor with optional starting templates, or a short guided beginning?
- Does opening a list item always navigate, or should desktop also offer a split list/detail workspace?
- Which bulk tasks recur often enough to deserve controls (hide, disable, move/add group membership, duplicate)?
- Should device technical IDs be visible in lists or only on demand?
- Which routine shapes are common in the real home: long sequences, lots of branches, timers, scripts, or many starts?
- Is editing live state inside configuration helpful, or should it be a clearly separated Test panel?
- Which theme should lead the finished design, and how much existing branding should carry over?
- Which changes are explicitly out of scope, if any: floorplan canvas, calibration workflow, assistant review UI, dashboard editing?

Answers should update this document and concept revisions, with proposed decisions distinguished from confirmed ones.
