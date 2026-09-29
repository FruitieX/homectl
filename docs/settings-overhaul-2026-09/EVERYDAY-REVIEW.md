# Everyday UI · Study 05

Status: room and dashboard direction confirmed, 2026-09-29. This extends the
approved Compact settings direction. The remaining view studies are available
for refinement; this document records design decisions, not completed production
implementation.

Start with [the screenshot gallery](everyday-review.html), then
[the interactive prototype](everyday.html#room). Both open directly from disk;
no development server, account or internet connection is needed.

## Confirmed direction

- **Room details: controls first.** Open the room's controls, scenes and current
  conditions by default. Keep the small floorplan preview and a link to the full
  floorplan. A room without placed devices uses the same controls-first layout.
- **Dashboard: keep the existing widget system.** Add **three separate new widget
  types: Rooms, Scenes and Indoor climate**, using the approved card designs.
  Each is independently addable, configurable, resizable and reorderable through
  the existing dashboard system, alongside all existing widget types.
- The [approved home example](everyday.html#home) is an arrangement of widgets.
  The Rooms and Scenes cards are independent widgets, not one combined overview
  widget. Indoor climate is a new widget, alongside the existing Sensors widget.
- Existing dashboard layouts and widget configurations remain valid. The example
  arrangement is a design reference; it must not overwrite a configured dashboard.

### Widget implementation notes

Use the existing database-backed dashboard/widget APIs and arrangement draft
workflow. Extend the widget type catalog, add-widget picker, option editor and
renderer together. Keep export/import backward compatible. Reuse room membership,
scene activation, sensor catalogs/history and the shared attention evaluator.

Suggested option coverage for implementation (details remain refinable):

| New widget | Configuration and behavior |
| --- | --- |
| Rooms | Select rooms/groups and their order; show state and attention summaries; open controls-first room details. Scope any bulk action to the displayed selection and label it accordingly. |
| Scenes | Select scenes and their order; optionally scope activation to a room/group or device selection; show activation scope, state previews and related scene-detail links. |
| Indoor climate | Select temperature/humidity sources and labels using the existing sensor catalog; choose the trend source/period; show freshness and missing data explicitly, with links to sensor details. |

Final wire type names and option schemas should be checked against the current
backend before implementation. No new runtime settings belong in TOML.

## Earlier comparisons

- Room A: [controls first](everyday.html#room). Lights, scenes and current room
  conditions are visible together; a small floorplan links to the full view.
- Room B: [floorplan first](everyday.html#room-map). The map leads, with shared
  controls beside it on desktop and below it on a phone.
- Home A: [composed overview](everyday.html#home). Rooms and scenes lead, followed
  by information widgets.
- Home B: [configurable widgets](everyday.html#dashboard). The existing modular
  structure receives consistent visual treatment throughout.

The user selected Room A and combined the home directions through new widgets.
Room B and the alternate widget arrangement remain accessible from the study
selector as references. The dashboard mockup no longer offers an Overview/Widgets
product switch.

## Complete view coverage

| Study | Included |
| --- | --- |
| Rooms & groups | Search, room summaries, floorplan previews, power and attention links. |
| All devices | Search and type filtering; lights and sensors together. |
| Room without a map | Controls, scenes, conditions and related settings without an empty map dominating the page. |
| Single-light controls | Power, brightness ring, color shortcuts, white temperature, scene-override explanation and related links. |
| Mixed-group controls | Mixed-state preview and explicit explanation of which available lights change. |
| Floorplan selection | Shared inspector, selected-light count and scene capture. |
| Scene capture | Current requested state review, name validation, retained in-tab draft and explicit creation. |
| Sensor details | Human-readable value, trend, reporting/battery status, related widgets/routines and advanced raw details. |
| Widget family | Climate, prices, weather, agenda, departures, home modes, notes/links and an embedded-content placeholder. |
| Car heater | Direct timer editing, add/remove, enabled state, next departure and explicit Save/Discard. |
| Assistant | Existing light-state proposal concept with selection, before/after previews, entity links and Apply. |
| Search | Readable entity context and destinations, Ctrl/Cmd+K and Enter navigation. |
| Attention | Quiet device, low-battery proposal and recovered device, with repair links. |
| Recovery | Reconnecting, loading, empty rooms, missing room, unavailable map and stale widget data. |

Configuration-plan diffs in the assistant should inherit the same spacing and
entity-link conventions; this study models the light-state review in detail.
The existing settings prototypes remain the reference for full scene authoring,
routine editing and configuration Save/Discard/conflict interactions.

## Try these interactions

1. Open a light from a room. Move brightness; its value and preview ring update.
   Close with Escape or the consistent top-right close button.
2. Apply Reading from the room's scene strip. Its active state changes in the
   mockup. Open its scene settings using the related link.
3. Compare the two room layouts using Controls/Floorplan. Try the dedicated
   mixed-group view and the bedroom with no floorplan.
4. Search All devices for “climate”, then try a query with no matches. Filter by
   Sensors or Lights.
5. Edit a departure timer, visit another study and return. The draft remains.
   Discard restores the saved example; Save explicitly updates this tab's copy.
6. Name a captured scene, navigate to the map and return. The name remains.
   An empty name blocks creation.
7. Deselect an assistant proposal row. Apply updates its count and shows a
   simulated completion state. Nothing is sent to an assistant provider.
8. Open the climate or electricity widget details. Check how the same panel
   becomes a phone sheet. Sensor details include an explicit readings table.
9. Toggle Advanced details and theme in the study toolbar. Ordinary availability
   and attention messages stay visible when technical information is hidden.
10. Press Ctrl/Cmd+K, type “climate”, and Enter to open the sensor result.

## Design rules

- Reuse the approved green/slate Compact palette, border treatment, preview ring
  and restrained typography. Avoid decorative slogans.
- Give live controls immediate feedback; reserve Save/Discard for configuration.
  Show when manual adjustments also update a saved scene.
- Keep frequently used room controls and scenes visible. Reserve secondary
  dialogs for focused tasks such as expanded charts and richer color controls.
- Reuse shared control content across dashboard, rooms and floorplan.
- Preserve useful technical details through the shared advanced preference.
- Use one attention policy/evaluator; the examples do not define a new stale
  threshold outside the existing integration/device policy.
- Preserve desktop space for useful columns and context. Phone controls use
  labeled rows, cards and sheets instead of compressed tables.

## Prototype boundaries

All data is synthetic. Local controls and selected drafts are simulated in memory
and reset on reload. No fetch, WebSocket, provider or physical-device API calls
are made. Links into the older settings study open representative entity pages;
they are not connected to this study's draft state.

Charts have illustrative values; range selection does not fetch or recompute
history. Floorplan geometry, selection count and upstairs switching are examples,
not an implementation of map gestures. Some room summaries and aggregate counts
are fixed composition examples. Power/scene feedback is illustrative, without
server acknowledgement, persistence errors or device telemetry simulation.

The basic color dialog demonstrates placement and direct interaction; the
production picker must retain all current color modes and sampling tools.
Embedded content remains a placeholder. Low-battery attention and next-departure
summaries require checking the available backend data before implementation.
Configuration assistant diff variants and calibration are not newly prototyped
here; the existing settings work and inventory describe their remaining scope.

## Verification

- `node --check everyday.js` passes.
- Browser driver: [verify-everyday.mjs](verify-everyday.mjs).
- 18 views checked at 1440, 390 and 360 px for document overflow, square preview
  rings, a page title and named buttons.
- Interaction checks cover search including sensors/empty results, shared
  controls, brightness preview, scene state, retained drafts, explicit saving,
  validation, advanced details and assistant proposal selection.
- Native Chromium key events exercise Escape, Ctrl+K and Enter.
- Screenshots: `previews/everyday/`; results:
  [verification.json](previews/everyday/verification.json).
- This is prototype verification. It does not establish production behavior,
  complete accessibility, screen-reader support or touch gesture correctness.

Reproduce from the repository root, with Chromium CDP listening on port 9337:

```sh
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url file:///home/rasse/homectl/docs/settings-overhaul-2026-09/everyday.html#home \
  --width 1440 --height 1000 \
  --driver-file docs/settings-overhaul-2026-09/verify-everyday.mjs
```

## Remaining refinements

The room default and widget architecture are settled. Refine the control sheet,
individual widget options and responsive sizing within those choices. Full
floorplan controls remain a related view; a per-room default-layout preference
has not been requested.
