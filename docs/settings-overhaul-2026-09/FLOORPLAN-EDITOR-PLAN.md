# Floorplan editor workspace — Study 06

Status: **design review; production implementation has not started**.
Updated: 2026-09-30.

Request: replace the scrolling `/config/floorplan` form with a proper editor
workspace: a fixed canvas, wheel zoom, deliberate pan gestures, and surrounding
tools/panels/menus. Retain the approved Compact direction and clear draft saves.

## Review artifacts

- [Interactive editor mockup](floorplan-editor.html).
- Docked panels: `floorplan-editor.html?layout=docked&tool=devices`.
- Canvas first: `floorplan-editor.html?layout=focus&tool=devices`.
- Room painting: `floorplan-editor.html?layout=docked&tool=rooms`.
- Layout/background: `floorplan-editor.html?layout=docked&tool=layout`.
- [Screenshot gallery](floorplan-editor-review.html).

Synthetic entities and backgrounds only. The prototype makes no API calls;
Save and Discard affect its local demo state. Reload restores the sample.
The study selector is review tooling and will not appear in the product.

## Decisions to review

Confirmed by the user on 2026-09-30:

- Left-click paints/places with the selected tool; middle-drag or Space +
  left-drag pans. A Hand tool makes left-drag pan.
- Device placement and room areas deserve equal priority.
- Adapt the editor for each screen: fixed canvas with trays on phones,
  panels on desktop.
- Keep separate **Devices**, **Room areas** and **Walls & tiles** modes,
  each with its own relevant controls and fields.

Earlier confirmed preferences still apply: phone and desktop equally matter,
shared save-per-page behavior, useful advanced details and Compact styling.
The outstanding design choice is **docked versus floating panels**. Docked is
recommended as the default; panel collapse can supply a canvas-focused view.

## Workspace

| Region               | Content and purpose                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| AppBar               | Settings → Floorplan breadcrumb, navigation and existing assistant icon.                             |
| Document bar         | Floorplan tabs, add/document menu, unsaved indicator, Discard and Save.                              |
| Tool rail            | Select, devices, room areas, tiles, erase and hand; shortcuts and visible selected state.            |
| Library              | Relevant searchable devices/rooms or layout properties; placement status and filters.                |
| Tool options         | Brush/line/rectangle, material, snap-to-grid or room paint/erase controls.                           |
| Canvas               | Floorplan, background, room overlays and shared color/brightness indicators. No scrollbars.          |
| Inspector            | Selected placement or room mask; editable position, related entity link and remove-placement action. |
| Canvas view controls | Fit, zoom percentage/+/−, view layers and return to normal map.                                      |
| Status strip         | Current tool, brief gesture hint, dimensions and pointer/selection coordinates.                      |

**Docked** is the proposed default: left library and right inspector each scroll
internally, while the canvas has the full remaining space. Collapse either panel
when needed. The navigation reduces to a compact rail in this focused workspace;
there is no repeated form title, description or large settings accordion.

**Canvas first** shows the same controls in floating panels over the canvas.
The canvas itself does not resize when panels open. This is useful for tracing
or smaller desktop windows, but overlays can obscure part of the drawing.
The review compares space and readability; it does not create two unrelated UIs.

On phones, keep a compact document bar and fixed canvas. A bottom tool rail
opens one contextual tray at a time. Selection opens the same inspector content
in a bottom sheet. Reframe the view to keep the selection above the sheet;
opening a sheet does not resize the canvas element. Fit/zoom remain reachable while the tray is closed. Sheet
contents may scroll; the document and canvas never become a long webpage.
The ordinary bottom navigation is replaced by editor tools while editing;
Settings/navigation in the AppBar remains an exit.

## Proposed interactions

- Wheel over canvas zooms around the pointer, with limits and Fit. It never
  scrolls the document. Wheel over a panel scrolls that panel normally.
- Middle drag or Space + left drag pans in any tool. Hand uses left drag to pan.
  The operation chosen at pointer-down remains latched until pointer-up: changing
  modifiers mid-gesture must not start painting.
- Select is safe: click a placed item to inspect; drag a placement to move it.
  Blank space pans in Select. Drawing occurs only in a drawing/room/erase tool.
- Devices: click an unplaced catalog entry, then place on the canvas. A visible
  pending-placement hint and ghost indicate the target. Escape cancels placement.
  Dragging a placed device moves it; clicking its catalog row centers/selects it.
- Rooms: pick an existing room/group, then paint/erase its tile mask with a brush
  or rectangle. Selection and editing apply only to its floorplan area. Room
  membership and names live on the linked room settings page.
- Tiles: choose Floor/Wall/Door/Window/Empty and Brush/Line/Rectangle. The mode
  stays visible next to the canvas. Erase has an explicit tool; right-click can
  open contextual actions rather than being the sole way to erase.
- A complete stroke, device move or area operation is one undo step. Add Redo
  alongside Undo and keep both entirely in the local draft history.
- Phone: explicit paint/place tools, one-finger pan in Hand/blank Select and
  two-finger pan/pinch in all tools. A second finger cancels the current painting
  gesture before navigation takes over. No long press required for core editing.
- Keyboard: V/D/R/B/E/H tools, Space pan, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo,
  Escape cancel/deselect/close tray. Keep keyboard tile navigation and numeric
  placement fields as alternatives to precise mouse/touch gestures.
- Device markers show color and brightness as previews. Editor taps edit
  placement; they do not toggle lights or send simulated sensor events.

## Schema and API mapping

| Existing field/API                             | Editor presentation                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `id`, `name`                                   | Document menu/rename. ID only during creation or with advanced details. |
| `grid_data.width`, `height`, `tileSize`        | Layout panel; dimensions are tiles/pixels, not invented meters.         |
| `tiles: TileType[][]`                          | Drawing tools; current tile kinds and shape operations retained.        |
| `devices: {deviceKey, deviceName, x, y}[]`     | Catalog placement, selection, dragging and X/Y inspector.               |
| `groups: Record<groupId, GridPoint[]>`         | Room area masks; overlays, brush/rectangle/erase and remove-area.       |
| `deviceScale`                                  | Global marker size in layout properties; not a per-device setting.      |
| `labelMode`                                    | Saved label preference in layout properties.                            |
| `image: none/stored/upload`                    | Background section, replace/remove; saved together with layout.         |
| `GET /api/v1/config/floorplans/{id}/editor`    | Read full saved document and revision.                                  |
| `PUT …/{id}/editor`, `expected`, `create_only` | Same atomic draft save and conflict/create handling.                    |
| `DELETE …/{id}/editor`                         | Document menu delete, with existing destructive confirmation.           |
| Existing device/group catalogs                 | Search, placed/unplaced status and related settings links.              |

View zoom, pan, active tool, grid visibility, panel visibility and transient
previews are editor view state, distinct from configuration edits. Only persisted
schema fields mark the document dirty. Any new persistent preference must use
the existing database/API policy; there is no new TOML setting.

Grid resize/growth and Auto crop stay available. Show what would move or be lost
before a destructive shrink. Import/export, background replacement, invalid JSON
recovery and reset move to the document/layout controls, keeping existing
limits and preservation behavior. Unknown layout extensions must survive edits.

## Save and recovery

- One floorplan draft: name, layout and background save together.
- Clear unsaved indicator and grouped Save/Discard actions in the document bar.
  Same action styling as other config pages; no silent autosave of painting.
- Preserve drafts when switching floorplans/pages; surface retained drafts via
  the shared mechanism. Switching tools or selecting an item is not an edit.
- Loading/read failures occupy the canvas or relevant panel with Retry; retain
  draft and catalog selections. Missing devices remain identifiable placements.
- Failed saves retain work. Conflict shows the existing review/reload choices;
  nothing overwrites another editor silently. Memory-only persistence remains
  visible in the shared application warning.
- Removing a placement/room area never deletes its underlying entity.
- Unsupported layout JSON remains downloadable and preserved, with supported
  import/repair options instead of silently resetting the drawing.

## Implementation plan after review

1. Give this route a viewport-sized editor shell through ConfigLayout, retaining
   shared draft warnings/navigation and preventing nested page scrolling.
2. Separate editor state/history and canvas interactions from the current
   stacked form/toolbars. Reuse grid validation, transformations and atomic API.
3. Introduce a single pan/zoom transform and pointer-to-world conversion. Fit
   frames the entire content crisply; use logical coordinates and device-pixel
   ratio for drawing rather than enlarging a low-resolution bitmap.
4. Build tool rail, contextual options, catalog and inspector from shared
   controls. Implement catalog/position/room-mask workflows first, then tiles,
   background/layout and document actions.
5. Reuse inspector/catalog content for mobile sheets. Add gestures and keyboard
   access with cancellation and focus handling. Retain clear device previews.
6. Verify as one meaningful batch: wheel/pan versus paint, placement/move/undo,
   room masks, resize/image/import preservation, save/discard/conflict, and
   fixed viewport on phone/desktop. Capture screenshots against this study;
   commit/push the complete batch.

## Prototype coverage and limits

The interactive study demonstrates separate Devices/Room areas/Walls modes,
tool/panel changes, catalog search/filtering,
canvas selection and placement, placement dragging, sample brush/rectangle edits,
wheel/Hand/Space/middle pan, undo/redo, fit, view layers, local saves and mobile
trays. The rooms and background illustration are synthetic, drawn with SVG.
Room painting is a visual sample of tile masks; document file actions and
recovery controls demonstrate their intended location rather than real imports
or server behavior. Production geometry, validation and recovery remain the
existing schema/API's responsibility during implementation.

## Review verification

- JavaScript syntax check passed.
- A single Chromium interaction batch passed 12 checks: fixed viewport,
  catalog placement, undo/redo, room rectangle as one undo step, pointer wheel
  zoom, middle-pan without paint, discard, numeric placement editing, local
  save and view layers/fit. No browser errors were reported.
- Ten screenshots cover docked/floating desktop, panels hidden, room/wall/layout
  modes and four phone states. Main desktop size is 1440 × 1000; phone is
  390 × 844. A 360 × 780 phone check also passed. Four phone states
  have no document overflow; the placement inspector leaves its selected
  marker visible above the sheet. No browser errors in the final checks.
  Screenshots are of this study, not production.
- The prototype includes two-finger pan/pinch with painting cancellation, but
  physical-device gesture/accessibility acceptance belongs to implementation.
- Read-only name/dimension fields, marker-size location and file dialogs are
  deliberate study placeholders. Export produces only a synthetic placement
  sample; it does not serialize the architectural illustration or visual room
  painting samples. Production must preserve complete existing grid data.
