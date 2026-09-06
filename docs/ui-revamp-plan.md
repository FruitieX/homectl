# homectl UI revamp plan

Status: implementation started, September 6, 2026. The first delivery is described below; the remaining sections retain the overall target design.

## First delivery

Implemented the shared device power/brightness controls, complete room detail route, searchable Rooms/All devices overview, and visible device/scene detail actions. Dashboard control widgets now retain configured ordering and no longer silently truncate at six devices. Existing overview widgets render compact scenes and room links; dashboard layouts remain intact.

Device panels put power and brightness first and retain the existing advanced color tools under Color options. Desktop panels are nonmodal and allow selecting another device. Group power changes preserve each device's color and brightness, including its color representation, and shared controls retain the existing scene override mode. Brightness appears only when a brightness value is supplied, since the current capability type lacks an explicit dimmable flag.

Applied a quieter shell, solid card surfaces, smaller headers, simpler Settings navigation, browser zoom support, and removal of decorative greetings, ambient effects, and the unconditional green status dot. Kept the existing special car-heater details flow and whole-home off shortcut.

Validation: `pnpm tsc`, `pnpm lint`, and `pnpm build` pass. An isolated Playwright fixture passed room navigation, state-preserving individual/group power, desktop inspector target switching, keyboard brightness commit, empty rooms, device search, disconnected controls, and an eight-device dashboard ordering check. Reviewed 360px phone and 1440px desktop screenshots in light/dark themes. No test commands were sent to household devices.

Still outstanding: dashboard editing in place and independent favorites widgets; floorplan toolbar consolidation and list fallback; full-page scene/routine editors and complete creation drafts; global search; capability-specific temperature controls; richer sensor history/units; pending-command reconciliation; broader accessibility/performance and migration coverage. This delivery does not complete all six phases.

## Outcome

Make homectl a comfortable daily control interface: favorite actions are immediate, room controls are complete, and advanced configuration stays easy to find. Keep the configurable dashboard, floorplan, charts, scene links/scripts, and automation capabilities.

Design for phone use first, with layouts deliberately adapted for desktop and wall displays. Prefer stable positions and explicit favorites over automatically reordered content.

## Review evidence and limits

This plan is based on source inspection and recent commit history, not a rendered-browser usability test. Validate spacing, touch interactions, contrast, and performance with realistic fixtures before treating visual proposals as final.

| Current implementation | Consequence | Proposed change |
| --- | --- | --- |
| `app/dashboard/HomeOverview.tsx`: large greeting, decorative metrics, alphabetically selected scenes/rooms | High-value controls compete with introductions and arbitrary selections | Smaller independent widgets, explicit favorites |
| `app/dashboard/ControlsCard.tsx`: six-device truncation, context-menu details, hardcoded heater special case | Chosen devices disappear; details are hard to discover; controls do not generalize | Shared device controls, explicit details action, configured device behavior |
| `src/routes.tsx`: `GroupScenesRoute` renders only `SceneList` | A room cannot serve as its own device control page | Complete group/room detail route |
| `ui/ColorPickerModal.tsx`: defaults to Wheel; fixed-height content; scene autosave under nested settings | Routine adjustments compete with advanced color tools; scene persistence is easy to overlook | Capability-aware device panel with primary controls first |
| `ui/primitives/responsive-overlay.tsx`: desktop sidepanel retains Dialog root and hides overlay | Appearance alone does not establish a nonmodal inspector | Separate inspector and modal editor contracts |
| `app/map/Viewport.tsx` and `ui/FloorplanControlPanel.tsx`: several independent floating panels | Competing controls obscure the map, especially on small screens | One toolbar and contextual selection controls |
| `app/config/scenes/page.tsx` and `routines/page.tsx`: creation saves an identity shell before editing content | Creating a useful item requires reopening it | One complete draft and one save |
| Configuration lists use large `ExpandableConfigCard` overlays | Extensive editing has weak navigation context and little room | Compact lists with routed editors |
| `ui/BottomNavigation.tsx`: static green rail dot; status repeated elsewhere | Decoration resembles operational status | One truthful connection/status component |
| `index.html`: zoom disabled | Users cannot freely enlarge the interface | Restore browser zoom; restrict gesture handling to the map |

The active entry path is `index.html` → `src/main.tsx` → `src/app.tsx` → `src/routes.tsx`. Some Next-style files remain but are not active route entry points. Implement against the active router.

## Navigation and page responsibilities

Use four primary destinations: **Home, Rooms, Floorplan, Settings**. Retain existing URLs initially; changing labels does not require breaking bookmarks.

- **Home:** fully configurable widgets, favorite devices/scenes, chosen information, and Edit dashboard. No mandatory greeting or overview. A compact layout selector appears only when multiple layouts exist.
- **Rooms:** controllable group overview, search, and an All devices view for devices outside visible groups. Keep technical groups supported: nested collections and cross-room groups must not be falsely treated as physical rooms. Initially retain the existing visible-group membership model; add explicit room classification only if needed.
- **Floorplan:** spatial controls using the same device/group interactions as Rooms. Editing the drawing is a separate mode reached by an explicit action.
- **Settings:** Devices, Groups, Integrations, Scenes, Routines, Appearance, Dashboard, Floorplans, and a System section for logs, history, backup, migration, and runtime configuration. Use concise section lists and desktop secondary navigation. Routine history is also linked from each routine.

Scenes remain accessible from Home and Rooms for activation. Configuration routes manage their definitions. Do not require a visit to Settings to run a scene.

Desktop navigation uses icon-and-label rows, with Settings at the bottom. Mobile keeps four labeled bottom items. Use a compact page header with title, optional breadcrumb/back link, and relevant actions. Wall display mode hides configuration chrome and remembers its chosen dashboard; exiting remains discoverable.

Add a visible Search action that finds devices, groups, and scenes, with a desktop keyboard shortcut. Initially selecting a result opens its controls. Keep global search after the core room/device work, and retain local search in large lists.

## Visual specification

Aim for a restrained, warm interface with clear typography and enough density to scan a home quickly.

- Retain the green accent, but use neutral warm light surfaces and neutral charcoal dark surfaces. Avoid tinting every layer green.
- Solid surfaces by default; shadows mainly establish overlay elevation. Remove ambient blobs, decorative gradients, hover lifting, and stacked translucent cards.
- Begin with 16px body text, 14px supporting labels, and 20–24px page titles. Avoid tiny uppercase status text and tightly tracked headings. Validate at enlarged text sizes.
- Use an 8px spacing rhythm, 12–16px card padding, and a small radius scale: approximately 8px controls, 12px cards, 16px overlays. Compact content without shrinking touch targets below a 44px design target.
- Use color for meaning: on/selected, warning, failure, or a light's actual color. Always accompany state color with readable text or a clear control state.
- Icons reflect capabilities or configured roles. A heater should not appear as a desk lamp. Technical IDs belong in details and searchable metadata, not every row.
- Limit motion to short state transitions and opening/closing panels; honor reduced motion. Keep chart palettes consistent across widgets and detail views.

Prototype the Home screen, room detail, and device panel together in light and dark themes before propagating tokens through the entire app.

## Everyday controls

### Shared device row and panel

A row contains a meaningful icon, name, concise current state, and a separate power control where supported. Tapping the name opens details; power controls toggle without navigation. Right-click/long-press can remain shortcuts but must not be the only entry to an action.

The panel order is:

1. Name, room/group context, power, and any pending/error state.
2. Brightness for dimmable devices, with an accessible numeric value.
3. White temperature and saved colors when supported. The full wheel, image sampling, and numeric color tools live under More color options.
4. Applicable scenes, with scope explicit: this device, this room/group, or the full scene.
5. Current scene/link information and an explicit Save as scene action. Surface existing scene autosave/override mode beside the primary controls when active.
6. Device settings and diagnostics links.

Use capability data to hide irrelevant controls. For mixed selections, show mixed power/value states and specify which devices a control affects. Never silently imply that every member supports dimming or color.

Keep live adjustments and persistent scene edits clearly distinguished. Audit existing `ToggleDeviceOverride` and scene-link behavior before changing labels or defaults; do not change automation semantics as part of visual cleanup.

Desktop: a nonmodal inspector allows switching between devices while it is open. Mobile: a bottom sheet for short controls, expanding or routing to a full page for long content. Avoid nested scrollers with fixed heights. Sensor details lead with the reading and unit, then history; configured sensor actions remain available explicitly.

### Rooms and groups

Overview cards show name, a concise state such as “2 of 5 on,” optional chosen sensor readings, and direct group power controls. Compact previews are optional and must not reserve blank space when no floorplan exists. Add All / On filters and search; preserve configured order.

Room detail contains group power and supported brightness, pinned/relevant scene buttons, individual device rows, and sensor readings. Expand charts on demand. A group without scenes must still be useful. Explain mixed state and show missing devices without making them look off.

Initial layout sketch:

```text
‹ Rooms        Living room                 ⋯
2 of 5 lights on                   [On] [Off]
Brightness             ──────●──────    60%

Scenes       [Evening] [Reading] [More]

Devices
Floor lamp          60%                  [On]
Ceiling             Off                 [Off]
Desk lamp           40%                  [On]

Temperature       21.5°C             History ›
```

These example readings are illustrative, not live project data.

### Home and dashboard editing

Keep every content section optional. Add standalone Scenes and Rooms widgets and reuse the shared device controls. Respect configured membership and ordering. If a compact widget has a display limit, show an explicit total and Show all; never silently discard configured devices.

Edit dashboard operates on the actual dashboard using the same renderer. Support add, move, resize, duplicate, and remove; provide move buttons as an alternative to dragging. Widget configuration uses searchable device/group pickers rather than comma-separated keys. Show a phone/desktop preview where layout behavior differs.

Use a draft with Save/Cancel for layout edits. Failed saves retain edits. Existing grid APIs may require a commit strategy or server batch endpoint to make a whole-layout save atomic; inspect this before promising transactional behavior. Preserve existing layouts and unknown widget options.

For a new empty installation, offer a previewed starter layout or Start empty. Do not replace an intentionally empty existing layout. Persist selected layout locally; shared widget order and favorites belong in stored dashboard configuration.

Charts lead with the current useful value and unit; show detailed history on demand. Each widget handles its own loading/error state and retry so one unavailable data service does not disable home controls. Keep weather, prices, trains, clocks, and sensor widgets available.

### Floorplan

Use one compact toolbar: floor selector, All/Lights/Sensors filter, fit view, and selection mode. Hide a redundant floor selector when only one floor exists. Put gesture help behind Help or a dismissible first-use hint.

Device tap opens the shared inspector; group tap opens group controls. Provide explicit multi-select mode in addition to long-press shortcuts. During selection, show one contextual bar with On, Off, Adjust, Save scene, and Clear. Remove duplicate selection actions from other bars.

Desktop inspector should reserve or account for space when fitting the map and remain nonmodal. On mobile, a partially expanded sheet preserves map context. Retain keyboard-accessible device selection through a synchronized list; make that list available when WebGL cannot render.

## Configuration workflows

Use consistent searchable lists with name, useful status/summary, and a small action menu. Desktop can use denser tables where comparison helps; mobile uses rows. Preserve filters, selection, and scroll position when returning from an editor.

Route substantial editors so Back, refresh, and direct links work. Keep short rename/confirmation dialogs. Save/Cancel stays visible; validation appears by the affected field; failed saves preserve the draft. Warn on leaving unsaved configuration, not on ordinary device toggles.

- **Scenes:** create name, target selection, and states in one draft. Offer Save current room state. Group target editors reuse the device control primitives. Place links, scripts, and transition/rollout options in advanced sections. Distinguish preview from actually applying a scene to the home.
- **Routines:** create name, conditions, and actions in one draft. Present a readable rule/action summary using existing summary helpers. Keep all/any nesting and trigger modes faithful to the engine; do not invent a separate trigger model in the UI. Offer explicitly labeled Run now and recent execution history. A dry-run/test function requires confirmed backend support and must never secretly execute actions.
- **Devices:** direct links from control panels to settings. Put display name, membership, and configured behavior first; raw payloads, replacement, and deletion under diagnostics/advanced actions. Reuse display-label helpers everywhere.
- **Integrations:** show connection/lifecycle status only where the backend exposes it, then name and type. Put plugin-specific fields behind an explicit configure action; preserve advanced raw configuration access.
- **System:** retain actionable persistence warnings and backup controls. Show impact for deletion/replacement, use consistent confirmation dialogs, and retain the draft or selection after failures.

## Shared implementation and data needs

Keep React Router, Tailwind, Radix, Jotai, React Query, existing charts, and Pixi. A framework rewrite is unnecessary.

Create or consolidate `AppShell`, `PageHeader`, `DeviceRow`, `DeviceControls`, `GroupControls`, `SceneButton`, `ConnectionStatus`, `EntityPicker`, `EditorPage`, and a dedicated nonmodal `Inspector`. Use the same domain action helpers from Home, Rooms, and Floorplan.

Centralize power/brightness/color/scene dispatch and feedback. Current direct WebSocket sends do not establish physical-device acknowledgement. Distinguish command submission, runtime state observation, and hardware confirmation; do not label a sent command as confirmed. Prevent stale responses from overwriting a newer user adjustment. Test rapid toggles and the final value after slider release.

Use existing capabilities, state-source data, groups, scenes, and routine histories where available. Inventory gaps before adding models:

- Shared favorites/order can initially use widget options; global room order or room classification may require new configuration fields.
- Per-device freshness/availability and physical acknowledgements are not guaranteed by the inspected Device type. Show unknown honestly; add backend support only if needed for the promised UI.
- Complete scene/routine creation should use existing create payloads if supported; verify validation and atomicity.
- Migrate/decompose existing Home Overview widgets with an explicit, previewable conversion or compatibility renderer. Do not delete existing layouts or silently replace content.
- Keep `state_source` explanations limited to what the data proves; a scene link alone does not explain the entire history of an automation decision.

No global “all off” scope should be inferred from all controllable devices. Make broad shortcuts use a configured group or scene and label the scope clearly.

## Delivery sequence and completion criteria

| Phase | Deliverable | Completion criteria |
| --- | --- | --- |
| 1. Prototype and foundations | Realistic fixture home; three representative screens; shared tokens and shell | Review phone, desktop, wall display, light/dark, long names, mixed states; controls visible before decorative content |
| 2. Device controls and Rooms | Shared capability-aware panel, real room detail, direct group/device actions | Favorite toggle takes one tap; brightness is immediately available after opening details; group with no scenes works; keyboard can reach every action |
| 3. Home | Favorites widgets and dashboard edit-in-place | No silent truncation; selected layout persists; order remains stable; layout draft survives failed save; existing configuration loads |
| 4. Floorplan | Consolidated toolbar, inspector, explicit selection | Device selection can change with desktop inspector open; no overlapping toolbars on narrow screens; list alternative works without WebGL |
| 5. Configuration | Compact lists, routed editors, complete create flows | Create and save a useful scene/routine without reopening; Back restores list context; errors retain drafts; advanced features remain supported |
| 6. Finish and migration | Search, consistent charts, compatibility cleanup, accessibility/performance verification | Existing links/layouts survive; common journeys pass across input methods; no unrelated UI rewrite remains necessary |

Each phase should leave a usable app and land independently. Apply shared components to one complete workflow before spreading them across every page. Phase 1 includes visual review; later phases include their own interaction checks rather than deferring all verification to the end.

## Validation plan

Use an isolated dummy/fixture environment for interaction testing, without sending trial actions to household devices. Include empty setup, a small home, a larger home with nested groups and long names, mixed-capability selections, missing devices, disconnected transport, and failed configuration saves.

Check at representative widths of 360px, 768px, and 1440px, plus landscape wall display and enlarged text. Confirm browser zoom, focus visibility/restoration, screen-reader control names, slider keyboard input, non-color state cues, reduced motion, and touch scrolling.

Automate meaningful journeys: toggle and observe pending/state behavior; adjust brightness while receiving updates; activate a room-scoped scene; switch inspector target; reconnect without replaying stale commands; edit a dashboard and recover from save failure; create/edit a complete scene and routine. Add targeted tests for shared command ordering and draft persistence where needed.

Run `pnpm tsc`, `pnpm lint`, and `pnpm build` for implementation changes. Add Rust tests and regenerate bindings for actual API/configuration changes. Measure control feedback and layout stability with realistic data; visible feedback should start immediately, while network/device latency must remain distinguishable from UI delay.
