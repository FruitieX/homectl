# Widget option and default mapping

Reviewed 2026-09-30. This maps the 17 supported widget types to their current
editor, renderer and persistence behavior. It supplements FIELD-COVERAGE.md.
Defaults below are reader behavior for omitted options unless a creation default
is called out. Empty/default options are not written merely by opening an editor.

## Shared contracts

- Registry and option readers: `ui/hooks/useDashboard.ts`. New widgets copy their
  type's registry defaults. Existing rows preserve omitted fields and extensions.
- Typed fields: `ui/ui/WidgetOptionFields.tsx`; explicit save/credential handling:
  `ui/app/config/dashboard/widget.tsx`. Type changes retain each type's draft.
- Renderers: `ui/app/dashboard/*Card.tsx`, `EverydayWidgets.tsx` and
  `ui/ui/DashboardWidgetCard.tsx`. Numeric readers accept finite stored numbers
  and legacy numeric strings; booleans preserve false. Empty strings use the
  renderer's fallback. String arrays retain explicit empty selections; legacy
  comma-separated strings remain readable.
- Size/order/title are common row fields. Existing database tests cover assigned
  IDs, fractional sizes, transactional arrangements and conflict preconditions.
- Secrets use separate keep/replace/remove controls. Calendar and InfluxDB values
  remain masked in browser responses. Preview does not apply unsaved private
  overrides. See `dashboard_edits_preserve_credentials_extensions_and_reject_stale_writes`
  in `server/src/api/config/dashboard.rs` for the API contract.

## Type mapping

| Type | Fields and defaults | Renderer behavior / compatibility |
| --- | --- | --- |
| Home overview | No typed options | Home scene shortcuts and room summaries use their entity settings. |
| Rooms | `roomSelection: all`, `groupIds: []`, `showPower/showAttention/showFloorplan: true` | Selected mode preserves ID order; selected-empty shows none. Missing references stay repairable in the editor. |
| Scenes | `sceneSelection: all`, `sceneIds: []`, `scope: home`, `groupId: ''`, `deviceKeys: []` | Group/device scope intersects scene targets; an empty explicit scope commands nothing. Switching scope retains inactive selections. |
| Indoor climate | `temperatureSensorId: ''`, `humiditySensorId: ''`, `range: -24h` | Empty humidity uses the temperature sensor; no chosen temperature means unavailable. Custom ranges remain visible, including imported values. |
| Timers | `timerSelection: all`, `timerIds: []` | Selected-empty shows none; missing selections remain visible. Widget options reference server timer definitions rather than duplicating schedules. |
| Clock | `showSeconds: false`, `showDate/showCalendar: true`, `calendarPath: /api/calendar`, private `calendarUrl` override | Empty override uses the shared calendar service. |
| Weather | `weatherUrl: ''`, `weatherPath: /api/weather`, `outdoorSensorId: ''`, `sensorPath: /api/influxdb/temp-sensors`, `forecastHours: 48`, `forecastDays: 5`, `showWidgetForecast: false`, `refreshSeconds: 60` | URL override uses the weather proxy; otherwise the configured path/shared source applies. The numeric controls enforce forecast and refresh bounds. |
| Sensors | `sensorIds: []`, `primarySensorId: ''`, `influxUrl: ''`, private `influxToken`, `sensorPath: /api/influxdb/temp-sensors`, `range: -6h`, `window: 10m`, `wrapPreview: true`; optional `sensorSelection` | Legacy nonempty IDs imply selected mode; empty IDs without a mode imply all. Explicit selected-empty shows none. A missing header sensor falls back to the first shown reading while the editor retains its identity for repair. |
| Controls | `groupId: ''`, `deviceKeys: []` | Specific devices override group. Both empty use the first six controllable devices. |
| Mode / helper | `helperId: ''` | No selection offers configuration recovery. Hidden helpers are excluded from new choices but an existing selected hidden helper remains selectable and linked. |
| Spot price | `spotPricePath: /api/influxdb/spot-prices`, thresholds `2/5/8` | Signed decimal thresholds, including zero, are valid. Renderer consumes each independently. |
| Train schedule | `trainApiUrl: ''`, `trainSchedulePath: /api/train-schedule`, `stationId: HSL:2131551`, `destination/directionId: ''`, `walkMinutes: 12`, `overdueMinutes: 3`, `maxMinutesAhead: 100`, `limit: 5`, `displayLimit: 3`, `scrollMore: false` | Empty direction means both. Zero walk/overdue/ahead values remain explicit. Counts are integral and bounded. URL override otherwise falls back to the shared source/path. |
| Text | `body`; creation pre-fills example text | Missing/empty body in an existing widget shows configuration recovery, not invented text. |
| Link | `url`, `label`, `description`; creation uses `/`, `Open`, `''` | Missing URL in an existing widget offers recovery; missing label uses the widget title. |
| Iframe | `url: ''`, creation title `Embedded view` | Missing URL offers recovery. Existing missing title uses the widget title or `Embedded page`. Preview remains sandboxed and inert. |
| Image | `imageUrl: ''`, creation alt `Dashboard image` | Missing/failed image has recovery; failed loads offer Retry. |
| Custom HTML | `content: ''` | Empty content offers recovery. HTML/CSS run in a script-disabled sandbox. |

## Direct evidence

- `ui/dev/widget-options-review.mjs`: **22 native browser checks at 1440/390**.
  Edited train numbers/direction and price thresholds save/reload; cleared required
  numbers focus an error without writing. Unedited defaults remain omitted.
  Missing scene/room/sensor/timer references remain repairable; custom climate
  ranges and humidity fallback persist; inactive scope/selection IDs survive
  mode switching. No live commands. Six temporary widgets per run are deleted.
- Existing `widget-preview-input.mjs` covers all 17 type selections and inert
  preview composition. Existing design and sensor-order journeys cover creation,
  retained per-type fields, dimensions and selection ordering. They do not prove
  every external data source is reachable.
- Expanded `everyday_collections_survive_database_reopen_and_json_restore`:
  **one targeted test passes** using actual SQLite close/reopen and JSON import
  into a second database. It now includes all 17 types, edited option payloads,
  a second empty-options row for each type, private synthetic overrides,
  negative/zero/decimal values, multiline text, HTML, IDs and extension data.
  Database export here is internal and secret-inclusive; it does not replace the
  separate public-export redaction tests. All option objects compare exactly.
- The existing phone `settings-widget-journey.js` passes after adapting its
  selector and visual type-gallery interactions. It verifies credential masking,
  conflict review, retained drafts, invalid-size focus and explicit creation.
  Its injected HTTP 409 is expected, not a runtime failure.
- Captures and logs: `implementation-evidence/everyday/widget-options-*`.
  Type/lint/build pass; the existing bundle-size warning remains.

This closes the option inventory and storage mapping. Existing browser evidence
covers the named interactions above; it does not imply every external service,
all helper visibility paths, creation/deletion races or the wider accessibility
matrix has been accepted. Those remain in ACCEPTANCE-AUDIT.md.
