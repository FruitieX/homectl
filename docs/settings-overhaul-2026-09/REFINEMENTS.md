# UI overhaul refinements

Status: active. User requests recorded 2026-09-29. This supplements
[EVERYDAY-IMPLEMENTATION.md](EVERYDAY-IMPLEMENTATION.md); it does not replace
the remaining implementation and acceptance work there.

## Sensor configuration

- [ ] Reorder the sensor catalog, sensor groups, and members within each group.
      Keep ordering in the retained page draft until Save; preserve IDs and
      membership. Dashboard readings should respect configured ordering.
- [ ] Align Widget sources rows and separators with the other settings lists.
- [ ] Give autocomplete results space between their rounded hover background
      and the edges of the list. Apply consistently to shared selectors.

## Disabled devices

- [ ] Stop repeated “Could not find device scene state” warnings for disabled
      devices. Disabled devices deliberately retain their saved assignments.
- [ ] Do not flag a disabled device on the settings overview merely because its
      assigned scene has no resolved state. Keep real errors on enabled devices.
- [ ] Verify disable and re-enable behavior without changing household devices.

## Floorplan

- [ ] Fit the entire drawing inside the canvas viewport, considering both
      width and height. Allow zooming out further. Avoid unnecessary scaling
      blur; maintain accurate placement coordinates at every zoom level.
- [ ] Replace the long chip lists used for device placement with a compact,
      searchable list that distinguishes placed and unplaced devices and keeps
      the selected placement clear. Preserve moving, removal and undo.
- [ ] Use the shared visual language for light markers: color dot with a ring
      indicating brightness, with distinct off/disabled/attention states.
- [ ] Refine map device/group inspectors on desktop and phone. Preserve control
      scope, related links, accessible dismissal and useful fallback controls.

## Routine editor

Design reference: `index.html?direction=compact&detail=useful&theme=light#complex-routine`
in this directory, especially its desktop composition.

- [ ] Restore the reference's clear section hierarchy, titles, icons, colors
      and readable desktop layout, while keeping complex branches available.
- [ ] Make the dotted node-editor background clearly visible.
- [ ] Show Move up/down icon buttons immediately before the context menu.
      Duplicate/delete may remain in the menu. Support keyboard and touch.
- [ ] Align form controls vertically and use consistent heights; explanatory
      text must not push adjacent controls onto different baselines.
- [ ] Add sandboxed scripts as actions within the ordered Then flow, including
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

- [ ] Trace fullscreen preference persistence, startup/reload restoration,
      browser fullscreen events and the scheduled reload path.
- [ ] Fix application-controlled state loss or restoration races. Distinguish
      browser fullscreen restrictions from the app's own kiosk layout; do not
      falsely report that browser fullscreen was restored.
- [ ] Verify reload behavior and document any browser-dependent limitations.

## App & system regression

- [ ] Fix `/config/settings` repeatedly alternating tabs after selecting
      Assistant, another tab, then Assistant again. Preserve keyboard navigation,
      retained drafts and useful scroll/focus restoration without activating
      an old tab while restoring focus.
- [ ] Replace native-looking switches/selects/radio styling with the shared
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
markers. These remain under verification. Script action runtime support is in
progress; no completed acceptance is claimed yet.
