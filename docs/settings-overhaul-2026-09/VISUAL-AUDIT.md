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
- [ ] New widget can be chosen, configured, previewed and created without raw layout fields.
- [ ] Floorplan previews appear consistently for placed rooms in all intended locations.
- [ ] Room controls, scenes, map inspectors and dashboard have been compared.
- [ ] Keyboard and phone interaction checks pass; no accidental commands from previews.
- [ ] Corrections are committed and pushed in verified checkpoints.
