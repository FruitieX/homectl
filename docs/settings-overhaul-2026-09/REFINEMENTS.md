# UI overhaul refinements

Status: active. User requests recorded 2026-09-29. This supplements
[EVERYDAY-IMPLEMENTATION.md](EVERYDAY-IMPLEMENTATION.md); it does not replace
the remaining implementation and acceptance work there.

## Screenshot audit and widget creation (additional feedback)

- [ ] Compare current desktop and phone screenshots against approved mockups;
      record omissions and corrections in [VISUAL-AUDIT.md](VISUAL-AUDIT.md).
- [x] Prioritize the Study 04 complex routine. Preserve its three-column
      desktop board, compact readable nodes, and connected vertical phone flow.
- [x] Verify embedded floorplan previews on rooms list, room details and
      dashboard room cards, including failure/recovery and saved map edits.
- [x] Redesign New widget with a visual type gallery, layout presets/visual
      placement, and a preview of the configured widget before Create.

## Sensor configuration

- [x] Reorder the sensor catalog, sensor groups, and members within each group.
      Keep ordering in the retained page draft until Save; preserve IDs and
      membership. Dashboard readings should respect configured ordering.
- [x] Align Widget sources rows and separators with the other settings lists.
- [x] Give autocomplete results space between their rounded hover background
      and the edges of the list. Apply consistently to shared selectors.

## Disabled devices

- [x] Stop repeated “Could not find device scene state” warnings for disabled
      devices. Disabled devices deliberately retain their saved assignments.
- [x] Do not flag a disabled device on the settings overview merely because its
      assigned scene has no resolved state. Keep real errors on enabled devices.
- [x] Verify disable and re-enable behavior without changing household devices.

## Floorplan

- [x] Fit the entire drawing inside the canvas viewport, considering both
      width and height. Allow zooming out further. Avoid unnecessary scaling
      blur; maintain accurate placement coordinates at every zoom level.
- [x] Replace the long chip lists used for device placement with a compact,
      searchable list that distinguishes placed and unplaced devices and keeps
      the selected placement clear. Preserve moving, removal and undo.
- [ ] Use the shared visual language for light markers: color dot with a ring
      indicating brightness, with distinct off/disabled/attention states.
- [ ] Refine map device/group inspectors on desktop and phone. Preserve control
      scope, related links, accessible dismissal and useful fallback controls.

## Routine editor

Design reference: `index.html?direction=compact&detail=useful&theme=light#complex-routine`
in this directory, especially its desktop composition.

- [x] Restore the reference's clear section hierarchy, titles, icons, colors
      and readable desktop layout, while keeping complex branches available.
- [x] Make the dotted node-editor background clearly visible.
- [x] Show Move up/down icon buttons immediately before the context menu.
      Duplicate/delete may remain in the menu. Support keyboard and touch.
- [x] Align form controls vertically and use consistent heights; explanatory
      text must not push adjacent controls onto different baselines.
- [x] Add sandboxed scripts as actions within the ordered Then flow, including
      branches. Do not require replacing the whole native program. Preserve
      existing script routines, sandbox limits, validation, runtime outcomes,
      action order and draft/export compatibility.

## Dashboard and shared surfaces

- [ ] Continue refining existing widgets and device/group overlays alongside
      the newly added widgets. Use consistent chrome, controls, spacing,
      loading/error states and color/brightness previews.

## Fullscreen reload regression

Reported on a Linux home automation dashboard: after the automatic reload around
04:00, the page sometimes forgets fullscreen or fails to restore it properly.
The user confirmed Chromium with kiosk launch options plus homectl's expand
button. Treat the browser window's kiosk mode and DOM fullscreen separately.

- [x] Trace fullscreen preference persistence, startup/reload restoration,
      browser fullscreen events and the scheduled reload path.
- [x] Fix application-controlled state loss or restoration races. Distinguish
      browser fullscreen restrictions from the app's own kiosk layout; do not
      falsely report that browser fullscreen was restored.
- [x] Verify reload behavior and document any browser-dependent limitations.

## App & system regression

- [x] Fix `/config/settings` repeatedly alternating tabs after selecting
      Assistant, another tab, then Assistant again. Preserve keyboard navigation,
      retained drafts and useful scroll/focus restoration without activating
      an old tab while restoring focus.
- [x] Replace native-looking switches/selects/radio styling with the shared
      Compact controls, retaining labels and keyboard access.

## Delivery

- [ ] Verify affected desktop/phone interactions and persistence, plus focused
      backend regressions and UI type/lint/build gates.
- [ ] Record durable evidence and update both implementation ledgers.
- [ ] Commit and push verified checkpoints regularly (explicitly requested).

## Progress notes

Initial edits add retained ordering controls, separator/picker padding fixes,
disabled-device scene checks, routine layout and visible ordering controls,
two-dimensional canvas fitting, a placement list, and brightness-ring map
markers. Remaining verification is tracked in WORK-QUEUE.md. The routine and
widget-creation gates above are now verified, including mixed-script execution,
local code editing, nested conditions, keyboard previews and explicit creation.
The comparison gallery contains refreshed routine and creation-state captures.

### Settings tabs and fullscreen checkpoint

- Fixed the tab loop's focus-restoration feedback: tab navigation controls are
  no longer recorded or restored as editor focus targets. Native mouse-input
  journeys pass at 1440px and 390px, including Assistant → each other tab →
  Assistant, sampled over 30 frames per sequence.
- App & system now uses shared switches, checkboxes and select menus, with
  theme-colored radio choices. Save/Discard contracts are preserved.
- Fullscreen layout preference loads synchronously. Browser fullscreen is
  tracked separately, failed requests are caught, and exiting the app layout
  works even if browser fullscreen was already lost. Existing window fullscreen
  detected via `display-mode` does not request a second DOM fullscreen layer.
- At 04:00 fullscreen displays refetch queries without navigating away. Automatic
  WebSocket reload commands also respect fullscreen and unsaved drafts. Manual
  browser reload remains available. The daily timer now has stable dependencies
  and chooses today's 04:00 when started before that time.
- On browsers that deny restoring fullscreen after a manual reload, the saved
  layout stays active and a Restore fullscreen button appears on activity.
  [The Fullscreen API requires transient user activation](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen),
  so unattended document navigation cannot reliably restore DOM fullscreen.
- Seven browser checks pass for reload persistence, denied restoration, exit,
  automatic reload/draft guards, daily scheduling and simulated existing kiosk
  fullscreen. This does not yet verify the physical Linux dashboard's launch
  configuration. UI type check, lint and production build pass (existing large
  bundle warning). Evidence: `implementation-evidence/refinements/`.

Floorplan/sensor checkpoint: native placement and dragging, Fit/resize, keyboard
sensor ordering and downstream widget/group order are verified at both sizes.
Editor markers and labels now remain readable independently of backing resolution.
Disabled invalidation/re-enable and diagnostic suppression regressions pass.
Evidence is recorded in WORK-QUEUE.md and `implementation-evidence/everyday/`.

Room checkpoint, 2026-09-30: embedded previews are verified in all three locations,
including nested membership, saved placement changes and exhausted-read recovery.
Current screenshots are compared with Study 05. Room conditions use actual matched
source samples and dated history; missing humidity remains empty. Wide floorplans
now also fit on phones without expanding the surrounding grid column. Attention
shows its count and first issue, with the remaining scoped issues expandable.
