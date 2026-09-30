# Charts, radial quick controls and sensor history

Updated: 2026-09-30.

## Follow-up: selection, off appearance and action buttons

The latest quick-control requirements are implemented:

- [x] Add a **Select** icon above the floorplan light's radial surface. It closes
      the radial control and enters the existing multi-light selection mode;
      selection sends no device command. Deselecting the last light still exits.
- [x] Darken the radial power centre when the light is off, matching the map
      marker's slate fill. Restore the selected color when powered on. Preserve
      the selected hue on the brightness ring and the existing live-update queue.
- [x] Remove the idle “Simulate an event for routines” instruction from sensor
      quick controls. Pending/error states remain accessible.
- [x] Support Office button's MQTT actions: **Press → single**, **Double press →
      double**, **Hold → hold**, **Off → off**. Auto controls use the current value
      plus retained `/value` history, so an `off` or `on` report does not hide
      previously observed press actions. Actual payload spelling is preserved;
      auto controls offer observed values rather than guessing device capabilities.
- [x] Add **Button events** to device sensor settings, with editable mappings for
      those four actions. Empty mappings hide unused buttons. These use the
      existing database-backed sensor configuration, with no schema migration
      or live household configuration change. Saved mappings override inference.
- [x] Use the same observed/mapped actions in quick controls and full sensor
      controls. Generic text sensors also get a directly editable value and Send
      control rather than only a link to their details.

Simulation sends homectl's normalized `Sensor: { value: "single" }` input through
the existing device API; it does not publish a physical MQTT command. The server
evaluates repeated identical sensor reports as events. This batch also fixes the
API input's origin: sensor simulation is now a report, rather than a derived
write which v2 report triggers intentionally ignore. Repeated Press therefore
works with pulse/event routines even though history only retains value changes.
Office button's configuration and retained events were inspected read-only;
acceptance writes target only the isolated development fixture.

Verification for this combined follow-up batch:

- **268 UI unit tests pass**, including observed/saved event mappings and snap
  precision/bounds/modifiers. UI type check and production build pass; lint has
  only its existing import/export ref-cleanup warning.
- **174 desktop/phone browser checks pass**: 53 quick-control/history/mapping
  checks and 34 editor checks at each size. An additional 360 px capture confirms
  the snap control fits without horizontal document overflow.
- A real Rust HTTP/actor regression test passes for `single`, repeated `single`,
  `double`, `hold` and `off`: each produces a separate accepted v2 report-triggered
  run, updates the value and sends no physical-device work. Run with
  `nix develop -c cargo test -p homectl-server --lib api::devices::tests`.
- [Screenshots and acceptance logs](implementation-evidence/quick-controls-snapping/)
  preserve the final batch. Editor logs include the expected HTTP 409 from
  deliberate conflict testing. Quick-control runs have no browser errors.

## Follow-up: open group controls in the floorplan

- [x] Clicking/tapping a group area opens its controls in the floorplan inspector,
      keeping the current map route, floorplan and view filter. Desktop uses the
      side panel; phones use the same resizable bottom panel as device controls.
- [x] Show group summary, attention, shared power/brightness/color controls,
      scenes and member devices using the existing room panel. Opening a group
      clears an active device/sensor/quick-control overlay, so panels do not stack.
- [x] Put **Room details** and **Room settings** links near the top of the panel.
      Navigation to the full room page happens through the explicit link.
- [x] Preserve group long press for device selection, including deduplicated
      nested members. While selecting, a group tap still toggles its members.
      Finishing selection restores normal tap-to-open behavior.
- [x] Keep close/reopen controls and room-specific floorplan entry points working.
      Changing floorplans closes the previous group's panel.

Verification: **39 browser checks pass** (19 desktop, 20 phone) against the
isolated fixture. They cover tap/hold, route retention, panel close/reopen,
nested/disabled/read-only/unavailable members, command scope and map recovery;
the phone batch also follows the Room details link. Both runs have no browser
errors. UI type check, lint and production build pass, with the existing lint
and build warnings. No live household configuration or devices were changed.
[Captures and logs](implementation-evidence/group-tap/).

Source: the user request beginning “the weather forecast widget table/charts tabs
are a bit buggy, the selected…”, plus the subsequent answers and correction.
This is the current implementation checklist for that entire request.
It supersedes the earlier mobile dropdown and unconditional hold-to-select
behavior delivered in `da24bba0`. Preserve the approved Compact visual direction.

## Delivery status

**Implemented and verified as one combined batch**, including the later request
to flatten the Settings landing page's section/list styling. No implementation
items from this request remain open. The older mobile dropdown, unconditional
hold-to-select and rectangular light quick-control design are superseded.

History retains the existing **100 changes per source/field**. No retention
increase, new database table, configuration migration or deployment setting was
needed. An aggregate read endpoint adds filtering/pagination over the same store.

## 1. Charts and weather widget

- [x] Fix weather detail Table/Charts tabs: the active tab must fit inside its
      track, including the phone layout.
- [x] Highlight the **entire plot height** of an inspected bar's time interval,
      rather than outlining only the bar's value height. Apply consistently to
      shared bar charts and pointer/touch/keyboard inspection.
- [x] Make a spot-price widget around **170 px tall** useful: reserve meaningful
      plot height, compact secondary information and keep the x-axis fully inside
      the available card area.
- [x] Add useful temperature range information to the weather forecast sparkline:
      identify the highest and lowest temperatures, ideally their points/times.
- [x] Include time information so the forecast line's range is understandable.
- [x] Support richer forecast inspection on hover and touch drag, consistent
      with the other charts; provide keyboard inspection too.
- [x] Keep chart interaction from accidentally opening the weather detail view;
      preserve an obvious, accessible way to open that view.

## 2. Floorplan navigation and selection

- [x] Restore **tabs on mobile**, immediately left of the assistant icon in the
      existing AppBar row. Do not use a select/dropdown or an additional row.
- [x] Let those tabs scroll horizontally when they do not fit; avoid unnecessary
      width/padding that prevents an ordinary two-floorplan setup from fitting.
- [x] Desktop Ctrl-click selects/toggles a light immediately, without waiting
      for a long press or opening the quick-adjust control.
- [x] Removing the final selected light automatically exits selection mode.
- [x] With no device sheet open, long press is dedicated to radial quick adjust;
      releasing must **not** select the light or dismiss the radial control.
- [x] Preserve normal tap-to-open-device-sheet behavior.
- [x] With the bottom device sheet already open, long press enters light
      selection mode instead of opening radial quick adjust. Preserve useful
      multi-selection behavior while the sheet stays open.

Implementation interpretation to verify: when beginning multi-selection from a
single-light sheet, keep that light in the selection and add/toggle the held
light. Do not silently discard the sheet's existing target.

## 3. Circular light quick controls

- [x] Replace the separate rectangular quick-adjust sheet with a self-contained
      circular control. Keep the existing full device sheet available separately.
- [x] Animate the circle opening; honor reduced-motion preferences.
- [x] Keep it open after release; tapping outside dismisses it. Support Escape
      and sensible focus return without requiring touch gestures.
- [x] Use the preferred circular composition: central On/Off toggle, surrounding
      hue/saturation area, and outermost brightness ring.
- [x] Hue runs around the circle; saturation increases with distance away from
      the central power button. Make each interaction region distinguishable.
- [x] Preserve direct hold-and-drag brightness adjustment on the outer ring.
- [x] Add small floating mode buttons above the circle for at least hue/saturation
      and color temperature.
- [x] Default to the device's current color mode; offer only supported controls
      and retain sensible behavior for dim-only lights and simple switches.
- [x] Show color/brightness feedback within the circular design and retain the
      shared color preview language.
- [x] Use the same control from floorplan and other light indicators, with
      appropriate positioning near screen edges and on small screens.
- [x] Preserve acknowledged command handling, errors, disabled/read-only and
      disconnected states, and the existing scene-override policy. Keep ordinary
      map pan/zoom reliable and cancel incomplete gestures safely.

## 4. Sensor quick controls

Confirmed by the user: these controls **simulate sensor events for routines**,
using the supported existing API. They do not command physical sensor hardware.

- [x] Add a corresponding quick-control entry point for floorplan sensors.
- [x] Dimmer switches: compact vertical On / Up / Down / Off clicker using the
      sensor's configured event values.
- [x] Boolean sensors: circular On/Off control.
- [x] Numeric sensors: adjustment comparable to brightness, without inventing
      a physical unit or silently imposing an inappropriate 0–100 range.
- [x] Handle other supported sensor kinds/configurations appropriately; retain
      full details for complex state/text payloads rather than guessing actions.
- [x] Reuse consistent animation, dismissal, command feedback and accessible
      interaction conventions from the light quick controls.
- [x] Make event simulation understandable in the control's labeling/context;
      avoid a new confirmation flow for every already-authorized simulated event.

## 5. Sensor sheet and overall history

Existing infrastructure: `server/src/core/value_history.rs` records changes in
`value_history`; `GET /api/v1/config/value-history` reads by source key and field
path. The database currently retains the latest **100 changes per source/field**,
skipping unchanged values. This includes sensor values and supports persisted
history independently of the routine-history ring. Reuse it rather than creating
another store. The limit is per field, not 100 combined rows across every field
of a multi-value sensor.

- [x] Show when the selected sensor's value last changed, distinct from when it
      last reported. Handle absent history honestly.
- [x] Show sensor history in the device sheet for numeric, boolean and discrete
      values, including dimmer events.
- [x] Show all meaningful fields when a sensor has several values; avoid duplicate
      aliases such as `/value` and `/observed/value` representing the same reading.
- [x] Use charts appropriate to the value: continuous or stepped numeric plots,
      boolean state changes, and categorical events/states with readable labels.
- [x] Add a filterable overall sensor-change history view.
- [x] Link from a sensor sheet to that view with the sensor filter already applied.
- [x] Keep the existing 100-entry retention and database persistence. Preserve
      report timestamps separately; unchanged reports must not inflate history.
- [x] Refresh history as values change and provide loading/empty/error/retry
      states. Verify restart retention and multiple-field behavior using the
      existing infrastructure; fix actual gaps if found.

## 6. Verification and delivery

- [x] Inspect desktop/phone screenshots, including weather tabs, the roughly
      170 px price widget, annotated/interactive weather forecast and radial modes.
- [x] Exercise Ctrl-click, final deselection, both hold contexts, outside dismissal,
      continued adjustment after release and cancelled gestures; review the retained
      map pan/zoom paths.
- [x] Verify simulated sensor payloads, history filtering and multiple value kinds
      against isolated fixtures/API tests. Do not operate household devices.
- [x] Run focused type/lint/build and relevant regression checks; avoid expanding
      this into unrelated verification work.
- [x] Update this checklist with evidence, add comparison captures, and commit/push
      verified implementation checkpoints regularly.

## 7. Settings landing page consistency

- [x] Separate navigation section headings from flat, bordered lists. Use straight
      internal dividers and consistent row spacing/hover/focus styling; remove the
      rounded border treatment on individual navigation rows.
- [x] Device attention uses the same flat divider pattern instead of a card per
      warning inside another card.
- [x] Review desktop and phone captures alongside the rest of this batch.

## Implementation notes and evidence

- Light controls share one animated radial surface on floorplans and dashboard/
  room light indicators. Mode buttons reflect the current mode. Holding and
  releasing leaves the circle open; direct hold/drag now sends coalesced live
  updates and flushes the final value on release (see the follow-up below). The
  center toggles power; the inner area edits color; the outside ring edits brightness.
- With a device sheet open, holding a light selects it alongside the sheet's
  existing light. Ctrl-click selects directly; removing the last selection exits.
- Floorplan tabs occupy the existing AppBar before the assistant. They scroll
  horizontally and use the same 44 px hit height as Compact tabs.
- A small resize was previously mistaken for a mobile browser toolbar change.
  Maps explicitly requesting fit-on-resize now refit when the selection toolbar
  or inspector changes the available canvas space.
- Sensor quick controls also work from room/dashboard sensor rows. Dimmer event
  mappings are preserved. Booleans have a circular control; numbers use an editable
  value and stepper because the API supplies no safe universal range or unit.
  Complex/text payloads continue through full details. Controls label event
  simulation, disable while sending/disconnected, and show failures.
- Sensor details distinguish last changed from the existing report timestamps.
  Numeric, boolean and categorical charts support inspection. Compound values
  produce separate field charts from the root value, without duplicate aliases.
- `GET /api/v1/config/sensor-history?sensor=&before=` returns up to 100 root
  sensor changes per page, excluding helper values and field aliases. The activity
  page supports entity/value search, sensor filters and older-page loading. It is
  linked from sensor details, the sensor catalog and Settings navigation.
- History refreshes every 10 seconds and on opening; loading, empty, failed refresh
  and retry states preserve available results. No household configuration was changed.

Verification:

- `pnpm --dir ui tsc`, `pnpm --dir ui lint`, `pnpm --dir ui build` passed.
  Lint retains the existing import/export cleanup warning; the build retains its
  existing large-chunk warning. No new lint warnings remain.
- All **251 UI tests** passed.
- Rust value-history coverage passed: change deduplication, 100-entry retention,
  root-only aggregation, helper exclusion, sensor filtering, cursor pagination,
  and reopening the SQLite database with both scalar and compound values intact.
  The generated SensorHistoryEntry binding export also passed.
- **71 native browser checks** passed across 390 × 844 and 1440 × 1000:
  26 radial/selection/sensor/history checks on each size, 10 chart checks on phone
  and 9 on desktop. Covers real touch/mouse gestures, Ctrl-click, cancellation,
  outside/Escape dismissal, configured dimmer events, numeric/boolean events,
  keyboard controls, hover/touch forecast inspection and weather tab bounds.
  No browser console/page errors were reported. Pan/zoom paths were retained and
  reviewed in the shared renderer; this batch did not add a separate pinch test.
- The **170 px price widget** measures **127.5 px of chart height**, with the x-axis
  fully inside the card, on both screen sizes. The selected bar highlight has
  the same height as the plot's clipping region.

[Current screenshot gallery](implementation-evidence/comparison/index.html#radial-history)
· [Recorded browser checks](implementation-evidence/radial-history/checks.json).

Delivery is committed and pushed with the implementation batch; see Git history
for the conventional commit covering charts, radial controls and sensor activity.

## Follow-up: sensor and weather widget sizing

Requested after the floorplan editor implementation; delivered 2026-09-30.

- [x] Compact sensor previews earlier so their sparklines remain readable at
  smaller heights. Cards up to 280 px use a single, horizontally scrollable row
  that retains every selected sensor; previews share spare width. Individual
  short chips reduce name/value spacing and hide humidity before losing their
  chart band. The climate detail view still includes both measurements.
- [x] Temperature forecasts label only the actual low and high on the y-axis.
  Labels stay separated for nearly constant temperatures; a completely flat
  forecast has one label. The minimum temperature scale span is preserved.
  Each extreme's native tooltip includes its value and time.
- [x] Forecast x-axes show three or four spaced readings with a day/date and
  time on separate lines, including both ends. Especially narrow plots use
  two labels. This also applies to weather detail charts; the larger hourly
  icon strip includes the weekday.
- [x] Reserve the weather chart's space at different sizes. Below roughly
  220 px, the current temperature moves into the heading. The icon strip only
  appears when both height and width permit it. Cards below roughly 143 px
  use the current-weather summary. The SVG uses its actual available height
  instead of a minimum that could overflow and clip the axis.
- [x] Preserve inline hover, touch drag and keyboard inspection, plus access
  to weather details. Empty sensor status wrappers no longer reserve space.

### Verification and evidence

Type checking, production build and all **256 UI tests** passed. Lint reports
only the existing import/export cleanup warning. **79 browser checks passed**
(46 desktop, 33 phone), with no browser errors. The fixture browser batch
checks 240/360/520 px widths on desktop and two widths on phone, with card
heights of 120, 144, 170, 220, 280, 360 and 420 px. It verifies chart geometry,
axis bounds and overlap, retained sensor previews, compact summaries, native
hover/touch/keyboard inspection, weather detail axes and nearly flat forecasts.

[Desktop and phone screenshots](implementation-evidence/widget-chart-sizing/index.html).
The screenshot fixtures are synthetic. No live configuration or devices were
changed. Reproduce the complete batch on the isolated fixture UI:

```sh
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url http://127.0.0.1:3021/ --width 1440 --height 1000 \
  --driver-file ui/dev/widget-chart-sizing-review.mjs
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url http://127.0.0.1:3021/ --width 390 --height 844 \
  --driver-file ui/dev/widget-chart-sizing-review.mjs
```

## Follow-up: radial geometry and live adjustment

Requested and delivered 2026-09-30. This supersedes the initial release-only
command behavior.

- [x] Fix the hue surface's center and scale. The wheel previously used a
  rem-based diameter with pixel-based coordinates, which broke at Compact
  density. Its diameter is now explicitly 192 px, centered on the 268 px
  surface; the indicator stays inside the colored area at full saturation.
  Pointer coordinates also account for the actual animated surface bounds.
- [x] Prevent brightness/color indicators from briefly returning to old values.
  Keep the latest local adjustment until its matching device state arrives,
  across older intermediate acknowledgements. Confirmed values release the
  local overlay so later external device updates remain visible.
- [x] Apply while dragging through a 120 ms coalescing window, with only one
  request in flight. A continuous drag updates the physical target before
  release. New input replaces queued input; release flushes the latest value.
  Closing finishes the released value without updating an unmounted view.
  A rejected command stops queued writes through the existing error path.
- [x] Keep controls responsive while awaiting acknowledgements. Keyboard and
  power changes flush immediately through the same serialized command path.
  Canceling drops unsent changes; values already applied by live adjustment
  remain applied.
- [x] Use the selected light color for the brightness arc, center power button
  and color indicator, using the same color conversion as floorplan markers.
- [x] Give the title a background pill and remove the “inner circle … outer
  ring …” instruction. Connection/read-only status still appears when needed.

The shared popover delivers these changes on floorplans and dashboard/room light
indicators. No new endpoint, setting, database migration or dependency is needed.

Verification: **261 UI tests** passed, including five queue tests for coalescing,
slow acknowledgements, rejection, cancellation and closing during a pending
command. Type check, production build and lint passed; lint retains the existing
import/export cleanup warning. **68 browser checks passed** (34 desktop,
34 phone). Desktop and phone browser batches include native
mouse/touch adjustments before release, 400 ms acknowledgement delays, stable
indicators, all four hue quadrants at both densities, matching preview colors,
and subsequent external updates, alongside existing selection/sensor/history
checks. The browser batches reported no errors and used only isolated fixtures.
No live household configuration or devices were changed.

[Desktop hue](implementation-evidence/radial-live/desktop-hue.png) ·
[Phone hue](implementation-evidence/radial-live/phone-hue.png) ·
[Desktop temperature](implementation-evidence/radial-live/desktop-temperature.png) ·
[Phone temperature](implementation-evidence/radial-live/phone-temperature.png) ·
[Desktop checks](implementation-evidence/radial-live/desktop-checks.json) ·
[Phone checks](implementation-evidence/radial-live/phone-checks.json).
