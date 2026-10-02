# UI overhaul — current completion record

Updated 2026-10-02. This is the current status page for the approved Compact
overhaul and its follow-ups. The dated implementation/audit files retain their
original evidence; their unchecked historical gates are not the current work queue.

## Delivered

| Area                         | Current behavior                                                                                                                                                                                              | Evidence and contracts                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings foundation          | Shared navigation, icons, sections and controls; direct editing; retained drafts and explicit save/discard; shared advanced-details preference; related-entity links.                                         | [Interaction system](INTERACTION-SYSTEM.md), [implementation ledger](IMPLEMENTATION.md), [navigation](UNIFIED-NAVIGATION.md)                                        |
| Rooms, scenes and routines   | Controls-first rooms with embedded floorplan previews; desktop scene rows/mobile cards; guided three-lane routine flows with native/script steps, branches, timers and reference repair.                      | [Visual comparisons](VISUAL-AUDIT.md), [field coverage](FIELD-COVERAGE.md), [everyday delivery](EVERYDAY-IMPLEMENTATION.md)                                         |
| Dashboard and widgets        | Existing widget system retained; room/scene/climate widgets, visual widget creation/preview and refreshed widget bodies/details. Generic timers run on the server with Helsinki defaults.                     | [Widget option contracts](WIDGET-OPTIONS.md), [everyday delivery](EVERYDAY-IMPLEMENTATION.md)                                                                       |
| Floorplan and editor         | Fixed editor canvas with Devices/Room areas/Walls tools, fit/pan/zoom, grid snapping and painting shortcuts; readable group labels; shared light/sensor quick controls, selection and restore-scene behavior. | [Editor delivery](FLOORPLAN-EDITOR-IMPLEMENTATION.md), [radial controls and sensor history](CHARTS-RADIAL-SENSOR-HISTORY.md), [selection](QUICK-ADJUST-GESTURES.md) |
| Charts and touch             | Chart taps open widget details; drags inspect values; floating readings clear on release. Pinch-to-one-finger handoff retains the floorplan transform.                                                        | [Chart gestures](CHART-GESTURES.md), [pinch handoff](FLOORPLAN-PINCH-HANDOFF.md)                                                                                    |
| Health, sensors and recovery | Attention summaries, disabled-device suppression, reporting policy defaults/overrides, sensor reordering and bounded persistent value-change history; reconnect/resync and reviewed backups.                  | [Sensor/health follow-ups](CHARTS-RADIAL-SENSOR-HISTORY.md), [historical recovery evidence](ACCEPTANCE-AUDIT.md), [persistence](PERSISTENCE-COVERAGE.md)            |
| Assistant                    | Unified reviewed plans/actions, larger floorplan previews, scoped entity attachments, streaming/cancellation and current reusable-automation authoring reference.                                             | [Assistant floorplan fix](ASSISTANT-FLOORPLAN-PREVIEW.md), [automation authoring](../javascript-reuse.md#configuration-assistant)                                   |
| Reusable automation          | Visual/JavaScript action and condition blocks, typed shared functions and computed helpers, usage links and read-only draft previews.                                                                         | [JavaScript contracts](../javascript-reuse.md), [implementation and worker verification](../javascript-reuse-implementation.md)                                     |

## Finishing pass

The user selected these final items on 2026-10-02:

- Readable action plans, condition results/traces and computed values. Routine
  what-if and reusable previews share the same result components; JSON is a
  collapsed advanced detail. Previous results are marked stale after edits,
  and changing/leaving a draft cancels obsolete requests.
- A short production-bundle browser suite in CI at 1440 × 1000 and 390 × 844.
  It covers retained edits/Discard, preview values/errors/links, chart taps and
  inspection in dialogs, pinch-to-pan handoff, and live/editor floorplans. Screenshots and logs are
  uploaded as the `ui-browser-smoke` artifact.
- This completion record and reconciliation of historical trackers. See
  [finishing-pass verification](FINISHING-PASS.md).

The approved finishing pass has no remaining implementation items. The user
reports ongoing testing and considers configured-assistant quality and
physical-device reliability to be in good shape; this pass does not repeat
those evaluations or manufacture new implementation requirements from old
audit checklists.

## Current interaction rules

- Settings opens its expandable navigation panel; leaving settings closes it.
  There is no pinned-panel state. Mobile floorplan tabs stay in the AppBar.
- Holding a light opens quick controls; holding a selected light controls the
  writable selection. Use Select in quick controls/the side panel, Ctrl-click
  on desktop, or hold a room to enter selection. Deselecting the final device
  exits selection; Done closes the panel and clears selection.
- The initial held pointer controls color only after leaving the neutral
  power hub. Brightness requires a separate press on the outer ring. Values
  coalesce through acknowledged live commands. Holding power or tapping
  outside dismisses the popover. The A/B/C continuous switching studies remain
  unselected prototype alternatives, not unfinished production features.
- Applicable Restore scene controls use the interactive transition and clear
  pause state through the shared command path. Scene activation also resumes
  affected devices. Sensor quick controls simulate supported sensor events.
- Sensor history retains 100 changes per source/field; unchanged reports update
  reporting timestamps without inventing duplicate changes.

## Verification limits retained

- The browser suite uses marked local fixtures and synthetic weather/price
  data. Its preview responses exercise presentation, not a JavaScript engine.
  Real worker execution, validation and absence of dispatch have Rust API tests.
- Browser emulation is not physical touch, software-keyboard or overnight kiosk
  certification. The user performs continuing real-device testing. Historical
  open transport/discovery and runtime-trace rows describe the original audit's
  coverage limits; they are not a newly verified claim from the smoke suite.
- Targeted keyboard/reflow/contrast journeys exist, but there is no whole-app
  accessibility certification or exhaustive per-field browser matrix. The
  small CI gate protects representative journeys, not every page and gesture.
- Preview is a snapshot prediction. Routine what-if preview does not execute
  scripts; reusable previews execute supervised workers but apply no actions.
  Neither confirms future events or delivery to physical devices.
- Existing build-size and import/export hook-lint warnings are not introduced
  by this pass. No live household configuration or device commands are changed.

## How to maintain this record

Record newly reported defects and their actual fixes in a focused follow-up.
Keep dated evidence in the relevant feature document. Do not revive old “active
goal” instructions or mark unperformed broad audit gates as passed. For local
and CI commands, see [UI verification](../../ui/README.md#verification).
