# Charts, radial quick controls and sensor history

Updated: 2026-09-30.

Source: the user request beginning “the weather forecast widget table/charts tabs
are a bit buggy, the selected…”, plus the subsequent answers and correction.
This is the current implementation checklist for that entire request.
It supersedes the earlier mobile dropdown and unconditional hold-to-select
behavior delivered in `da24bba0`. Preserve the approved Compact visual direction.

## Status at this checkpoint

Nothing below is marked delivered yet. There are **local, unverified changes**
for the weather tab sizing, full-height bar highlights and compact price-chart
layout. The remaining features have not been implemented. Existing radial-ring
and rectangular-popover code is a starting point, not completion of the new design.

The user revised the history preference from 1,000 to **100 entries**. The
experimental retention increase has been reverted; no backend retention change
is currently pending.

## 1. Charts and weather widget

- [ ] Fix weather detail Table/Charts tabs: the active tab must fit inside its
      track, including the phone layout. Local sizing change awaits verification.
- [ ] Highlight the **entire plot height** of an inspected bar's time interval,
      rather than outlining only the bar's value height. Apply consistently to
      shared bar charts and pointer/touch/keyboard inspection. Local shared-plot
      change awaits verification.
- [ ] Make a spot-price widget around **170 px tall** useful: reserve meaningful
      plot height, compact secondary information and keep the x-axis fully inside
      the available card area. Local container/padding changes await verification.
- [ ] Add useful temperature range information to the weather forecast sparkline:
      identify the highest and lowest temperatures, ideally their points/times.
- [ ] Include time information so the forecast line's range is understandable.
- [ ] Support richer forecast inspection on hover and touch drag, consistent
      with the other charts; provide keyboard inspection too.
- [ ] Keep chart interaction from accidentally opening the weather detail view;
      preserve an obvious, accessible way to open that view.

## 2. Floorplan navigation and selection

- [ ] Restore **tabs on mobile**, immediately left of the assistant icon in the
      existing AppBar row. Do not use a select/dropdown or an additional row.
- [ ] Let those tabs scroll horizontally when they do not fit; avoid unnecessary
      width/padding that prevents an ordinary two-floorplan setup from fitting.
- [ ] Desktop Ctrl-click selects/toggles a light immediately, without waiting
      for a long press or opening the quick-adjust control.
- [ ] Removing the final selected light automatically exits selection mode.
- [ ] With no device sheet open, long press is dedicated to radial quick adjust;
      releasing must **not** select the light or dismiss the radial control.
- [ ] Preserve normal tap-to-open-device-sheet behavior.
- [ ] With the bottom device sheet already open, long press enters light
      selection mode instead of opening radial quick adjust. Preserve useful
      multi-selection behavior while the sheet stays open.

Implementation interpretation to verify: when beginning multi-selection from a
single-light sheet, keep that light in the selection and add/toggle the held
light. Do not silently discard the sheet's existing target.

## 3. Circular light quick controls

- [ ] Replace the separate rectangular quick-adjust sheet with a self-contained
      circular control. Keep the existing full device sheet available separately.
- [ ] Animate the circle opening; honor reduced-motion preferences.
- [ ] Keep it open after release; tapping outside dismisses it. Support Escape
      and sensible focus return without requiring touch gestures.
- [ ] Use the preferred circular composition: central On/Off toggle, surrounding
      hue/saturation area, and outermost brightness ring.
- [ ] Hue runs around the circle; saturation increases with distance away from
      the central power button. Make each interaction region distinguishable.
- [ ] Preserve direct hold-and-drag brightness adjustment on the outer ring.
- [ ] Add small floating mode buttons above the circle for at least hue/saturation
      and color temperature.
- [ ] Default to the device's current color mode; offer only supported controls
      and retain sensible behavior for dim-only lights and simple switches.
- [ ] Show color/brightness feedback within the circular design and retain the
      shared color preview language.
- [ ] Use the same control from floorplan and other light indicators, with
      appropriate positioning near screen edges and on small screens.
- [ ] Preserve acknowledged command handling, errors, disabled/read-only and
      disconnected states, and the existing scene-override policy. Keep ordinary
      map pan/zoom reliable and cancel incomplete gestures safely.

## 4. Sensor quick controls

Confirmed by the user: these controls **simulate sensor events for routines**,
using the supported existing API. They do not command physical sensor hardware.

- [ ] Add a corresponding quick-control entry point for floorplan sensors.
- [ ] Dimmer switches: compact vertical On / Up / Down / Off clicker using the
      sensor's configured event values.
- [ ] Boolean sensors: circular On/Off control.
- [ ] Numeric sensors: adjustment comparable to brightness, without inventing
      a physical unit or silently imposing an inappropriate 0–100 range.
- [ ] Handle other supported sensor kinds/configurations appropriately; retain
      full details for complex state/text payloads rather than guessing actions.
- [ ] Reuse consistent animation, dismissal, command feedback and accessible
      interaction conventions from the light quick controls.
- [ ] Make event simulation understandable in the control's labeling/context;
      avoid a new confirmation flow for every already-authorized simulated event.

## 5. Sensor sheet and overall history

Existing infrastructure: `server/src/core/value_history.rs` records changes in
`value_history`; `GET /api/v1/config/value-history` reads by source key and field
path. The database currently retains the latest **100 changes per source/field**,
skipping unchanged values. This includes sensor values and supports persisted
history independently of the routine-history ring. Reuse it rather than creating
another store. The limit is per field, not 100 combined rows across every field
of a multi-value sensor.

- [ ] Show when the selected sensor's value last changed, distinct from when it
      last reported. Handle absent history honestly.
- [ ] Show sensor history in the device sheet for numeric, boolean and discrete
      values, including dimmer events.
- [ ] Show all meaningful fields when a sensor has several values; avoid duplicate
      aliases such as `/value` and `/observed/value` representing the same reading.
- [ ] Use charts appropriate to the value: continuous or stepped numeric plots,
      boolean state changes, and categorical events/states with readable labels.
- [ ] Add a filterable overall sensor-change history view.
- [ ] Link from a sensor sheet to that view with the sensor filter already applied.
- [ ] Keep the existing 100-entry retention and database persistence. Preserve
      report timestamps separately; unchanged reports must not inflate history.
- [ ] Refresh history as values change and provide loading/empty/error/retry
      states. Verify restart retention and multiple-field behavior using the
      existing infrastructure; fix actual gaps if found.

## 6. Verification and delivery

- [ ] Inspect desktop/phone screenshots, including weather tabs, the roughly
      170 px price widget, annotated/interactive weather forecast and radial modes.
- [ ] Exercise Ctrl-click, final deselection, both hold contexts, outside dismissal,
      continued adjustment after release, cancelled gestures and map pan/zoom.
- [ ] Verify simulated sensor payloads, history filtering and multiple value kinds
      against isolated fixtures/API tests. Do not operate household devices.
- [ ] Run focused type/lint/build and relevant regression checks; avoid expanding
      this into unrelated verification work.
- [ ] Update this checklist with evidence, add comparison captures, and commit/push
      verified implementation checkpoints regularly.
