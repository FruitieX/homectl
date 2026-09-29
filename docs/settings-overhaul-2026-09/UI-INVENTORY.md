# UI inventory beyond settings

Date: 2026-09-29. Source inspection of the current route tree, mounted overlays,
and their shared components. This is a proposed follow-up scope; priorities are
design recommendations. It is not a new visual/browser acceptance report.

## Summary

**Confirmed after Study 05:** room details lead with controls. The dashboard keeps
the existing widget system, adding separate Rooms, Scenes and Indoor climate
widgets based on the mockups. See [the confirmed design notes](EVERYDAY-REVIEW.md).

The biggest remaining opportunity is the everyday control experience: rooms,
devices, scenes, the live floorplan, and dashboard widgets. Several already use
shared primitives and have received functional improvements. They still need a
coordinated pass against the approved Compact design and interaction rules.

The existing settings implementation remains in progress. See
[IMPLEMENTATION.md](IMPLEMENTATION.md) for its outstanding gates; “implemented”
below does not imply that all acceptance work is complete.

## Active pages and shared surfaces

| Priority | Surface / entry point | Current coverage and concrete opportunity | Proposed direction |
| --- | --- | --- | --- |
| High | Rooms / All devices — `/groups` | Search, filters, room previews and power controls exist. Device rows use a generic lightbulb and text; the All devices list already has basic sensor rows alongside controllable devices. | Compact room summaries with on/total and attention counts; color/brightness previews; searchable device rows that represent sensors as well as lights. Keep direct power actions and useful room previews. |
| High | Room details — `/groups/:id` | Uses the live floorplan with `GroupPanel`. Controls, Scenes, Color and Devices occupy four tabs; opening a device introduces another level inside the sheet. Manage room devices currently links to the group list. | Make the usual controls and relevant scenes glanceable together. Include sensor summaries, direct device/configuration links and room-specific attention. Prototype a useful layout when nothing is placed on a floorplan. |
| High | Shared light and group controls — rooms, dashboard, map | `DeviceControls`, `ColorPickerModal` and `DeviceColorTabs` provide overlapping control surfaces. The larger picker has Controls/Scenes/Color tabs and several color submodes. | One consistent control composition with power, brightness and the approved preview ring, clear mixed/off/unavailable states, and capability-aware color controls. Preserve wheel, swatches, image sampling, sliders and temperature where supported. |
| High | Scene selection and capture — dashboard, room/device panels, map selection | `SceneList` is shared, but retains an older scene dialog as well as a settings-editor link. `SaveSceneModal` creates scenes through a separate path. | Compact activation rows with target scope, previews and pending/result feedback. One canonical editor; a quick capture flow that opens a prefilled scene draft for review. |
| High | Dashboard — `/` and `/dashboard` | Layout/widget configuration and arrangement saving were covered by the overhaul. Live widget presentation still uses its own spacing, headings, large rounded cards and gradients. | Apply Compact typography, color and spacing consistently. Establish small/medium/large widget content rules and an intentional phone layout. Make primary values and actions readable without opening details. |
| High, coordinated with rooms | Live floorplan — `/map` and room details | Shares `Viewport`, inspectors, device controls and sensor dialogs. View options include labels, group filtering, entity selection and selection mode; multi-selection exposes Save scene. | Clarify selection and its scope, keep essential actions visible, standardize inspector headers/close behavior, and ensure the phone sheet leaves useful map context. Provide a usable device-list fallback when the map cannot render. |
| Medium | Sensor detail / action panel — map, rooms, settings device detail | `SensorActionPanel` leads with interaction/mapping badges and raw payload JSON, followed by controls. Uses large action buttons. | Lead with the readable value, unit, freshness and relevant actions. Put raw payload/mapping diagnostics under the shared advanced preference. Clearly label commands that send or simulate sensor values. |
| Medium | Car heater timer dialog | Specialized scheduling form in `CarHeaterModal`; reached through device controls, including a hard-coded device-key check in `DeviceRow`. | Compact departure/timer rows, clear enabled and next-run states, consistent add/remove and Save/Discard behavior. Review device association and persistence before changing its UI. |
| Medium | Assistant panel and proposal review | Shared conversation overlay, attachments, streamed replies, plan diffs and light-state action cards already exist. | Align density, headers, entity links and preview rings. Make affected entities, selected changes, apply outcomes and partial failures easy to scan on phones. Keep explicit proposal review. |
| Medium / small pass | Navigation and command palette | Settings navigation and search destinations have already been touched. Main rail, bottom navigation, Navbar and map AppBar remain shared surfaces. | Audit labels, active destinations, entity result destinations, keyboard focus and return context. Keep one title hierarchy and consistent close/back placement. |
| Medium / small pass | Startup, reconnecting, route errors and empty states | Spread across providers, route boundaries and individual views. Unknown routes currently redirect home. | Consistent concise status, retry and recovery actions; visible stale/offline state on controls. Consider a useful not-found page for broken links. Avoid showing a successful-looking empty home while data is unavailable. |

### Important implementation findings

- `SceneModal` sends rename/delete over WebSocket and closes immediately, without
  the new configuration editor's save-result/conflict workflow.
- `SaveSceneModal` also closes immediately after sending. Its capture code copies
  HS color only and otherwise supplies `{h: 0, s: 0}`; temperature/RGB/XY captures
  need semantic correction, not just new styling. It also uses names to identify
  captured targets. Capture should preserve supported state formats and stable
  identity through the canonical editor contract.
- `SceneList` has both an older modal entry and an “Edit in scene settings” action;
  the latter constructs a list URL with query parameters. Verify the destination
  against the new canonical detail route during consolidation.
- `GroupPanel` already uses nested-resolved membership. Room-list counts and Home
  overview counts read `group.device_keys` directly. Check consistent semantics
  against the runtime representation before reusing these summaries everywhere.
- The shared preview ring should represent mixed, unknown and off values honestly;
  a single averaged color should not imply that every selected light matches.
- Existing live controls can persist scene overrides when that preference is
  enabled. The redesigned controls need an obvious explanation of that behavior.

## Dashboard subviews to include

Each information widget includes both its card and any expanded detail overlay.
Refreshing only the dashboard grid would leave much of the experience unchanged.

| Widget / subview | Improvement target |
| --- | --- |
| Home overview | Glanceable room/scene summaries and shared attention counts; intentional overflow instead of silently clipping important content in a small widget. |
| Device controls | Reuse the same compact device row and control sheet as Rooms; previews, availability and consistent configuration links. |
| Helper / mode controls | Clear current value and pending/error state; consistent control treatment for each supported helper type. |
| Clock / calendar / agenda overlay | Consistent hierarchy for current time and upcoming events; compact agenda rows and clear calendar refresh failures. |
| Sensors / climate detail | Value, unit and freshness first; useful trend summaries; clear sensor selection and comparable graph scales. |
| Electricity prices / detail | Current price and units first; compact period summaries, accessible chart inspection and clear missing-data states. |
| Weather / detail | Current conditions plus the next useful forecast; consistent charts and reduced nested panel decoration. |
| Train departures / detail | Dense readable departure rows, delay/platform information where provided, clear freshness and empty/error states. |
| Text, link, image, iframe and custom HTML widgets | Consistent surrounding chrome, sizing, overflow and loading/error treatment. Embedded third-party content has its own styling constraints. |
| Unknown widget fallback | Clear explanation and a direct repair link that preserves the saved definition. |

Shared chart work spans temperature, weather, electricity price, sparklines,
tooltips and time-series interactions. Cover touch inspection, keyboard access,
units, time zone, missing samples and readable text at narrow widths. Keep this a
shared pass rather than independently restyling each chart.

## Interaction rules to carry forward

1. Use Compact spacing, restrained surfaces, consistent button positions and the
   color/brightness preview ring throughout.
2. Live power/brightness/scene commands act immediately, with honest pending and
   failure feedback. Configuration edits use explicit Save/Discard and retained
   drafts. Make existing scene-override persistence clear.
3. Related entities open the right detail view and offer a predictable return
   path. Preserve draft, selection, filters and scroll where appropriate.
4. Use the shared advanced-details preference for useful technical information.
   Device availability and actionable errors remain visible in the ordinary UI.
5. Reuse the backend attention evaluator for summaries; do not introduce separate
   stale-device rules in rooms, widgets and maps.
6. Adapt layout to screen size: compact desktop rows and side panels; labeled
   phone rows/cards and sheets with reachable actions. Keep touch targets usable.
7. Treat overlays as real views: consistent title/close location, focus return,
   keyboard dismissal, scrolling, safe-area space and on-screen keyboard behavior.
8. Any new user-managed preferences or associations belong in the database with
   API support and backward-compatible export/import behavior.

## Existing settings work to finish

These belong to the already-approved plan:

- Calibration: brightness has a new draft/save flow with targeted verification;
  color calibration and assignment controls still need alignment.
- Consolidate the older scene authoring dialogs with the replacement editor.
- Complete field/variant coverage, malformed/legacy repair, concurrency and
  failure cases, and the cross-family keyboard/zoom/accessibility review.
- Finish the acceptance gates recorded in IMPLEMENTATION.md. New layouts should
  reuse this foundation rather than introduce another save/draft system.

## Suggested sequence and prototype brief

1. **Shared controls + room details + scene picker.** These establish the most
   reused interaction patterns. Show desktop and phone; one room with a floorplan
   and one without; a single light, mixed group and unavailable device; normal
   and advanced detail levels. Include scene capture and return from settings.
2. **Dashboard and widget details.** Prototype a realistic populated home, compact
   and larger widget sizes, phone stacking, one sensor detail and one price or
   weather chart. Apply the same patterns across the remaining widget families.
3. **Live floorplan composition.** Reuse the approved controls. Prototype single
   selection, multi-selection and a sensor inspector with the phone sheet open;
   cover floorplan switching and a list fallback.
4. **Specialized dialogs, assistant and final consistency pass.** Timer editing,
   sensor actions, proposal review, search/navigation and recovery screens.

Navigation, overlay and status conventions should be established during step 1
and checked across each later step. Priorities can change with household usage;
no new visual direction needs choosing unless these prototypes reveal a specific
tradeoff.

## Source map and route caveats

- Active route authority: `ui/src/routes.tsx`.
- Global mounts / connection states: `ui/app/providers.tsx`.
- Rooms: `ui/app/groups/page.tsx`, `GroupViewport.tsx`, `GroupPanel.tsx`.
- Shared scenes: `ui/app/groups/[id]/SceneList.tsx` is still actively imported.
- Map: `ui/app/map/Viewport.tsx`, `ui/ui/FloorplanInspector.tsx`.
- Controls: `ui/ui/DeviceControls.tsx`, `ColorPickerModal.tsx`,
  `DeviceColorTabs.tsx`, `SensorActionPanel.tsx`, `SensorActionModal.tsx`.
- Scene dialogs: `ui/ui/SceneModal.tsx`, `SaveSceneModal.tsx`.
- Dashboard: `ui/app/dashboard/`, `ui/ui/DashboardWidgetCard.tsx`,
  `ui/ui/charts/`.
- Assistant: `ui/assistant/AssistantPanel.tsx`, `PlanCard.tsx`, `ActionCard.tsx`,
  `OperationDiff.tsx` and preview components.
- Shared overlays: `ui/ui/primitives/responsive-overlay.tsx`.
- Navigation: `ui/ui/Navbar.tsx`, `BottomNavigation.tsx`, `CommandPalette.tsx`;
  route errors: `ui/src/RouteErrorScreen.tsx`.

`/settings` redirects to configuration settings. `/` and `/dashboard` share one
page. Room detail is `GroupViewport`, not the old `[id]/page.tsx`. No active
import was found for the old room page or `ColorPickerTray`; treat those as
cleanup candidates after a final reachability check, not extra redesign views.
Car heater, agenda, forecasts, price details and sensor details are overlays,
not separate routes.
