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

Raw-definition persistence checkpoint, 2026-09-30: 17 database consistency
tests pass. Scene and routine definitions now have file-backed restart and JSON
restore evidence, including unknown fields, explicit empty values, stable IDs,
script declarations and legacy defaults. No production database code changed.
Widget default mapping, broader recovery and accessibility remain open.

Empty-cycle checkpoint, 2026-09-30: 19 routine-selection checks pass per
desktop/phone size, including inline repair guidance, focused Save validation
without writing and Discard. All 237 UI tests, the server cycle-validation test
and type/lint/build pass. Screenshots are in the comparison gallery.


### Assistant review recovery — 2026-09-30

`ui/dev/assistant-review-recovery.mjs` passes 17 native checks at 1440/390 px.
The plan's map renderer now stays inside its preview container; it previously
covered controls because its positioned ancestor was missing. Historical cards
marked read-only cannot apply or change selection. Pending Apply/Discard locks
review controls, and failed requests remain visible inside the card. Partial
plan results distinguish applied, failed and excluded operations. Destructive
operations remain unselected by default; request payloads contain only reviewed
IDs. Related-page navigation closes the panel and retains results. Failed remote
discard still removes the local proposal.

The driver intercepts assistant responses on the marked local fixture, including
503 and 404 failures; those exact browser resource errors are expected in the
logs. This proves UI behavior, not provider/server execution. The screenshots
are scrolled to the reviewed controls; phone toasts temporarily cover the header.
All 237 UI tests and type/lint/build pass. Evidence: `everyday/assistant-review-*`.
Conversation/search read failures, streaming cancellation and broader navigation/
accessibility still need reconciliation; the whole assistant gate remains open.


### Assistant conversation recovery — 2026-09-30

13 native browser checks pass at 1440/390 px. Failed conversation lists,
thread details and entity searches now display errors with Retry rather than
empty results. Failed switches keep the earlier thread; unresolved selection
disables the composer until the user retries or returns. Sending from the history
list starts a new conversation without the previous thread ID/history. Previously
the state reset and request construction used different snapshots, allowing the
old ID to reach the request. The driver checks the actual submitted payload.

Evidence: `ui/dev/assistant-read-recovery.mjs` and `everyday/assistant-reads-*`.
503/404 resource errors are deliberately injected and expected in the logs.
Type/lint/build pass; this is browser response recovery, not a provider execution
test. Streaming/cancellation, reconnect and wider accessibility remain open.


### Assistant stream lifecycle — 2026-09-30

12 native checks pass at 1440/390 px. Status/deltas render while streaming;
Send is disabled and Cancel stays available. Browsing history and closing/reopening
the panel preserve the in-flight turn. Cancel closes a real local HTTP response,
restores input and does not append a false failure. Premature EOF now produces
a visible error; a subsequent request completes and updates usage normally.
No apply/configuration/device requests are issued. The driver runs a temporary
loopback SSE server and redirects only fixture chat requests to it.

Four new unit tests cover fragmented UTF-8/CRLF, missing terminal events, buffered
and pending cancellation, terminal event kinds, and malformed envelope handling.
A turn stops after its first terminal event; canceled/superseded callbacks are
ignored and readers are released. All 241 UI tests and type/lint/build pass.
The targeted Rust test `dropping_chat_response_cancels_pending_provider_stream`
passes: after bytes from a local provider reach the stream parser, dropping the
response body stops provider work with Cancelled. No external provider is used.
Evidence: `ui/dev/assistant-stream-review.mjs`, `everyday/assistant-stream-*`.
Remaining everyday gates include navigation/reconnect, widget option defaults,
overlay consistency and the named accessibility matrix.


### Live-state reconnect acceptance — 2026-09-30

16 native checks pass at 1440/390 px using a temporary loopback WebSocket server
with fixture state. Opening a socket no longer enables controls before fresh
state arrives. Revision gaps and foreground/network probes retain displayed
values and the unsaved configuration draft, suspend live commands, and request
one full resync. Duplicate patches are ignored; the next sequential patch applies.
Only a State reply clears the recovery timeout; malformed envelopes and unrelated
command acknowledgements do not. Failed probes and dropped sockets reconnect.
Startup/resync allows ten seconds for a full snapshot; a resumed connection keeps
the existing two-second probe timeout. Backoff resets only after fresh state.

The reconnect banner now appears on desktop as well as phone and identifies
displayed values as potentially out of date. Socket replacement releases pending
command promises. An acknowledged command works after reconnect; a lost
acknowledgement reports uncertainty and is never automatically replayed. No
configuration writes occur and the display-name draft remains intact.
All 241 UI tests and type/lint/build pass. Evidence: `ui/dev/reconnect-review.mjs`
and `everyday/reconnect-*`. These are real local socket interruptions with
synthetic state, not household network/hardware tests. Navigation/search, widget
option defaults, overlay consistency and wider accessibility remain open.


### Navigation and search recovery — 2026-09-30

15 native browser checks pass at 1440/390 px. Search now considers the full
catalog while keeping the idle list compact; previously each category was
truncated to 40 entries before filtering. Computed sources have searchable
identity and canonical detail links. Recent destinations appear once. Failed
catalogs identify incomplete results and offer Retry without clearing the query;
successful retry returns keyboard focus to the search field. Live-state recovery
also labels potentially stale entity results. Close fits within the search row.

Ctrl+K, Enter, Escape and browser Back preserve an unsaved room draft. Escape
returns focus to the edited field; navigating to another page does not restore
focus to an obsolete trigger. The driver intercepts a 65-routine catalog and
503 failures on the marked local fixture, performs no writes and explicitly
discards its draft. Evidence: `ui/dev/navigation-search-review.mjs` and
`implementation-evidence/everyday/navigation-search-*`. Captures were visually
reviewed on desktop and phone. Type/lint/build pass (the existing bundle-size
warning remains). These checks do not close the wider viewport/accessibility
matrix, all widget defaults, remaining field coverage or final reconciliation.


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

### Backup recovery and integration rollback — 2026-09-30

26 native browser checks pass at 1440/390 px in
`ui/dev/backup-recovery-review.mjs`. A 205-addition review renders 80 entries
at a time and filtering finds entries beyond the current page. Review completion
and confirmation cancellation restore useful keyboard focus. Invalid/oversized
replacement files clear the previous candidate and cannot restore it. Pending
file reads show progress; superseded failures, Discard and navigation cannot
publish an old read. Returning from an interrupted read explains how to resume.
Aborted reviews cannot repopulate discarded drafts.

Failed reviews retain the file for explicit retry. Pending apply locks file
replacement, Discard and resubmission; an apply failure retains the file and
requires a fresh review. Export failures appear beside Download and can be
retried independently. Export credentials are locked while preparing a download.
The marked local fixture receives only read-only preview POSTs; apply/export
responses are intercepted, and its configuration is compared unchanged afterward.
Injected review/apply/export 503 responses are expected in the probe logs.

The lifecycle audit found that failed integration replacement could preserve the
old handle while invalidating its event epoch. Reload now reserves replacement
epochs during construction, cuts over after all constructors succeed, and
restores the previous shared epoch map before restarting old instances on failure.
The existing invalid-configuration and stop-failure tests now verify old event
acceptance through staged and original integration handles, and rejection of the
failed replacement epoch. Six reload-filtered Rust tests pass; the successful
cutover/stale-event regression and two backup review/API tests also pass.

Type/lint/build pass. Reviewed captures and logs are in
`implementation-evidence/everyday/backup-recovery-*`. This covers browser
recovery and the named runtime lifecycle contracts; it does not claim an HTTP
restore plus real-database restart test across every external integration. Nested
legacy/unknown-field reconciliation, creation/deletion races and the wider
accessibility matrix remain open.

### Viewport, keyboard and contrast checkpoint — 2026-09-30

Routine, scene and widget creation pages now keep Save/Create above a software
keyboard, follow viewport panning, and restore full height after dismissal.
Pinch zoom is excluded from keyboard detection. Phone buttons have at least
44-pixel targets; text entry uses 16-pixel type, and long detail titles wrap.
Search keeps its input and footer visible while the result list scrolls.
Routine lane headings and destructive colors have separate light/dark values.

The browser driver `ui/dev/settings-viewport-review.mjs` verifies native Tab,
typing and Discard, visible actions, reduced motion, both system themes,
page overflow and no configuration writes. Passing width matrix:

| CSS viewport | Checks | Additional coverage |
| --- | ---: | --- |
| 360 × 800 | 37 | Phone keyboard/pan/dismiss/pinch model and search |
| 390 × 844 | 37 | Same; final heading and error contrast |
| 430 × 932 | 37 | Phone keyboard/pan/dismiss/pinch model and search |
| 1280 × 900 | 18 | Desktop layout and headings |
| 1440 × 1080 | 18 | Desktop; final heading and error contrast |
| 640 × 450, DPR 2 | 21 | 200% equivalent reflow of 1280 × 900 |
| 720 × 540, DPR 2 | 21 | 200% equivalent reflow of 1440 × 1080 |

The final color pass was rerun at 390/1440 and both reflow sizes. Heading contrast
is at least 4.94:1 in light mode and 7.87:1 in dark mode; the routine error is
4.89:1 and 5.78:1. These are measured text/background pairs, not a whole-app
accessibility certification. Computed oklab backgrounds are converted through
Canvas before compositing. Other width logs precede the final error color change.

Keyboard geometry uses injected VisualViewport values; zoom uses CSS dimensions
and DPR emulation, not the browser toolbar. Physical mobile keyboards and the
Linux kiosk remain untested. Entity-picker/navigation overlays and remaining
page families still need their own keyboard/reflow acceptance. The local fixture
now explicitly rejects schedule preview with 501, instead of accidentally
handling it as a routine creation; those expected errors appear in the logs.

Type checking, lint, production build and all 242 UI tests pass. The build retains
the existing large-chunk warning. Evidence: `implementation-evidence/everyday/settings-viewport-*`;
representative captures appear in the comparison gallery. Wider schema,
restore/restart, recovery and accessibility gates remain open.

### Shared selection and category dialogs — 2026-09-30

Entity pickers and phone settings navigation now respect the available visual
viewport instead of overriding it with 85dvh. Their real dialog triggers restore
keyboard focus after closing. Picker headings, search and Cancel/Done stay fixed
while the member list scrolls; category headings and Close likewise stay visible
when the last link receives focus. Phone dialog text inputs now have 44-pixel
minimum height, consistent with the other settings fields.

`ui/dev/settings-picker-review.mjs` uses a read-only intercepted catalog with 65
additional groups, a cyclic candidate and an unavailable selected reference.
It checks staged multi-selection, Cancel/Escape retention, Done versus Save,
Discard, search beyond the first 40 entries, Show more, disabled cyclic choices,
removable missing references, focus return, keyboard geometry and category-list
scrolling. No configuration writes occur. Keyboard height/panning is simulated;
this is not physical keyboard evidence. The 720 × 540 run checks a short viewport,
not browser zoom. Logs and screenshots are in
`implementation-evidence/everyday/settings-picker-*` and the comparison gallery.

Type checking, lint and production build pass, with the existing large-chunk
warning. The wider editor collection/persistence and recovery gates remain open.

Passing runs: 1440 px: 17 checks; 390 px: 23 checks; 360 px: 23 checks; 720 px: 21 checks.

### Room/group collections and repair — 2026-09-30

27 native browser checks pass at 1440, 390 and 360 px in
`ui/dev/group-collections-review.mjs`. Temporary local records cover:

- Missing devices/groups remain visible and survive an unrelated name save.
- Replacing a missing device, then saving/reloading empty, single and multiple
  direct-device/linked-group selections produces exact arrays. Each Save sends
  expected state and omits derived `device_keys`; Done alone does not write.
- A deleted group cannot be recreated by a stale save; the error retains the
  draft. A concurrent creation using the same ID leaves the existing group
  intact and retains the new draft, which can be saved under another ID.
- Missing-member actions and section content fit the phone viewport. The
  screenshot audit found hidden horizontal overflow inside sections; sections
  now use a shrinkable grid track, headings can shrink, and missing-device repair
  controls wrap beneath a readable identifier. The checks measure sections and
  controls, in addition to the document viewport.

The fixture now rejects duplicate group creation, matching the real API. Expected
404/409 responses are recorded in the browser logs. All temporary rows are
removed; no household configuration changes occur.

Database verification exposed a mismatch: the API allowed missing linked groups,
but a child foreign key rejected their persistence and silently removed incoming
links when a child was deleted. Migration
`m20260930000000_repairable_group_links` keeps the parent ownership constraint
and uniqueness while allowing unresolved child IDs. Its table rebuild is
transactional, preserves order/data/indexes, and works on SQLite and PostgreSQL.
Downgrade with unresolved children fails without deleting them; repairing those
references permits downgrade. Existing valid rows and repeated upgrades are
covered by the migration tests.

The raw-automation database reopen/JSON-restore regression now also includes
empty/single/multiple groups, hidden true/false, ordered memberships and missing
device/group references. The server API regression checks that stale updates
cannot recreate a deleted group; existing conflict/duplicate and cycle tests
remain included. Evidence lives under
`implementation-evidence/collections/group-*`, with visual captures in the
comparison gallery. Broader recovery and accessibility gates remain open.

Verification: three API tests, both SQLite/PostgreSQL migration tests, and all
17 database consistency tests pass. Type checking and production build pass.
Lint exits successfully with the existing backup-effect cleanup warning; the
build retains its large-chunk warning. Shared routine/scene/widget viewport
checks pass at 390/1440 px after the section-grid correction.

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

The routine editor reports failed device/group/scene/helper/source catalog reads
with an explicit Retry, retaining the draft and saved references. Shared searchable
pickers reset their query on opening; phone selection and Escape return focus to
the trigger. Required condition sources no longer offer a Clear action that could
not change their value.

Twenty checks pass at each 1440/390 px viewport. The journey retries a failed scene
catalog while retaining an edited name, saves/reloads an unchanged unavailable
definition, discards repairs, then repairs helper/scene/fallback/device/group/routine
references and saves/reloads the exact result. It preserves mapping extensions,
target extensions, false values and structured values belonging to missing helpers.
No repair is written before Save. Phone routine selection also passes its existing
19 checks after the shared picker changes.

Evidence: [reference recovery captures](implementation-evidence/comparison/index.html#routine-reference)
and logs under `implementation-evidence/collections/routine-reference-*`;
repeatable driver: `ui/dev/routine-reference-review.mjs`. Expected intercepted
503 responses appear in the logs; no page exceptions occur. These checks use
and remove temporary isolated fixture records, with no household edits or routine
execution. Type checking, lint and production build pass; existing backup-effect
lint and large-chunk build warnings remain. The broader schema, persistence,
recovery and accessibility gates remain open.

### Integration repair and profile checkpoint — 2026-09-30

Dummy-device malformed collection/state/color repair passes 11 browser checks
at each 1440/390 px; invalid colors now render preserved repair controls instead
of crashing the preview. ESPHome passes 14 checks per size for all five profile
overrides, retained switching/navigation, default reset and endpoint validation.
The multi-schedule legacy conversion database test passes with exact persisted
definition and restored schedule assertions. See
[the field ledger](FIELD-COVERAGE.md#integration-repair-esphome-and-legacy-conversion--2026-09-30)
for defaults, evidence and limitations. 246 UI tests and type/lint/build pass.
Broader field/recovery/accessibility gates remain open.

### Computed-source health before first output — 2026-09-30

A source that failed before its first successful computation previously had no
output/device entry, so its error could disappear from the health summary. The
source registry now retains its latest failure independently of its last good
output. Unchanged definitions retain the error; success, a new revision or removal
clears it. Runtime failures remain observations, not database configuration.

The shared health evaluator includes configured source identities without
inventing output devices, values or fresh-report timestamps. Warmup and disabled
sources keep their existing suppression rules. After startup, initial failures
appear under their canonical computed device key and contribute once to attention.
Diagnostics uses a source entity and links directly to its editor; related logs
still use the canonical device key. The overview directs source attention to the
source editor and its View issues link includes sources with no device row.

Source list/detail pages show runtime errors. A retained last published value is
identified when an issue is present; a source with no value continues to say so.
Failed health reads offer Retry and preserve the configuration draft. Eleven
browser checks at each 1440/390 px verify overview/editor/diagnostics/log links,
no invented output, retained drafts, explicit Retry, catalog error visibility and
clearing old error evidence. The driver uses an owned fixture source and intercepts
health/diagnostics responses; its expected 503s do not represent a live source run.

Seven health tests pass, including unchanged sensor receipts, retained messages,
monotonic deadlines, startup/re-enable/reconnect grace, stale epoch rejection,
Ignore/offline semantics and the new first-failure lifecycle. Seven diagnostics
tests pass, including aliases and missing-reference behavior. The registry's
last-good-output test now also covers initial failure retention, unchanged/revised
loads, success and deletion. Binding export tests pass and the UI binding was
regenerated. Type checking, lint and production build pass with the existing
backup-effect, large-chunk and Rust future-compatibility warnings.

Evidence: `ui/dev/source-health-review.mjs`,
`implementation-evidence/everyday/source-health-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#source-health).
No household configuration was changed. Live MQTT transport/discovery coverage
and the broader recovery/accessibility gates remain open.

The actual Warp health/diagnostics API regression also passes: a first-failing
source plus a scene referencing its unavailable output contributes only one
canonical source key to attention. Diagnostics retain both explanations and
return the source entity ID and device-key log reference. This closes the
previous API deduplication gap; it does not claim a live MQTT session.

### Calibration catalog and reference recovery — 2026-09-30

Color, brightness and assignment editors now share an initial/cached catalog
failure status with Retry. A failed refresh keeps the mounted editor and its
numeric draft; failures in the device's legacy calibration summary no longer
hide the independent atomic editor. Reference selection uses the shared searchable
picker and excludes disabled, read-only and incompatible lights. Missing selected
IDs remain visible. Losing a reference stops its preview, keeps matching points
and offers replacement. Color's stopped status updates after acknowledged cleanup
and no longer incorrectly says an adjustment is being sent.

Fifteen browser checks pass at each 390/1440 px in
`ui/dev/calibration-recovery-review.mjs`. They cover initial failure/retry, cached
failure/retry with an edited curve, capability filtering, disappeared references,
retained numeric edits, blocked preview/resume and replacement. The driver checks
the isolated fixture's session store after cleanup and observes no configuration
writes. Expected 503s are injected read failures; there are no page exceptions.
Screenshots were inspected at both sizes. Evidence:
`implementation-evidence/everyday/calibration-recovery-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#calibration-recovery).

The existing color Save/Discard lifecycle passes all ten phone checks again;
brightness passes its four native keyboard/200% enlargement checks. Type checking,
lint and production build pass. Lint retains the existing backup-effect cleanup
warning; build retains its existing chunk-size warning.

Earlier calibration evidence is consolidated in IMPLEMENTATION.md. This closes
the named catalog/capability/reference cases; broader cross-family recovery,
accessibility and real-device acceptance remain open. No household configuration
or physical light was changed.

### MQTT range and collection repair — 2026-09-30

Malformed brightness/transition ranges previously rendered empty numeric controls
or hid extra endpoints. They now display their original JSON and require explicit
replacement or Use default. Replacement previews its endpoints in a confirmation
and changes only the draft. Normal endpoint controls retain unfinished numeric
input, identify the invalid field, survive navigation and block Save until valid.
Resetting the range also clears its staged numeric input. Schema defaults and
descriptions now match the generic MQTT runtime: both ranges default to `[0, 1]`;
transition endpoints represent zero and one second, not a maximum duration.

Sixteen native browser checks pass at both 390/1440 px. They cover malformed
object/oversized ranges and malformed sensor/disabled-device collections, Cancel,
Discard, explicit repair, validation focus, retained navigation, exact Save/reload,
default removal, exponent input and unchanged extensions/false/null/secrets. No
page exceptions or unexpected creates occur. The temporary integrations are
disabled in an isolated fixture and removed afterward. Screenshots were inspected.
All 246 UI tests, type/lint/build and the targeted Rust MQTT schema test pass.
Existing backup-effect, bundle-size and Rust future-compatibility warnings remain.
Evidence: `ui/dev/mqtt-repair-review.mjs`,
`implementation-evidence/collections/mqtt-repair-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#mqtt-repair).

The reference follow-up below resolves the unsafe computed-source scene-target
inspection found during this checkpoint. Helper/source visibility and complete
reference reconciliation, restore/restart, transport,
activity and final cross-family accessibility/cleanup gates remain open.

### Source and helper reference audit — 2026-09-30

Source usage inspection now tolerates null, primitive and unknown scene targets;
group/device maps are inspected separately so equal keys cannot overwrite each
other. Source details link to direct scenes, room membership and declared routine
source/device dependencies, including saved aliases and script device declarations.
Each catalog has independent error/loading/Retry states. The page explicitly
allows for additional legacy, script-body and indirect dependencies.

Helper usage now recognizes dynamic scene selection (`helper_enum`), which the
previous recursive lookup missed. The shared routine reader follows declared
condition/action/declaration fields, avoiding false positives in JSON operands,
helper values, script text and extensions. Four unit tests cover nested conditions,
branches, timer captures, scene cycles, rollout origins, malformed values and
canonical/alias identity. All 250 UI tests, type/lint/build pass with the existing
backup-effect and bundle-size warnings.

Eleven native browser checks pass at both 390/1440 px: malformed scene inspection,
alias and canonical destinations, selection-helper usage, excluded JSON lookalikes,
independent failed-reference Retry, retained name drafts and related
navigation without writes or page exceptions. Expected 503s are injected catalog
failures. Screenshots were reviewed. Evidence: `ui/dev/config-usage-review.mjs`,
`implementation-evidence/collections/config-usage-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#config-usage).
The test owns its temporary source/helper and intercepts reference catalogs;
no household configuration or automation execution is involved.

Remaining: helper visibility and widget-consumer links, broader reference and
recovery reconciliation, full restore/restart, MQTT transport/discovery, activity,
accessibility and superseded-surface cleanup. This checkpoint does not claim a
complete dependency index or automatic script-body analysis.

### Helper visibility and widget consumers — 2026-09-30

Helper details now link to matching Mode / helper widgets across every dashboard
layout, including nested and legacy flat option storage. Per-layout queries reuse
the widget editor caches, retain known references on errors and offer independent
Retry. A failed layout cannot hide a successful layout's references.

Hidden helpers remain editable in settings and usable by existing widgets. New
widget choices omit hidden helpers; the currently selected hidden helper remains
identifiable with an explanation. Hidden state changes still require Save, and
Discard restores the saved state. The widget helper selector now reports catalog
failures and supports Retry while keeping the selected helper and widget draft.

Fifteen browser checks pass at each 390/1440 px, covering partial catalog failure,
both option representations, direct widget links, draft retention, hidden/unhidden
saves, Discard, existing/new selection rules, failed helper reads and Retry. Only
the two explicit helper saves write configuration; no preview/live commands occur.
Expected 503s are injected fixture failures; there are no page exceptions.
The database helper-definition/durable-value round-trip test passes, including
hidden true/false/omitted representations. Type/lint/build pass with the existing
backup-effect, bundle-size and Rust future-compatibility warnings.

Evidence: `ui/dev/helper-visibility-review.mjs`,
`implementation-evidence/collections/helper-visibility-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#helper-visibility).
Screenshots were inspected. Temporary fixture helpers/widgets/layout are deleted
after each run; household configuration is untouched.

The control audit also found active native dropdowns in routine activity, list
filters, floorplan settings, dashboard editing preferences and color/preview
controls. Resolve these in the shared-control/cleanup pass, distinguishing them
from unreferenced legacy editors. Activity trace, restore/restart, MQTT transport,
broader recovery/accessibility and final reconciliation remain open.

### Routine activity references and outcomes — 2026-09-30

Activity uses the shared selectors and a searchable routine filter, including
literal routine IDs named `all`. Accepted empty plans, fully suppressed plans,
partial dispatch, rejection, errors and unknown conditions remain distinct.
Blocked attempts never expose a previous run as their own evidence.

Recorded entity links show current friendly names, preserve exact destinations
and fall back to recorded IDs when a catalog fails or an entity was removed.
Name lookup failures have Retry and never hide recorded activity. A changed
definition revision is explained before navigation; removed historical nodes
open the current editor with its existing missing-node explanation.

Twenty native browser checks pass at each 390/1440 px, including all seven
unknown-condition reasons, URL filters, picker focus, related-link keyboard
order and 200% CSS zoom. The existing 17-check activity journey also passes at
both sizes. All 251 UI tests, type/lint/build and 11 server history tests pass;
the existing backup-effect, bundle-size and Rust future-compatibility warnings
remain. Expected 503s are injected name-catalog failures. No page exceptions,
configuration writes or household commands occurred. Screenshots were inspected.

Evidence: `ui/dev/activity-traces-review.mjs`,
`implementation-evidence/collections/activity-*` and the
[comparison gallery](implementation-evidence/comparison/index.html#activity-traces).
Browser traces are synthetic retained records; real runtime suppression coverage
and broader accessibility remain separate open acceptance items.

### Shared collection controls — 2026-09-30

Device and routine filters, floorplan selection, dashboard editor preferences,
device sensor controls and preserved sensor-source repair now use shared
selectors. Integration, room and floorplan lists are searchable. Clearing one
filter retains the others; unavailable entity IDs and empty/unknown sensor
sources remain visible until explicitly changed. Dashboard preference values
retain their original numeric/string types and require Save.

Seventeen native keyboard browser checks pass at each 390/1440 px, including
exact URL state, selection clearing, unavailable floorplans, retained preferences,
Discard and sensor source repair. Type checking, lint and build pass with the
existing backup-effect and bundle-size warnings. No configuration writes or
page exceptions occur. The expected 404 is the intentionally unavailable
floorplan. Screenshots were inspected; preference captures show saved defaults.

Evidence: `ui/dev/shared-list-controls-review.mjs`,
`implementation-evidence/collections/shared-list-controls-*`,
`shared-controls-{tsc,lint,build}.log` and the
[comparison gallery](implementation-evidence/comparison/index.html#shared-list-controls).
Remaining shared-control work includes active color/preview controls and the
floorplan placement tool. Unreferenced legacy editors still need removal or
separation from reused read-only summary helpers. Other acceptance gates remain
open.

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
