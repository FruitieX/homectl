# Widget taps and chart readings

Implemented 2026-10-01 after reports that dashboard weather and electricity
price charts intercepted taps and chart readings remained open after release.

## Requirements and delivered behavior

- A short tap/click on a dashboard chart opens that widget's details. This
  includes weather, electricity prices and indoor climate. The existing card
  buttons remain available for keyboard access.
- Dragging more than 8 px or holding for at least 450 ms inspects values
  without opening details. Horizontal touch movement explores the chart;
  vertical touch movement remains available for scrolling.
- Releasing the pointer clears the reading, including releases outside the
  plot. Cancellation, scrolling, resizing and leaving the browser also clear
  it. Touch readings have no persistent state or separate close button.
- Mouse hover still shows values and clears them on leaving the plot.
- Arrow keys, Home and End continue to inspect values. Escape clears the
  focused chart's reading before dismissing its containing dialog; moving
  focus away also clears it.

## Reading design

The full-width strip inside the chart is replaced by a compact floating card:
a date/time heading with aligned source names and values below it. Existing
units, missing-value handling, ranges and precipitation-period details remain.

The card prefers space above or below the plot. When neither side fits, it
uses available space away from the pointer, with 64 px clearance for touch,
and stays within the visual viewport. It renders in a portal so card/dialog
overflow cannot clip it, and does not intercept any input. Very short
viewports can still require some overlap with the plot.

All active charts use this shared rendering and interaction: dashboard
weather/price/climate charts, widget detail charts, room conditions and sensor
history (including boolean and discrete values). The unused legacy chart
interaction overlay also adopts the same pointer-release lifecycle.

## Verification

Native Chromium checks use synthetic weather, electricity-price and climate
data with the guarded loopback fixture. They cover phone **430 × 932** and
desktop **1440 × 1000**, with **111 checks passing** and no browser errors:

- Actual taps/clicks open widget details; drags and holds do not.
- Held/dragged readings update and stay within viewport bounds.
- Weather, price, climate and sensor detail readings clear on release.
- Touch cancellation, mouse release outside the plot, hover exit and
  scrolling clear readings.
- Keyboard inspection and the first-Escape behavior remain available.
- Vertical touch gestures still scroll the phone dashboard.

Type checking, lint and the production build pass with existing warnings.
No live household configuration or device commands are changed. Fixture
widgets, layout and sensor catalog changes are cleaned up by the driver.

Reproduce with `ui/dev/chart-gesture-review.mjs` through `ui/dev/cdp-probe.mjs`
against the fixture-backed Vite instance on port 3021. Earlier chart review
drivers now expect automatic dismissal on release.

[Phone widget reading](implementation-evidence/chart-gestures/phone-weather-widget.png) ·
[Phone detail reading](implementation-evidence/chart-gestures/phone-weather-detail.png) ·
[Desktop price reading](implementation-evidence/chart-gestures/desktop-price-widget.png) ·
[Browser results](implementation-evidence/chart-gestures/).
