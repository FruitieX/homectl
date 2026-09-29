# Implementation compared with the approved mockups

Status: in progress, 2026-09-29. Functional acceptance does not replace visual
acceptance. Compare desktop (1440 px) and phone (390 px), using representative
fixture data. Differences in fixture content are not missing UI features.

The ordered remaining tasks and completion criteria are in
[WORK-QUEUE.md](WORK-QUEUE.md).

## Confirmed priorities

- The approved Compact **Study 04 complex routine** is the strongest reference.
  Its desktop board has three columns: When, Only if, Then. Earlier two-column
  studies are superseded. Phone uses the same structure vertically.
- Room controls lead; floorplan previews should be available on room cards and
  room details. Inspect dashboard room cards too: the user reports missing
  previews in all three locations and may be running an older build.
- Rebuild New widget: visual type selection, understandable layout controls,
  and a preview before creating. Keep drafts and explicit Create/Save.
- Compare other views and correct material inconsistencies without requiring
  pixel-perfect copies. Preserve useful improvements in the implementation.

## Findings and corrections

| View | Screenshot finding | Correction / acceptance |
| --- | --- | --- |
| Routine desktop | First two lanes stacked; generic select headings; optional scene controls dominate nodes | Restore three-column connected board, compact icon headings, dotted background, secondary target/timing options with visible summaries |
| Routine complex branches | Needs a representative branch/timer fixture rather than only a simple scene action | Compare nested conditions, two branches, timers, scene references, script actions and visible reordering at both sizes |
| Room details | Basic composition exists, but scene cards and bordered device rows consume space; no inline desktop brightness controls | Use compact scenes and divided device rows; preserve direct controls and add Save as scene |
| Room previews | Local room detail renders a canvas, but failures can silently remove previews; module cache can preserve unavailable grids indefinitely | Reliable preview rendering and refresh after floorplan edits; verify rooms list, details and dashboard |
| New widget | Native Type select and raw grid fields; no preview | Visual gallery, size presets, visual placement, responsive read-only preview reflecting the draft; custom dimensions remain available |

## Evidence

Open the [screenshot comparison gallery](implementation-evidence/comparison/index.html)
for mockup/before/current views. Routine captures were refreshed after replacing
nested condition cards with compact rows and correcting control alignment.
The desktop fixture includes additional real schema fields and an unavailable
helper, so it is longer than the illustrative mockup. Phone retains full touch
targets and stacks fields when a nested branch becomes too narrow.

Routine verification: seven structural checks at desktop and phone sizes,
21 editing checks at both sizes, five whole-script conversion checks, and
214 UI unit tests pass. The custom condition selectors preserve the same model;
group scene values use prefixed options so “Any scene” cannot collide with an ID.

Original paired screenshots are in `implementation-evidence/comparison/`:

- `routine-desktop-mockup.png` / `routine-desktop-before.png`
- `room-desktop-mockup.png` / `room-desktop-before.png`

The room screenshots use different devices/sensor assignments; assess layout
and interaction rather than interpreting different readings as missing features.
Add final screenshots and results only after reviewing the rendered output.

## Completion gate

- [x] Routine desktop and phone match the approved structure, including a complex definition.
- [x] New widget can be chosen, configured, previewed and created without raw layout fields.
- [x] Floorplan previews appear consistently for placed rooms in all intended locations.
- [ ] Room controls, scenes, map inspectors and dashboard have been compared.
- [ ] Keyboard and phone interaction checks pass; no accidental commands from previews.
- [ ] Corrections are committed and pushed in verified checkpoints.

## Floorplan and shared settings review — 2026-09-29

The tall 24 × 32 fixture now fits both canvas dimensions. Reviewed desktop and
phone captures show readable labels and color/brightness markers at Fit. Native
mouse/touch checks cover placement, drag, zoomed movement, cancellation, undo and
explicit persistence. Room thumbnails now use disabled slashes and attention dots
consistent with the interactive map; full map inspector acceptance is still open.

The phone Widget sources capture shows compact, single shared-color dividers.
Browser checks confirm the autocomplete result inset and separator geometry.
Sensor keyboard journeys verify catalog/group/member ordering and dashboard/chart
propagation, including independent explicit widget order.

## Rooms and dashboard comparison — 2026-09-30

Reviewed Study 05 desktop/phone room, room-list and home references against new
rendered captures. Current room details retain the two-column controls/conditions
composition on desktop, stack it on phone, use a wrapping scene strip and embed
a framed map. Climate uses real source units, timestamps and a precise history
plot; the fixture deliberately lacks humidity. List cards now pair floorplan and
climate summaries. Dashboard still respects configured widget sizes rather than
forcing the illustrative home layout; a separate compact-widget capture verifies
that the name, power control and preview remain usable. Attention is bounded to
the count and first issue until expanded.

The wider floorplan fixture exposed a phone minimum-width bug despite the earlier
tall-plan Fit passing. The wrapper now allows its grid column to shrink. Browser
checks prove saved placements reach all preview locations; failed catalog and
grid reads recover without requiring a wall dashboard to reload.

Sixteen checks per viewport pass; current screenshots and logs are linked in the
gallery. Map inspector comparison and the broader cross-view audit remain open.
