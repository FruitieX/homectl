# Dashboard and runtime improvement pass

Scope: widget correctness/freshness, chart redesign, destination-aware departures,
floorplan usability, execution safeguards, and configuration maintenance.
The user permits API testing limited to downstairs, preferably office devices.
This pass used isolated unit tests and mocked browser traffic; no live API requests
or device changes were needed.

## Work checklist

- [x] Destination/direction filters, destination labels, service-day timestamps, cancellation and leave-time handling.
- [x] Shared readable charts: prices, weather expected/possible precipitation, sensor history/comparisons.
- [x] Correct weather sensor selection, fetch states, price intervals, calendar alignment, sensor contrast and robust trends.
- [x] Keyboard floorplan access, configurable sensor labels, inspector group/member navigation and scene shortcuts.
- [x] Script limits with isolated tests; queue latency metrics and dispatch/persistence separation.
- [x] Configuration API domain split (integrations, groups, scenes, routines), reusable routine drafts with preview, clearer execution explanations.
- [x] Type checks, lint/build, offline/unit coverage, mocked browser review in light/dark mobile/desktop layouts.

## Verification

- `pnpm --dir ui tsc`, `pnpm --dir ui lint`, and `pnpm --dir ui build`.
- `node --test ui/tests/widget-data.test.cjs`: six data/trend regression tests.
- `cargo test --lib`: 190 passing tests, including script limits, transit conversion,
  and independent deferred-work lanes. Transit tests rerun after cancellation fix.
- `cargo clippy --all-targets -- -D warnings` and `git diff --check`.
- Mocked Playwright review at 390, 600, and 1440 px in dark/light themes: widget
  dialogs, long-term weather, chart keyboard navigation, overflow and page errors.
- Mocked floorplan review at 390/1440 px: label toggle, keyboard picker, group/member
  navigation, canvas resizing, selection, and floor switching without control messages.
- Mocked routine creation: copied draft, preview before save, disabled default,
  and exact save payload. Browser scripts and screenshots are in `/tmp/homectl-ui-review`
  and `/tmp/widget-*.png` for this local review.

## Behavior and limits

- For Helsinki-bound trains across several routes, set **Destination contains** to
  `Helsinki`. The optional direction filter is combined with that match. Existing
  widgets default to both directions, with destinations now visible.
- Transit responses cache upstream data, not countdowns. Cancellation uses the
  scheduled timestamp when the realtime timestamp is absent/invalid. Missed walking
  times remain visible as **Too late** until the departure itself passes.
- Price intervals infer cadence from recent timestamps (up to one hour), including
  quarter-hour data. Missing intervals stay empty. Averages weight only the available
  portion of the next 24 hours; they are not a prediction for unpublished prices.
- Rain uses nonoverlapping forecast periods. Expected and maximum-likely amounts
  remain per-period totals, with durations available in chart inspection. The old
  daily maximum-of-mixed-periods rain label was removed.
- Trend classification uses five-minute median bins, a robust median slope, and
  agreement across samples. It needs at least four bins spanning 30 minutes, with
  no gap above 20 minutes and a reading within 15 minutes. Temperature and humidity
  have separate minimum slope/change thresholds. Unknown is distinct from steady.
- Script safeguards cap loop iterations (10,000), recursion (64), stack (4,096),
  source (64 KiB), each context payload (8 MiB), and serialized result (1 MiB).
  These are **not** a process sandbox, a heap allocation cap, or a hard wall-clock
  deadline. Native operations can still be expensive. A worker-process boundary
  would be required for strict memory/time isolation.
- Deferred database writes and integration dispatch have separate FIFO queues.
  This preserves order within each lane, not a global order across both lanes.
  Queues remain unbounded to avoid silently discarding commands; backlog and latency
  are logged. Bounded admission/coalescing needs an explicit overload policy.
- Routine templates populate editable drafts; nothing is executed by preview.
  New routines default to disabled. Existing routine status explains condition/trigger
  matching and evaluation errors, without claiming physical-device delivery.

## Source notes

- MET Norway defines `precipitation_amount` as expected precipitation over a period
  and `precipitation_amount_max` as maximum likely precipitation, with 1-hour and
  6-hour periods. Missing fields must remain missing, and mixed durations must be explicit.
  https://api.met.no/doc/locationforecast/datamodel
- Transit departure timestamps are `serviceDay + scheduledDeparture/realtimeDeparture`.
  `headsign` identifies the destination; GTFS `directionId` is a route-specific 0/1,
  not a universal compass direction.
  https://docs.opentripplanner.org/api/dev-2.x/graphql-gtfs/queries/stops
