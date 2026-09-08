# Configurable sensor sources, names, and groups

Status: foundation implemented; source discovery and normalized history remain follow-up work.

Persistence decision: the sensor source, sensor catalog, names, groups, memberships,
and widget selections are database-owned runtime data. They must not be added as ongoing TOML
or other text-file settings. JSON export/import and legacy TOML are compatibility
paths only; after import, runtime reads come from the database snapshot.

## Outcome

Keep existing InfluxDB measurements unchanged. Store editable sensor names and
groups in homectl, with source adapters translating external data into a common
format. A fresh installation contains no household-specific IDs, names, groups,
bucket names, or organization names.

First supported adapter: the existing InfluxDB v2 / Flux connection. Other InfluxDB
query languages and backends are separate adapters, not implied compatibility.

## 1. Data model and persistence

The first slice stores the catalog as a database-owned `sensor_catalog` runtime
setting. It is exported with the existing database config backup and updated via
the state actor/config write path. A dedicated normalized schema can follow once
source discovery is implemented; this keeps the first migration small and avoids
introducing household-specific seed data into a portable binary.

| Entity | Fields and constraints |
| --- | --- |
| Sensor source | Stable ID, editable name, adapter kind, connection settings, schema mapping, revision, enabled flag |
| Sensor | Stable catalog ID, source ID, external identity object, optional name override, optional homectl device link, imported name, archived flag |
| Sensor group | Stable ID, editable name |
| Group membership | Group ID + catalog sensor ID; unique pair |

- A sensor's external identity is a string-valued map, e.g. `{device_id: "abc"}`
  or `{gateway: "one", device_id: "abc"}`. Canonicalize key ordering for storage
  and enforce uniqueness on source ID + canonical external identity. Widgets use
  the catalog ID, so renaming a source, sensor, or group does not break references.
- Display-name precedence: explicit sensor override → linked homectl device's
  resolved display name → imported source name → external identity. Clearing an
  override restores inheritance. Linking devices is explicit.
- Existing `DeviceSensorConfigRow` describes device interactions, not historical
  sensor identity. Keep it separate. Reuse the device display-name resolver for
  linked sensors rather than repurposing that table.
- Groups are shared across widgets and may contain sensors from multiple sources.
  A sensor can belong to several groups. There are no special indoor/outdoor flags.
- Archive sensors instead of removing them when data disappears. Reject source
  deletion while it has catalog entries; offer disabling it. Group deletion also
  removes its memberships and references from widget group selections atomically.
- Extend `ConfigExport` with default-empty source, sensor, group, and membership
  collections. Include them in JSON backup/restore and in-memory fallback startup.
  Validate references before applying an import; preserve stable IDs on round trips.

Configuration is read through `RuntimeSnapshot.runtime_config`. The entities above
are populated from database rows, not text-file settings. Writes use
`StateHandle` and the existing configuration write/durability response pattern.
Keep InfluxDB calls outside actor mutations. Return a distinct runtime/persistence
result when saving, consistent with other settings.

## 2. Source adapter and normalized responses

Introduce `server/src/core/sensor_sources/` for source validation, adapters, identity
normalization, discovery, and history. Shared request/response types belong under
`server/src/types/` with generated TypeScript bindings.

The initial source editor supports these fields:

- URL, organization, bucket, optional measurement filter, server-held token.
- One or more identity columns; optional display-name column.
- Metric mappings: external field → stable metric key, display label, unit.
  The first climate widget recognizes temperature and relative humidity; unknown
  numeric metrics remain available in previews without being mislabeled.
- Timestamp, metric, and numeric-value columns for the normalized query result.
- Query window and aggregation defaults, with an explicit discovery lookback.

Start with a form-generated Flux query for the current long-form schema. Its
configuration expresses the existing `device_id`, `tempc`, and `hum` mapping without
making them application defaults. Add a small setup preset that fills field names
as editable examples; URL, organization, bucket, and identities remain user input.

Normalized history response:

```json
{
  "series": [
    {
      "sensor_id": "catalog-id",
      "metric": "temperature",
      "unit": "°C",
      "points": [{ "time": "2026-09-08T10:00:00Z", "value": 21.4 }]
    }
  ],
  "warnings": []
}
```

- Return latest observations separately from aggregated history so current readings
  are not incorrectly presented as a historical window's mean.
- Parse and validate timestamps/numbers; deduplicate exact identity/metric/time
  collisions deterministically. Reject ambiguous identity mappings in preview.
- Keep sensor identity separate from metric identity. Multiple fields become
  metrics of one sensor; different gateways with the same hardware ID stay distinct.
- Represent missing readings explicitly. Units must be configured or supplied by a
  validated mapping; incompatible units cannot share a chart axis silently.
- Safely encode query literals and validate durations and bounds. Bound discovery
  and history requests by timeout, time range, returned rows, and response size.
- Cache by source ID + source revision + identity selection + range/aggregation.
  Editing connection settings or credentials invalidates previous cached results.
- Keep credentials out of widget options, browser bootstrap configuration, query
  strings, logs, and normal GET responses. Source writes support keep/replace/clear
  secret semantics. Environment references can remain references in backups;
  stored credentials require an explicit secret-inclusive backup path.

Advanced saved queries come after the generated-query workflow works end to end.
They are administrator-configured server-side source definitions, with bounded
requests and a documented normalized output contract. They are not arbitrary Flux
submitted by dashboard viewers. Add adapter-specific capabilities and preview
errors; do not promise to support every schema through column renaming alone.

## 3. API and discovery lifecycle

Add focused modules under `server/src/api/config/` and a sensor read API. Proposed
routes (under `/api/v1`):

| Route | Purpose |
| --- | --- |
| `GET/POST /config/sensor-sources` | List redacted source configurations / create source |
| `PUT/DELETE /config/sensor-sources/{id}` | Edit or delete an unused source |
| `POST /config/sensor-sources/preview` | Validate a draft source and preview a bounded sample without saving |
| `POST /config/sensor-sources/{id}/discover` | Explicitly query candidate identities, names, metrics, and latest observations |
| `POST /config/sensors/import` | Persist selected discovery candidates; idempotent by source + external identity |
| `GET /config/sensors` | Persistent catalog with resolved names and source metadata |
| `PUT /config/sensors/{id}` | Rename, link/unlink a homectl device, or archive |
| `GET/POST/PUT/DELETE /config/sensor-groups[/{id}]` | Shared groups and membership editing |
| `POST /sensors/latest` | Latest values for selected catalog IDs, grouped by source on the server |
| `POST /sensors/history` | Normalized history for selected catalog IDs, metrics, range, and aggregation |

Discovery is a preview, not an implicit bulk configuration write. Show existing
and new candidates separately, allow selection, then import. Discovery never
overwrites explicit names, links, or group membership. Imported sensors remain
in the catalog when outside the discovery lookback or temporarily offline.

Use a separate cache for discovery and latest readings. Opening settings should
load the catalog and lightweight latest values, not fetch six hours of history
for every input field. Sensor trend summaries may use one shared bounded request
for the editor; reuse it across every visibility/group picker.

## 4. Settings and widget UI

Add a Sensors settings area with Sources, Sensors, and Groups views.

1. **Sources:** configure connection/mapping → preview recognized sensors/metrics
   and validation errors → save source → discover/import sensors.
2. **Sensors:** searchable catalog, inline display-name editing, optional device
   link, source/identity details, archive action. Show IDs when unnamed.
3. **Groups:** create and rename groups, assign members with selectable sensor
   cards, remove a group without removing sensors.
4. **Widget settings:** select visible catalog sensors and/or shared groups,
   then configure presentation. Source credentials and query-schema fields move
   out of the widget editor.

Extract a shared sensor-card view model and keep `ui/ui/SensorChip.tsx` as the
single renderer for name, current values, stale state, and trends. Settings adds
a checkbox with reserved space at the top left; clicking the card toggles it.
The dashboard makes the same card open details. Both have keyboard focus styling.

Use wrapping flex cards with a minimum width, based on container width rather
than viewport column counts. Selection/group editors never require horizontal
scrolling. Fetch data once in their parent and pass it to cards/pickers.

Widget selection needs explicit semantics:

```json
{
  "sensorSelection": {
    "mode": "selected",
    "sensorIds": ["catalog-id"],
    "groupIds": ["group-id"]
  }
}
```

- `mode: all` means all active catalog sensors. `selected` uses the deduplicated
  union of explicit sensors and group members. Empty `selected` means none.
- Selecting all checkboxes must not silently switch to `all`. A separate All
  sensors option makes automatic inclusion of future sensors intentional.
- Show every selected sensor; remove priority filtering and the five-chip cap.
- Comparison filters use stable group IDs and editable labels. Missing/deleted
  selections are reported in settings, never silently treated as outdoor sensors.
- The weather widget's outdoor-temperature override also references a catalog
  sensor and metric, replacing its hardcoded hardware ID and Influx endpoint.

## 5. Migration and current unfinished work

Before replacing runtime readers, prepare a reviewable conversion of existing
configuration. Leave InfluxDB data and hardware unchanged.

1. Capture the current ID/name mapping as a one-time user configuration import,
   separate from application defaults. Do not embed this household's names in the
   portable migration or retain a second hardcoded fallback table.
2. Convert existing Influx connection/query settings into a source profile. Handle
   widgets with genuinely different connections separately; never merge by URL
   alone when organization, schema, or credentials differ.
3. Import current sensor IDs and aliases, returning the old external-ID → catalog-ID
   mapping. Use it to rewrite widget selections, weather overrides, and group members.
4. Convert indoor/outdoor lists and widget-local custom groups into shared groups.
   Identical memberships may be reused; same-name groups with different memberships
   stay distinct and get distinguishable names.
5. Preserve explicit widget visibility selections. For legacy priority-only widgets,
   materialize their prior visible set once as explicit selection; priority then has
   no runtime meaning. Resolve ambiguous empty legacy selections in the migration
   preview instead of guessing between all and none.
6. Save source/catalog/groups/widget rewrites together using the existing config
   apply/import flow. Verify persistence before removing compatibility endpoints.
   Keep a pre-migration backup for rollback.

The foundation now includes the shared card, catalog API, database-backed group
editing, and generic Influx sensor discovery. Remaining integration work includes:

- normalized source adapters and separate latest/history endpoints;
- stable group IDs in widget selections rather than copied name-keyed options;
- explicit catalog discovery/import and archive/link workflows.

Remove household constants from both `ui/hooks/influxdb.ts` and
`server/src/api/widgets/temp_sensors.rs` after conversion. Replace consumers of
legacy raw rows with generated normalized bindings. Remove sensor credentials
from `UiConfigResponse` in `server/src/api/mod.rs`; coordinate the existing spot
price consumer so its connection remains usable through server-side configuration.
Leave unrelated `.envrc` edits untouched.

## 6. Delivery sequence and acceptance checks

Deliver in small reviewable steps, with compatibility maintained until cutover:

1. **Catalog foundation:** migration, models/bindings, snapshot publication,
   configuration APIs, backup round trips, identity uniqueness and name resolution.
2. **Influx source adapter:** configurable query mapping, bounded preview/discovery,
   normalized latest/history responses and credential handling.
3. **Catalog/settings workflow:** source setup and preview, discovery import,
   renaming/linking, shared group editor and shared sensor-card data loading.
4. **Widget cutover:** explicit selections, shared groups, full selected preview,
   climate history and weather override using catalog references.
5. **Migration and cleanup:** reviewed user-data import, configuration conversion,
   removal of hardcoded tables and obsolete options/endpoints.
6. **Advanced query support:** saved administrator query definitions and mapping
   preview, using the same adapter contract without changing widget components.

Focused regression coverage:

- Same external ID from two sources and composite identities remain distinct.
- Renames preserve history/selection; device-linked names follow overrides correctly.
- Repeated discovery/import creates no duplicates and preserves user metadata.
- An offline sensor remains selectable; stale/missing readings are explicit.
- Alternate organization/bucket/tag/metric names map correctly using fixtures.
- None, all, more than five sensors, overlapping groups, and unknown IDs behave
  consistently across settings, preview, and details.
- Credentials are absent from public configuration responses and request URLs;
  source revision changes invalidate caches.
- SQLite migration and configuration round trip; PostgreSQL coverage for changed
  persistence queries in the existing database test setup.
- One mocked mobile/desktop browser flow: discover → name → group → select → view.
  Check minimum card widths, wrapping, checkbox access, and source-specific data.
- UI typecheck/lint and focused backend tests once per completed slice. Broader
  checks only for failures or changes that warrant them.

No production API or device state changes are required to implement this plan.
Any eventual live verification remains within the user's downstairs/office scope.
