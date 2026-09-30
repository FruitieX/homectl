# Floorplan editor implementation

Updated: 2026-09-30. Approved direction: **docked, collapsible panels**, adapted
for phones. [Design plan](FLOORPLAN-EDITOR-PLAN.md).

## Delivered

- `/config/floorplan` is a viewport-sized workspace. The page and canvas have
  no scrollbars; libraries and inspectors scroll internally.
- Floorplan tabs, New/document actions, unsaved status and Save/Discard are in
  the document bar. On phones, New and Discard are also in the document menu.
- Compact application rail on desktop; existing Settings navigation/assistant
  in the AppBar. Editor tools replace ordinary bottom navigation on this route.
- Separate Devices, Room areas and Walls modes, plus safe Select, Erase, Hand
  and Layout tools. Each mode exposes its relevant catalog and properties.
- Search/type/room filtering, unplaced/placed entries, retained unavailable
  placements, fractional coordinate inputs, marker dragging, related settings
  links and color/brightness previews. Editor gestures never command devices.
- Room masks with brush/rectangle painting and erase, placed-member counts,
  related room links and removal without deleting the group or its members.
- Existing tile materials, brush/line/rectangle, explicit erase and fill-all.
  Arrow keys navigate tiles; Enter applies the selected tool.
- Wheel zoom anchors at the pointer. Middle drag, Space + left drag and Hand
  pan. A gesture's operation stays fixed until release. Phone pinch/pan cancels
  an unfinished paint operation before switching to navigation.
- A completed stroke or marker move is one undo step, with Redo. Save, Discard,
  import and reset clear history while preserving the active mode and selection.
- Fit frames the entire document; view layers and wall opacity remain local.
  Canvas backing pixels follow device-pixel ratio. Repeated tile runs draw as
  spans, and painting copies only affected rows.
- Phone catalogs/properties use one contextual tray. Opening the inspector
  restores a readable scale and keeps its selection above the sheet. New
  documents open Layout on phones. Room labels sit near the top of their masks.
- Background replacement/removal, grid resize with direction and loss counts,
  crop, global marker scale, labels, import/export, reset and document deletion
  remain available. Resize/crop/remove/reset/delete have explicit action labels.
- Existing atomic API, revision checks, shared draft retention, conflict review,
  memory-only warning and read failures/retry remain in use. Unknown layout
  extensions survive edits; unsupported layouts remain downloadable and intact
  during name/image saves. Read endpoints refresh when the editor remounts.

## Follow-up: device snapping and painting shortcuts

Requirements from the subsequent editor feedback are implemented:

- [x] A visible **Snap** control in the editor toolbar offers **Free**, **Grid**
      and **¼ grid**. New placement and marker dragging default to quarter-grid
      precision. The choice is local editor tool state, like the active brush;
      changing it does not edit the saved floorplan.
- [x] **Alt** temporarily bypasses snapping. **Shift** temporarily uses quarter
      cells; Alt wins when both are held. These apply while placing/dragging.
- [x] The placement inspector's **Snap to grid / ¼ grid** action aligns an
      existing device without requiring a drag. Typed coordinates remain exact.
      Snapping is an ordinary draft edit with Undo and explicit Save.
- [x] **F** toggles Brush/Rectangle in Rooms, Walls and Erase modes. **E** toggles
      erase: room areas in Rooms mode, tiles in Walls/Erase mode. Text fields,
      menus, pickers and dialogs keep their normal keyboard behavior.
- [x] Erasing uses a distinct outlined eraser cursor, including room-area erase.
      Pan gestures retain their hand cursor. Sidebar erase reflects room erase
      and does not unexpectedly switch from rooms to destructive tile editing.
- [x] Pending-device previews show the actual snapped placement position.

The desktop/phone native interaction batches cover placement, dragging, exact
coordinates, snap actions, Undo, keyboard mode toggles and erase cursors. Desktop
also covers Alt and Shift while dragging. Existing pan/zoom, painting, persistence
and conflict checks remain in the combined batch. The deliberate conflict case
produces an expected HTTP 409; it does not produce an uncaught UI exception.

The updated editor batch passes **34 checks at each size**, including the phone
pinch/cancel checks and desktop modifier checks. See the
[combined follow-up evidence](implementation-evidence/quick-controls-snapping/)
for captures and logs; a 360 px viewport also fits the snapping toolbar.

## Main files

| Area | Source |
| --- | --- |
| Route, document operations and atomic draft | `ui/app/config/floorplan/page.tsx` |
| Docked panels, tools and phone trays | `ui/ui/floorplan/FloorplanEditorWorkspace.tsx` |
| Canvas rendering and pointer/keyboard gestures | `ui/ui/floorplan/FloorplanEditorCanvas.tsx` |
| Existing grid operations extracted for reuse | `ui/lib/floorplan-editor.ts` |
| Theme-aware editor styling | `ui/ui/floorplan/floorplan-editor.css` |
| Fixed config content and compact save controls | `ui/app/config/layout.tsx`, `ui/ui/settings/EntitySaveBar.tsx` |
| Navigation adaptation | `ui/ui/BottomNavigation.tsx`, `ui/ui/settings/SettingsNavigation.tsx` |

`ui/ui/FloorplanGridEditor.tsx` retains compatibility exports for map/preview
readers. The old scrolling editor component is removed. No new package,
server endpoint, database migration or runtime text configuration is required.

## Verification and screenshots

[Mockup versus implementation gallery](implementation-evidence/floorplan-editor/index.html).
Screenshots use synthetic floorplans on the isolated fixture server, never the
live household configuration. Both editors display the same synthetic
architectural image; actual catalog names, room colors, light states and theme
preferences come from the fixture API. The prototype's study toolbar is absent
from production. The normal shared controls retain touch target sizes.

- UI type check and production build passed.
- Lint passed with one existing warning in `config/import-export/page.tsx`;
  no new editor warnings.
- **256 UI tests passed**, including five grid-operation tests covering
  immutability, masks, fractional crop/placement, resize and unknown fields.
- **70 browser acceptance checks passed**: 21 desktop and 23 phone native
  interaction checks, plus 13 document-journey checks at each size.
  Desktop and phone native browser batches cover wheel zoom, pan versus paint,
  stroke undo/redo, keyboard drawing, placement, fractional persistence, room
  masks, resize and revision conflict review. The phone batch additionally
  checks pinch zoom and cancellation of painting by a second finger.
- Document journeys on both sizes cover image/import staging, retained drafts,
  one atomic save, invalid import recovery, byte-for-byte preservation of an
  unsupported layout, creation, deletion confirmation/cancel and viewport fit.
- Screenshots cover Devices, Rooms, Walls, Layout, panels hidden, phone trays,
  new phone documents and a 360 px viewport. Final captures have no document
  overflow or browser errors. Expected 409/404 logs in the acceptance runs
  come from deliberate conflict/deletion checks, not uncaught UI exceptions.

Run against the isolated fixture UI on `127.0.0.1:3021`:

```sh
node ui/dev/seed-floorplan-editor.mjs
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url 'http://127.0.0.1:3021/config/floorplan?id=ground_floor' \
  --width 1440 --height 1000 \
  --driver-file ui/dev/floorplan-editor-workspace.mjs
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url 'http://127.0.0.1:3021/config/floorplan?id=ground_floor' \
  --width 390 --height 844 \
  --eval-file ui/dev/settings-floorplan-journey.js
```

The seeder and acceptance scripts reject non-fixture endpoints. Fixture actions
change only an in-memory development catalog. These checks do not constitute
physical-device touch testing. No live configuration was changed, so the live
configuration scenario runner is not an applicable gate for this UI change.
