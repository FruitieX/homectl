# Settings overhaul · Study 04

Start with [the visual gallery](review.html), then [the interactive studies](index.html#study03). Open either directly in a browser; no server or build is needed.

**The HTML studies are design prototypes.** Their entities, reports, logs and catalog entries are synthetic. They make no API calls; saves affect the current tab and reload discards them. Production implementation is now active: see [IMPLEMENTATION.md](IMPLEMENTATION.md) for progress, verification and outstanding acceptance, and `implementation-evidence/` for screenshots of the implemented UI against isolated fixtures.

## Floorplan editor · Study 06 (implemented)

[Floorplan editor screenshot gallery](floorplan-editor-review.html) ·
[Interactive editor](floorplan-editor.html) ·
[Plan and confirmed interactions](FLOORPLAN-EDITOR-PLAN.md).

Compares docked versus floating panels around a fixed canvas, with separate
Devices, Room areas and Walls modes and responsive phone trays. This study is
now implemented. See [verification and handoff](FLOORPLAN-EDITOR-IMPLEMENTATION.md)
and the [mockup versus implementation gallery](implementation-evidence/floorplan-editor/index.html).

## Current review

### Floorplan pinch handoff (implemented)

Lifting either finger after a pinch now preserves the view and lets the
remaining finger pan from its current position. See
[cause and native multi-touch verification](FLOORPLAN-PINCH-HANDOFF.md).

### Chart gestures and readings (implemented)

Dashboard chart taps open widget details; drags inspect values. Compact
floating reading cards replace persistent strips and clear on release across
charts and dialogs. See [behavior and verification](CHART-GESTURES.md).

### Assistant floorplan follow-up (implemented)

Larger desktop dialogs and responsive floorplan previews, clearer phone labels,
and a fix for preview cleanup blanking the live map behind the assistant.
See [behavior, cause and browser verification](ASSISTANT-FLOORPLAN-PREVIEW.md).

### Shared navigation · Study 08 (implemented)

[Desktop/phone screenshot comparison](navigation-review.html) ·
[Interactive sidebar study](navigation-study.html) ·
[Design notes and tradeoffs](NAVIGATION-STUDY.md).

The compact labeled rail with an expandable settings panel was selected.
Production uses two states, open and closed: entering settings opens the panel,
leaving settings closes it. There is no pinning or overlay mode. The shared
phone drawer retains group shortcuts and the full settings catalog.
See [implementation behavior and verification](UNIFIED-NAVIGATION.md) and
[mockup versus implementation](implementation-evidence/compact-rail/index.html).
The original concept comparison remains available with synthetic data.

### Quick adjust · Study 07

[Interactive continuous-gesture study](quick-adjust-study.html) ·
[Desktop and phone gallery](quick-adjust-review.html) ·
[Selection behavior and gesture tradeoffs](QUICK-ADJUST-GESTURES.md).

Selected lights can now be adjusted together from the floorplan popover, with
selection entry buttons in device and room panels. The study explores three
single-finger handoffs between color and brightness: a guarded ring, explicit
mode buttons and a pull-out brightness rail. These gestures await direction
selection; all prototype adjustments remain local.

The Compact baseline is approved. Study 04 responds to the preference for the earlier routine canvas and desktop scene table. The complex controls are retained within those layouts:

| Study | Interactive example | Screenshots |
| --- | --- | --- |
| Complex routine | [Branches, conditions and timer](index.html#complex-routine) | [Desktop](previews/04-routine-desktop.png) · [Phone](previews/04-routine-phone.png) |
| Scene target modes | [Explicit, device link, scene link, repair](index.html#scene-modes) | [Desktop](previews/04-scene-desktop.png) · [Phone](previews/04-scene-phone.png) |
| Color and catalog | Open Color or Add devices in the scene study | [Color picker](previews/03-color-picker-phone.png) · [White temperature](previews/03-temperature-picker-desktop.png) · [Search](previews/03-catalog-phone.png) |
| Creation | [New routine → create scene → return](index.html#new-routine) | [Desktop](previews/03-create-desktop.png) · [Returned phone draft](previews/03-create-return-phone.png) |
| Recovery | [Change a value and select a save outcome](index.html#save-lab) | [Network failure](previews/03-network-phone.png) · [Conflict](previews/03-conflict-desktop.png) · [Persistence warning](previews/03-persistence-phone.png) |

The user confirmed that **Enable after creating is checked by default**. The revised routine and scene layouts are ready for review; implementation has not started. The earlier `#routine` reference remains available.

## Try these interactions

1. Reorder a branch or action in the complex routine; its values move with it. Follow the timer link to its replacement action.
2. Open a target's color picker. Try temperature or hue/saturation, cancel, then apply another color. White-only targets do not offer color mode.
3. Change a linked-device multiplier from 50% to 25%; the sample 60% source resolves to 15%. Switch target modes and return without losing the inactive sample values.
4. Add devices, select the long-name fixture, then search for Kitchen. The selection remains visible. The study-state selector demonstrates loading and retry.
5. Name a new routine and choose a starting event. Follow Create a scene, add targets and create it. Return with the scene selected and the routine draft retained.
6. In Save & recovery, change Name and use each simulated outcome. A failed save retains your edit; a persistence warning remains across page navigation.

The study toolbar and state selectors are prototype tools. Other dirty pages appear in a return strip. The prototype retains values and dirty state, but production also needs scroll/focus restoration and a typed draft store.

## Documentation

- [Everyday UI mockup gallery: rooms, dashboard, controls and remaining views](everyday-review.html)
- [Everyday UI review notes and interactive coverage](EVERYDAY-REVIEW.md)
- [Everyday UI implementation and acceptance tracker](EVERYDAY-IMPLEMENTATION.md)
- [Working plan and confirmed decisions](PLAN.md)
- [Final interaction review and engineering handoff](FINAL-PASS.md)
- [Shared interaction rules](INTERACTION-SYSTEM.md)
- [Implementation readiness](IMPLEMENTATION-READINESS.md)
- [Inventory and priorities for views beyond settings](UI-INVENTORY.md)
- [Review notes and verification scope](REVIEW-NOTES.md)
- [Typed routine fixture](complex-routine.fixture.ts)

**Scene default correction:** earlier screenshots used “Keep current” too broadly. The active prototype now reflects omitted power → On, omitted brightness → 100% when powered on, and omitted color → Not specified. Details and source paths are in the handoff. Color previews are approximate display aids, not physical measurements.

[Study 03](review-03.html) preserves the previous interaction review; its two-column routine and desktop card grid have been superseded.

## Approved baseline and archives

[Study 02](review-02.html) records the approved phone scene cards, desktop columns, previews, attention, advanced preference and compact logs. Those views remain available through the prototype navigation. [Study 01](review-01.html) records the original A/B comparison; A/Compact was selected.

Archive screenshots preserve their original wording. Their interactive links open the current prototype. Only representative entity detail pages are modeled; category links may open a representative detail. Unimplemented secondary actions explain their intended behavior.

## Verification

Browser checks cover selected interactions at 360/390 px and desktop layouts at 1440 px. Additional responsive checks and limitations are recorded in REVIEW-NOTES.md. Checked views had no document horizontal overflow or browser console errors. These are not full accessibility or production acceptance results.

The prototype scripts pass `node --check`. The static complex routine fixture passes:

```sh
ui/node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
  --target es2022 --moduleResolution bundler --module esnext \
  docs/settings-overhaul-2026-09/complex-routine.fixture.ts
```

Screenshots use `ui/dev/cdp-probe.mjs` and a local Chromium CDP instance. Example:

```sh
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url 'file:///home/rasse/homectl/docs/settings-overhaul-2026-09/index.html#complex-routine' \
  --out docs/settings-overhaul-2026-09/previews/03-routine-desktop.png \
  --width 1440 --height 1080 --full 1
```
