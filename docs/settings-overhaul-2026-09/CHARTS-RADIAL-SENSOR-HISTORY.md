# Charts, radial quick controls and sensor history

Updated: 2026-09-30.

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
  releasing leaves the circle open; direct hold/drag commits on release. The
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
