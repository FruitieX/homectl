# Assistant floorplan sizing and renderer isolation

Implemented 2026-09-30 after the user reported a cramped assistant floorplan
preview and the main floorplan disappearing when the assistant closes.

## Layout

- Desktop assistant dialogs now allow **1280 px width**, with height limited by
  the visual viewport and a 64 rem cap instead of 44 rem.
- Light-action and configuration-plan previews share the same responsive
  sizing: 16 rem on phones, and a desktop height of 42% of the viewport, bounded
  between 20 and 35 rem. This replaces the action preview's 8 rem strip and the
  plan preview's 14 rem height.
- The conversation scrolls independently; the composer stays reachable.
- The embedded previews hide every label layer — lights, sensors and rooms — at
  both sizes and regardless of the saved floorplan label settings: the map is
  too small for label text, and the affected-device/entity list below names the
  entities. Highlighted markers and color/brightness previews stay.
- The light-action card's affected-device detail starts **collapsed**; the
  header still reports the applied/failed summary, and expanding it reveals the
  per-device rows and checkboxes.

## Disappearing main floorplan

`PixiFloorplanRenderer` previously called `Application.destroy(true, …)`.
In the installed Pixi version, that boolean also releases **global resource
pools**, shared by the live map and other previews. Closing one preview could
therefore break a renderer that was still mounted.

Cleanup now explicitly removes only that renderer's view and disables global
resource release. It still stops its ticker, destroys its own scene and renderer,
and releases its own WebGL context to avoid accumulating unused contexts.

## Verification

Type checking, lint and the production build pass, with the existing lint/build
warnings. Native Chromium review uses isolated synthetic fixtures at
**1920 × 1080** and **430 × 932**, covering both proposal types, viewport bounds,
composer visibility, preview size and closing the assistant over the live map.
The same batch asserts that the affected-device detail starts collapsed (with no
device rows rendered), expands to name its devices, and collapses again, and it
captures both previews for the label check (saved label settings enable every
layer). The main canvas remains mounted, keeps drawing, has no context loss and
sees zero global-pool releases. No configuration or device writes occur.

A negative-control browser run forced the old boolean cleanup at runtime. It
reproduced the blank main map, an uncaught rendering error, stalled draw calls
and four global-pool releases. The fixed cleanup passes the same browser journey.

Reproducible driver: `ui/dev/assistant-floorplan-review.mjs` through the existing
CDP probe, against the guarded loopback fixture on port 3021.

[Screenshots and browser results](implementation-evidence/assistant-floorplan/).

[Desktop preview](implementation-evidence/assistant-floorplan/desktop-action.png) ·
[Phone preview](implementation-evidence/assistant-floorplan/phone-action.png) ·
[Broken map with old cleanup](implementation-evidence/assistant-floorplan/map-legacy-cleanup.png) ·
[Map after fixed cleanup](implementation-evidence/assistant-floorplan/map-after.png).
