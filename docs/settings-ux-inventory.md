# Settings UX inventory (Phase 0)

Companion to [`settings-ux-redesign-plan.md`](settings-ux-redesign-plan.md). This records what
exists today so the migration preserves semantics. Compiled by inspection of `ui/` on the
`settings-ux-redesign` work; refresh it if a page changes shape before it is migrated.

## Route map: today → target

| Today | Target | Notes |
| --- | --- | --- |
| `/config/routines` (+ `?new=1` overlay, `?routine=` list links) | list `/config/routines`; detail `/config/routines/:id`; create `/config/routines/new` | `new=1` becomes the `/new` route with replace navigation |
| `/config/scenes` (+ `?new=1`, `?scene=<id>`, `?device=<key>`) | list `/config/scenes`; detail `/config/scenes/:id`; create `/config/scenes/new` | `scene=` → detail route; `device=` keeps working as a list filter/prefill |
| `/config/groups` | list `/config/groups`; detail `/config/groups/:id` | `?q=` list filter unchanged |
| `/config/integrations` | list; detail `/config/integrations/:id` | overlay editor replaced |
| `/config/helpers` | list; detail `/config/helpers/:id` | value editing moves beside the value |
| `/config/sources` | list; detail `/config/sources/:id` | preview stays on the detail page |
| `/config/devices` (+ `?device=<key>`, `?q=`) | list; detail `/config/devices/detail?key=<encoded device key>` | device keys contain `/`, so the key is a query parameter |
| `/config/floorplan`, `/config/settings`, `/config/diagnostics`, `/config/routine-history`, `/config/logs`, `/config/import-export`, `/config/migration` | unchanged URLs | interior layout work only; settings keeps independent per-card saves |

`ConfigLayout` (`ui/app/config/layout.tsx`) already renders the memory-only and failed-write
warnings; keep those banners as the single global notice and do not repeat them per section.

## Mutation contract (preserve exactly)

All config CRUD goes through `useConfigApi<T>(endpoint, keyInBody?)` in `ui/hooks/useConfig.ts`:

| Action | Request | Notes |
| --- | --- | --- |
| list | `GET {api}/api/v1/config/<endpoint>` | `data` is the array |
| create | `POST {api}/api/v1/config/<endpoint>` | body is the item; `keyInBody` endpoints send the id in the body instead of the path |
| update | `PUT {api}/api/v1/config/<endpoint>/<id>` | `keyInBody` endpoints `PUT` the base endpoint with `device_key` in the body |
| delete | `DELETE {api}/api/v1/config/<endpoint>/<id>` | `keyInBody` endpoints send `{ device_key }` |

Responses use the envelope `{ success, data?, error?, write? }` where
`write: ConfigWriteStatus = { applied, persistence, warning }`. Every successful mutation calls
`recordWrite(key, write)`, which feeds the global "Recent changes were not saved" banner; a
section save must keep doing that. `useConfigApi` invalidates `['config', baseUrl, endpoint]`
after a successful mutation, so a section Save must go through it (or invalidate the same key).

Endpoint hooks: `useGroups`, `useScenes`, `useRoutines`, `useSources`, `useHelpers`, `useIntegrations`,
`useConfigDevices` (`config/devices`, `keyInBody`), `useFloorplans`, `useDeviceDisplayNames`,
`useDeviceColorCalibrations`, `useDeviceSensorConfigs`, `useCalibrationProfiles`,
`useCalibrationAssignments`, `useConfigExport`, `useLogs`, `useRoutineHistory`, `useRuntimeStatus`.

Extra mutations that are **not** config CRUD and must stay on their current paths:

| Surface | Action | Request |
| --- | --- | --- |
| Scene Activate | immediate command | `POST {api}/api/v1/commands/scene` |
| Device state command (sensor actions, controls, enabled toggle) | immediate command | `PUT {api}/api/v1/devices/<device id>` (sensor catalog: device config `PUT`) |
| Helper value | immediate value write | `PUT {api}/api/v1/config/helpers/<id>/value` |
| Routine what-if preview | preview | `POST {api}/api/v1/config/routines/preview` |
| Routine schedule preview | preview | `POST {api}/api/v1/config/routines/schedule-preview` |
| Source preview | preview | `POST {api}/api/v1/config/source-preview` (also `/config/source-preview` variants) |
| Calibration | session lifecycle | `POST/DELETE {api}/api/v1/config/calibration-sessions[...]`, `PUT {api}/api/v1/config/calibration-assignments` |
| Core / assistant settings | independent saves | `PUT {api}/api/v1/config/core`, `PUT {api}/api/v1/config/assistant/settings` |
| Floorplan canvas | layout writes | `POST/DELETE {api}/api/v1/config/floorplan/{grid,image}`, `PUT/DELETE {api}/api/v1/config/floorplan/groups/<group>` |
| Import / export / migrate | explicit file actions | `POST {api}/api/v1/config/{import,replace,delete}`, `{api}/api/v1/config/migrate/{preview,apply}` |
| Assistant | threads/plans/actions | `POST/DELETE {api}/api/v1/config/assistant/{chat,draft,plan,threads,plans,actions}[...]` |

## Per-screen inventory

| Screen | List surface | Editor surface today | Deep links | Duplicate surface to retire |
| --- | --- | --- | --- | --- |
| Routines (1658L) | cards with runtime status | fullscreen overlay, `CreateRoutineModal`, `v2-routine-summary` read block + a second set of editor disclosures + "Build & preview" tab | `?new=1` | detail page keeps one When / Only if / Then; overlay and duplicate disclosures go |
| Scenes (1070L) | cards + target summary + resolved color preview | fullscreen overlay with 4-tab editor and permanently open target forms | `?new=1`, `?scene=`, `?device=` | detail page with sections; overlay goes |
| Groups/rooms (636L) | cards, device picker, linked-group picker | fullscreen overlay with tabs (visibility/members/links) | `?new=1` | detail page with Devices + Linked rooms sections |
| Devices (2082L) | list with `?q=`, `?device=` | 12 tabs: State / Runtime / Config / Actions / Technical | `?device=<key>` → detail route | tabs replaced by status header + Live controls / Reports / Display & sensor / Technical |
| Integrations (1906L) | cards with schema-driven form, conditional fields, JSON mode | fullscreen overlay | `?new=1` | detail page: Primary settings → schema groups → advanced/JSON |
| Helpers (759L) | cards, `ValueControl`, `HelperEditor` | overlay editor + separate value editor | `?new=1` | detail page where value is immediate and definition is sectioned |
| Sources (857L) | cards with live value, preset picker | overlay `Tabs` editor + preview | – | detail page: output → computation → preview → advanced |
| Settings (1040L) | `Tabs` (appearance/behavior/assistant/about) | per-card autosave, independent `PUT`s | `?tab=` | keep categories; move limits and build facts behind disclosures |
| Floorplan (870L) | canvas + toolbar + instructions | canvas dialogs | – | canvas stays; settings move to a secondary menu |
| Diagnostics (211L) | issue list | – | – | add "Open item" links to detail sections |
| Routine history (777L) | entries with truth labels | – | – | blocked-attempt entries (Phase 4, server model) |
| Logs (244L) | filtered log rows | – | – | unchanged structure, disclosure for raw payload |
| Import/export, migration (246L, 651L) | explicit confirmation flows | – | – | unchanged |

Empty/loading/error states exist per screen as `Skeleton`/`EmptyState`/`Alert`; the shared detail
shell standardizes them (loading skeleton, retryable load error, "no longer exists" state).

## Fixtures

`ui/dev/fixture-server.mjs` serves these fixture sets for visual and behavior checks (see its
header for how to run it against the dev server): `empty`, `normal`, `large` (300 devices, a
deeply nested routine, a scene with many targets), and `degraded` (broken reference, offline
device, stale report, failing list request). Fixtures are development-only and are never
runtime defaults.

Run the UI against fixtures (writes land in the fixture server's memory, never anywhere else):

```sh
node dev/fixture-server.mjs --port 45901        # terminal 1
HOMECTL_DEV_PROXY_TARGET=http://127.0.0.1:45901 pnpm dev --port 3011   # terminal 2
```

`HOMECTL_DEV_PROXY_TARGET` does two things: it points the dev-server proxy at that backend, and
it makes `vite.config.ts` blank `API_ENDPOINT` so the app issues same-origin requests. Without
that second part `ui/.env` keeps the app talking to the deployed instance behind the proxy's
back — reads look plausible and writes go to production.

For browser checks use `ui/dev/cdp-probe.mjs` (screenshot + `--eval` against an already-running
CDP browser, no extra dependency). It reports console errors and flags any non-localhost
mutating request as a problem.
