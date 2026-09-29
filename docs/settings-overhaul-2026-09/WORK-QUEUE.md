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
- [ ] Review map device/group inspectors, shared previews, scope, related links,
      dismissal and fallback controls against the mockups.
- [ ] Check marker readability, brightness/off/attention states and rendering
      sharpness with representative floorplans.

Floorplan checkpoint: ten desktop and eleven phone checks cover native placement
and dragging, cancelled touch, zoomed coordinates, consecutive Undo, Save without
losing other devices or extension fields, and Fit after viewport resizing. Editor
labels are now 12 CSS pixels independently of backing resolution; markers use
actual light color, off/disabled styling and a brightness ring. SVG room previews
now also distinguish disabled lights and show attention badges. Map inspector and
representative state review remain open below. Evidence and screenshots:
`implementation-evidence/everyday/floorplan-placement-*`.

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

- [ ] Timers: refresh desktop UI evidence and finish all three mode/target editing
      flows. Server execution, restart and Helsinki migration API tests pass.
- [x] Calibration: finish bulk assignment, reset of raw numeric edits and required
      keyboard/phone acceptance without losing retained drafts or color modes.
- [ ] Charts: finish phone/touch checks and retain precise inspection, keyboard
      dismissal and readable empty/error states.

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
- `26b97b75`: readable floorplan markers, native placement/drag verification,
  sensor ordering propagation and disabled-device re-enable regression.

Physical dashboard Chromium launch behavior has not been tested on the user's
actual device. Browser checks cover persisted layout, denied fullscreen restore,
kiosk detection, explicit exit and reload guards; do not claim hardware testing.

## Goal tracking

The user cleared the previous paused goal. A new goal covering this entire
queue is now active, with no requested token budget. Continue autonomously and
mark it complete only when the required work and acceptance gates are finished.
