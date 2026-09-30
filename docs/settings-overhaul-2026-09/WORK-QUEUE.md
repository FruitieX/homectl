# Remaining UI overhaul work queue

Updated: 2026-09-30. User explicitly requested documenting this queue and
pursuing it as a goal. This is the ordered completion checklist for the
existing overhaul goal, not a replacement design proposal.

Design authority: [EVERYDAY-REVIEW.md](EVERYDAY-REVIEW.md), Study 05 Compact,
and the approved **Study 04 complex routine** in
`index.html?direction=compact&detail=useful&theme=light#complex-routine`.
Track supporting evidence in [VISUAL-AUDIT.md](VISUAL-AUDIT.md),
[EVERYDAY-IMPLEMENTATION.md](EVERYDAY-IMPLEMENTATION.md),
[IMPLEMENTATION.md](IMPLEMENTATION.md), and [REFINEMENTS.md](REFINEMENTS.md).

## 1. Routine editor — highest visual priority

Delivered in `e5d7983e`: three connected desktop columns, vertical phone flow,
dotted background, compact icon headings, visible move buttons, combined value
source picker, quieter optional scene controls, and sandboxed scripts as native
action blocks. Six structural browser checks pass at both sizes. Automation
library and mixed-script execution checks pass.

- [x] Finish visual review of complex nested conditions and branches, including
      control alignment, readable titles, sensible density and narrow screens.
- [x] Exercise editing, move, duplicate, delete and Save/Discard after changing
      control types. Preserve stable IDs, unknown fields and related-page drafts.
- [x] Verify adding/editing/persisting a script among ordinary actions, including
      a branch. Keep whole-program legacy script conversion available.
- [x] Close remaining mixed-script runtime cases where needed: selected branch
      semantics, per-block state/context and stale/manual-intent protection.
- [x] Refresh final paired screenshots after the last visual changes.

Routine checkpoint, 2026-09-29: the expanded browser journey passes 21 checks
on desktop and phone, including a script inside a branch, actual local Monaco
rendering, plain-text/code switching, persistence, duplicate/remove/move,
per-type draft restoration and Discard. The editor and its workers are bundled
locally, follow the selected theme and offer a plain-text fallback. API/limits
metadata no longer looks editable, and script examples use the shared picker.
The starter handles empty initial memory. Backend regressions cover independent
block memory and declared contexts across two runs, selected branches, failed
worker slot cleanup, definition changes and newer manual intent suppressing
frozen native steps. Whole-program conversion now passes five browser checks:
no early write, stable action identity, Discard, and complete script/declaration
preservation on Save. Final desktop/phone review uses compact condition rows
with colored nesting rails and consistent selectors; seven structural checks
include aligned side-by-side comparison controls. Updated screenshots are in
the [comparison gallery](implementation-evidence/comparison/index.html).
Evidence: `implementation-evidence/routine-editor-*-checkpoint.log`
and `routine-script-*-checkpoint.log`; UI type/lint/build pass.

## 2. New widget and widget editing

Delivered: visual searchable type gallery, size presets, desktop/phone
width diagrams, real read-only widget preview, explicit Create/Save, retained
per-type drafts. Eight creation checks pass on desktop and phone.

- [x] Finish phone composition and preview discoverability; verify all widget
      families, empty/missing sources, invalid draft dimensions and recovery.
- [x] Verify keyboard operation and that preview interactions issue no commands.
- [x] Ensure layout guidance reflects actual order/size-based dashboard placement;
      retain custom dimensions without making raw coordinates the primary UI.
- [x] Capture creation-state screenshots as well as the saved editor.
- [x] Commit and push the widget editor with its required widget dependencies.

Widget checkpoint: 21 native keyboard/preview checks at each viewport cover all
17 types, blank dimensions, creation validation, inert preview controls and
sandboxed embedded pages. Eight creation checks at each size verify exact saved
widget identity, retained per-type fields, dimensions and no writes before Create.
Unexpected weather/timetable responses now become resource errors rather than
rendering exceptions. Widget headings respect configured titles; saved private
calendar source metadata reaches the preview. Creation and phone-preview captures
are in the comparison gallery; logs are under `implementation-evidence/everyday/`.

## 3. Rooms and dashboard

Preview reliability fix `dafcb2dc` is pushed: shared refreshable grid queries,
SVG thumbnails without a GPU context per room, interactive renderer fallback,
and room-mask framing when no individual device is placed.
Delivered additions include dashboard thumbnails, compact wrapping scene buttons,
divided room device rows, desktop brightness sliders and Save as scene.

- [x] Compare rooms list, room detail, dashboard and widget views against the
      approved Compact mockups on desktop and phone.
- [x] Verify embedded previews in the rooms list, room detail and dashboard,
      including nested members, no placement, saved map changes and recovery.
- [x] Finish room conditions/climate composition using real available readings;
      keep missing data honest rather than adding fictional values.
- [x] Preserve scoped actions, related links, read-only/disabled/missing devices,
      attention counts and appropriate sizing for small widgets.
- [x] Review final screenshots and push the everyday UI checkpoint.

Room checkpoint, 2026-09-30: sixteen checks pass at each viewport. The journey
covers nested membership, disabled/readonly/missing devices, no-map rooms, exact
climate source identity, missing humidity, timestamps, keyboard chart inspection,
small widget composition, attention expansion and exact writable command scope.
Actual editor Save refreshes all three preview locations without a page reload.
Catalog and individual floorplan reads recover after exhausted retries; stored
image metadata avoids requesting nonexistent images. A wide-plan phone check
found and fixed a grid minimum-width constraint missed by the tall-plan fixture.
The room/list/dashboard screenshots are compared with Study 05 in the gallery.
Final captures also caught an after-midnight chart label issue: minute ticks now
show the time instead of repeating the weekday throughout the first hour.

## 4. Floorplan editor, map and inspectors

Delivered: two-dimensional Fit, additional zoom-out range, backing
resolution adjustments, searchable placed/unplaced lists and brightness rings.
Desktop Fit check passes; further interaction acceptance remains.

- [x] Verify Fit, zoom, resize and placement coordinates on desktop and phone.
- [x] Verify placing, moving, removing and undoing device placement.
- [x] Review map device/group inspectors, shared previews, scope, related links,
      dismissal and fallback controls against the mockups.
- [x] Check marker readability, brightness/off/attention states and rendering
      sharpness with representative floorplans.

Floorplan checkpoint: ten desktop and eleven phone checks cover native placement
and dragging, cancelled touch, zoomed coordinates, consecutive Undo, Save without
losing other devices or extension fields, and Fit after viewport resizing. Editor
labels are now 12 CSS pixels independently of backing resolution; markers use
actual light color, off/disabled styling and a brightness ring. SVG room previews
now also distinguish disabled lights and show attention badges. Map inspector and
representative state review remain open below. Evidence and screenshots:
`implementation-evidence/everyday/floorplan-placement-*`.

Map follow-up checkpoint, 2026-09-30: seven desktop and eight phone checks
cover exhausted floorplan reads with an explicit Retry, reuse of the shared
metadata/grid cache, no nonexistent image requests, keyboard-operated shared
selectors, device settings links, inspector bounds, Escape/Close and phone
keyboard resizing. Screenshot comparison caught and fixed a Pixi brightness
arc drawing an unwanted line to the map origin. Map and color tabs keep their
scrolling behavior without cramped native scrollbars. Current screenshots and
logs are under `implementation-evidence/everyday/map-review-*`. Full group
inspector, fallback command scope and representative health/label review remain
open; this checkpoint does not close those broader gates. The phone capture
shows labels shrinking too far at Fit: give labels a readable minimum screen
size during the remaining marker review. UI type/lint/build pass.

Map acceptance, 2026-09-30: 13 additional checks at each viewport cover nested
room scope, related room/settings links, deduplicated commands, disabled/read-only/
unavailable exclusions, pending acknowledgments, rejection without optimistic
state changes, context-loss fallback and successful map retry. Labels retain
their screen size through zoom; captures show on/off rings, an offline warning
and a disabled marker. Phone floorplan tabs now occupy their own row so they
cannot overlap breadcrumbs; room inspector padding matches device inspectors.
Study 05 room-map comparisons and the new failure-state captures are in the
gallery. Type checking, lint and production build pass. These simulated GPU-loss
checks exercise the browser event path; they do not claim physical GPU testing.

## 5. Earlier refinements

- [x] Finish sensor ordering acceptance: catalog, groups and group members.
      Native keyboard checks at both sizes verify persistence, independent
      memberships, catalog/widget ordering and group chart ordering.
- [x] Close disabled-device invalidation/re-enable verification. Diagnostic
      suppression tests preserve real enabled errors; a new regression verifies
      repeated disabled invalidation and restored scene resolution after re-enable.
- [x] Verify and publish shared autocomplete padding and widget-source separators.
- [ ] Recheck shared control/overlay consistency where the latest changes touch it.

Refinements checkpoint: six native keyboard checks at each viewport verify the
three sensor orders, retained drafts, unchanged shared membership/extension data,
widget-specific ordering and group ordering in charts. Sensor filters use prefixed
values so a group named `all` cannot collide with a built-in filter. Seven diagnostic
tests (plus four generated binding checks) and the disabled/re-enable regression
pass. Shared autocomplete insets and source-list dividers are checked in the browser.

## 6. Outstanding overhaul acceptance

- [x] Timers: refresh desktop UI evidence and finish all three mode/target editing
      flows. Server execution, restart and Helsinki migration API tests pass.
- [x] Calibration: finish bulk assignment, reset of raw numeric edits and required
      keyboard/phone acceptance without losing retained drafts or color modes.
- [x] Charts: finish phone/touch checks and retain precise inspection, keyboard
      dismissal and readable empty/error states.

Timer acceptance, 2026-09-30: 19 checks pass on desktop and phone. The new
interaction journey saves and reloads a countdown scene action, a scheduled room
action with a scene end action, and a ready-by device on/off pair. It verifies
Helsinki defaults, names/icons, exact durations and date/time, no writes before
Save, related links, retained navigation drafts, Discard and page reload. All
timer selectors now use the shared control. The old native-select test is
replaced by `ui/dev/timer-modes-review.mjs`, which cleans up its own fixture
records. Existing server execution/restart and timer-widget command evidence
remain applicable. Fresh screenshots include all modes and phone action sections;
type checking, lint and production build pass.

Calibration follow-up: eight bulk checks pass at both sizes, including retained
scope, Discard, exact assignment/removal and preserved profiles. A same-route
bulk link now opens selection correctly. Ten color checks pass on phone,
including Reset of an unfinished numeric input; earlier brightness keyboard and
phone lifecycle checks remain recorded in IMPLEMENTATION.md. Five chart input
checks now pass on phone (keyboard, touch, dismissal, 200% zoom); final chart
empty/error visual review remains in the outstanding acceptance gate.
- [ ] Close remaining widget detail, assistant, navigation and recovery gates in
      the two implementation ledgers; remove superseded surfaces safely.
- [ ] Run only the remaining meaningful type/lint/build, integration and browser
      gates; resolve failures before marking delivery complete.

Chart/log checkpoint, 2026-09-30: 11 chart checks pass at 1440 px and
390 px. Empty history, initial failures, explicit retry, cached failures and
successful empty refreshes remain distinct. Shared status identifies retained
samples in widgets, sensor details and room conditions. Empty sensor cards remain
clickable. Axis labels have enforced screen spacing; phone drawer headers and
Close controls stay visible after a retry. Earlier native chart keyboard/touch
and 200% zoom checks remain recorded in the chart-input checkpoint.

8 log checks pass at 1440, 360 and 430 px, using a synthetic 500-entry
buffer. Desktop rows meet the original 32 px maximum; phone rows wrap naturally.
Shared source/level selectors update URL filters, including a source named
`all`; 200-row pagination, complete messages, canonical links and keyboard
focus restoration are verified. Type checking, lint and production build pass.
Full cross-family acceptance remains open in [ACCEPTANCE-AUDIT.md](ACCEPTANCE-AUDIT.md).

Collection checkpoint, 2026-09-30: [FIELD-COVERAGE.md](FIELD-COVERAGE.md) now
maps the required collections to their controls, empty/order behavior and actual
evidence, distinguishing edited values from untouched preservation. The audit
found and fixed numeric inputs disappearing when cleared and type caches moving
to the wrong list item. Fourteen browser checks pass at 1440/390 px, including
unfinished numeric drafts, navigation, decimal/exponent saves, reorder/remove/
re-add, nested-value preservation and Discard. All 219 UI unit tests, type checking,
lint and build pass. The full field gate remains open: next are edited scene-link
scopes, routine target/mapping collections and typed dummy-device variants.

Scene collection checkpoint, 2026-09-30: 18 browser checks pass at 1440/390 px.
Both link modes are edited and persisted; scope collections support multiple,
missing, empty and omitted-default entries. Target replacement retains inactive
behavior drafts; removal clears them. Empty target maps survive reload. Scene
behavior/power and reference controls now use shared selectors/searchable pickers,
with related-page links aligned on phones. The existing scene/color journey and
25 draft/scene unit checks pass, as do type/lint/build. Evidence and comparisons
are recorded in FIELD-COVERAGE.md and the gallery. Next: routine target collections
and the confirmed loss of dynamic-selection mappings when changing selection mode.

Routine selection checkpoint, 2026-09-30: dynamic/fixed and helper/group choices
retain their mapping and fallback drafts. Timer capture retains its edited scope
through off/on. Mapping controls have clear names, phone wrapping and helper links.
Sixteen browser checks pass at 1440/390 px, including keyboard selection, related
navigation, multiple activation/cycle/timer targets, Discard and repeated saves.
The journey also exposed and fixed phone picker reopening through a field label,
and a query-cache merge losing an own `__proto__` key and causing later conflicts.
All 222 UI unit tests, type/lint/build, settings-tab checks at both sizes and the
targeted server duration/capture validation test pass. Evidence is under
`implementation-evidence/collections/routine-selection-*`. Next are typed
integration/helper/source cases and the remaining routine variants in the field
matrix; overall acceptance remains open.

Typed dummy checkpoint, 2026-09-30: 19 native browser checks pass at 1440/390 px,
covering all sensor types, false/zero/empty text, retained drafts, edited capability
ranges, multiple devices, removal/recreation, empty maps and reload. Two Rust
schema tests and all 225 UI tests pass, along with type/lint/build. Screenshots
show compact two-column desktop cards and single-column phone controls. See
FIELD-COVERAGE.md for the distinction between preservation and repair evidence.
Next: MQTT collections/profile and optional resets, helper/source cases and
remaining routine variants. The overall acceptance gate remains open.

MQTT checkpoint, 2026-09-30: 21 collection/profile/secret/draft checks and 9
recovery/reporting checks pass at each 1440/390 px. Selectors are consistent;
partial-management drafts survive switches and optional resets clear hidden
numeric errors. Four integration API tests and one rollback test pass. Evidence
is recorded in FIELD-COVERAGE.md and the screenshot gallery. Next: helper/source
variants, remaining routine contracts and the wider accessibility/recovery audit.

Helper checkpoint, 2026-09-30: 21 editing and 6 live-command checks pass at
1440/390 px, plus 11 phone creation/conflict checks. Shared selectors, two-way
option ordering, initial-choice repair and explicit reset confirmation are verified.
False/zero/empty text and omitted bounds persist; command failures and pending
states preserve definition drafts. Four targeted Rust tests cover schema behavior,
API concurrency and durable/session export. Type/lint/build pass. Next: computed
sources and the remaining routine/module and final acceptance contracts.

Computed-source checkpoint, 2026-09-30: 16 editing and 13 repair/preview checks
pass at 1440/390 px, plus eight phone creation/color/conflict checks. Preset forks
copy the exact shipped body; existing custom drafts are retained. Unknown versions
and malformed aliases remain visible for explicit repair. Empty/error/unsupported
previews are distinct. All 228 UI tests, eight targeted Rust tests and type/lint/
build pass. FIELD-COVERAGE.md records remaining timing, reference and persistence
checks. Remaining routine/module variants and overall acceptance are still open.

Source timing checkpoint, 2026-09-30: 19 checks pass at both 1440/390 px.
Unfinished numeric drafts remain editable; invalid timing focuses the correct
field and blocks Save/preview without changing the stored profile. Exact
millisecond refresh values and zero/omitted brightness survive reload. Phone
chart labels keep a readable size in Compact mode. All 230 UI tests, four Rust
curve/validation tests and type/lint/build pass. Screenshots and field evidence
are updated; source references/persistence and remaining routine variants stay open.

Routine starts checkpoint, 2026-09-30: 14 checks pass at each 1440/390 px.
All eight trigger kinds are edited and saved, including optional report fields,
false predicates and calendar catch-up. Schedule switches retain drafts; disabled
catch-up settings no longer leak into saved definitions. Shared selectors and
precise duration units keep the approved routine layout. Trigger numeric drafts
survive navigation and focus errors. All 232 UI tests, the targeted server calendar
policy test and type/lint/build pass. Remaining: nested conditions/value sources,
action/policy variants and the broader final acceptance gates.

Nested condition checkpoint, 2026-09-30: 32 checks pass at each 1440/390 px.
All/Any/Not edits, every comparison operator and group quantifier, false/zero/
structured operands, type/source restoration and Save/reload are covered. Numeric
drafts follow reordering, and discarded branch errors cannot block Save. Unknown
formats stay visible for explicit removal. Phone source controls now stack to
keep names readable. All 234 UI tests, ten targeted Rust tests and type/lint/build
pass. Remaining routine work: actions, rollout, policies and the final reference/
recovery contracts. Full overhaul acceptance remains open.

Routine execution/timing checkpoint, 2026-09-30: 25 checks pass at each
1440/390 px. Execution modes, action limits and minimum spacing now use shared
controls with explicit validation and retained drafts. Scene transitions and
spatial rollout preserve exact milliseconds, optional values, source choices and
extension fields. Cycle-entry drafts follow reordering/removal. Save opens a
collapsed section before focusing its invalid input. All 234 UI tests, two
targeted Rust compiler tests and type/lint/build pass. Screenshots are recorded.
Remaining: other action variants, script declarations and the broader reference,
persistence, recovery and final acceptance gates. The goal remains active.

Routine action checkpoint, 2026-09-30: 38 checks pass at each 1440/390 px.
Power, dimming, random colors, timer start/replace/cancel, typed helper writes and
routine invocation now have edited Save/reload evidence. Numeric action drafts
retain unfinished text, timer limits match the compiler, and helper switching
restores authored values. Helper details are linked. Screenshot review caught
and fixed a cramped desktop transition field using block-width-based layout.
All 234 UI tests, three targeted Rust compiler tests and type/lint/build pass.
Remaining: script declarations, unavailable references and broader persistence,
recovery/accessibility/final acceptance. The full goal remains active.

Script declaration checkpoint, 2026-09-30: 20 native editing checks pass at
1440/390 px, with six whole-program conversion checks per size. Shared selectors
and compact rows replace the remaining native declaration controls. Device,
room/group, timer and all-state references preserve extensions and per-type drafts;
future device/group IDs can be entered directly. Omitted limits/declarations stay
omitted unless edited. Unsupported data remains visible for explicit removal.
Conversion preserves program extensions and remaps declaration draft paths.
All 234 UI tests, three compiler tests and type/lint/build pass. Remaining:
reference/recovery, persistence, named accessibility cases and final gate cleanup.

Database acceptance checkpoint, 2026-09-30: all 16 configuration consistency
tests pass. New file-backed SQLite tests close/reopen and JSON-export/import
computed sources, sensor ordering, user-timer definitions, floorplan/image data
and room/scene/climate/timer widget options. Helper coverage now includes all four
types and hidden true/false/omitted values. [PERSISTENCE-COVERAGE.md](PERSISTENCE-COVERAGE.md)
names each exact test and its limits. These are database checks; API recovery,
raw scene/routine definitions, option defaults and final accessibility remain open.

Scene-return checkpoint, 2026-09-30: 17 native browser checks pass on desktop
and phone. Both drafts survive related-page navigation; creating selects and
focuses the originating action without saving the routine. Missing actions and
deleted scenes have explicit recovery. Opaque script/condition/extension payloads
are preserved. All 236 UI tests and type/lint/build pass. Evidence is in the
comparison gallery and FIELD-COVERAGE.md; broader acceptance remains open.

## 7. Delivery and durable evidence

- [ ] Maintain a browseable screenshot comparison gallery with mockup, before
      and after views; note differences in fixture data and viewport framing.
- [ ] Update checklist statuses from verified evidence, not from code presence.
- [ ] Commit and push verified checkpoints regularly, including currently local
      everyday UI, timer UI, widget creation, calibration and acceptance assets.
- [ ] Finish with a concise delivery summary, commit references and any actual
      limitations. Mark the goal complete only when required work is finished.

## Already pushed

- `c28f0810`: settings tab feedback-loop fix, shared settings controls and
  fullscreen/kiosk layout restoration plus automatic reload guards.
- `dafcb2dc`: embedded floorplan preview reliability and initial visual audit.
- `e5d7983e`: generic server timers, mixed script/native actions, routine board,
  reviewed assistant action scope and disabled-device scene suppression.
- `57ec86b4`: everyday views, generic timer UI, visual widget designer, retained
  calibration editors and the shared control/widget dependencies.
- `d088d40d`: room climate composition, scoped controls and resilient embedded
  floorplan previews, with final desktop/phone comparisons.
- `26b97b75`: readable floorplan markers, native placement/drag verification,
  sensor ordering propagation and disabled-device re-enable regression.

Physical dashboard Chromium launch behavior has not been tested on the user's
actual device. Browser checks cover persisted layout, denied fullscreen restore,
kiosk detection, explicit exit and reload guards; do not claim hardware testing.

## Goal tracking

The user cleared the previous paused goal. A new goal covering this entire
queue is now active, with no requested token budget. Continue autonomously and
mark it complete only when the required work and acceptance gates are finished.
