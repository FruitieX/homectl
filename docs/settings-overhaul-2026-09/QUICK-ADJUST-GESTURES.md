# Selection quick controls and continuous gesture study

Requested 2026-09-30. The selection changes are implemented in the application;
the new single-finger switching gestures are interactive concepts for review.

## Implemented selection behavior

- Hold a selected floorplan light to open a popover for all selected lights.
  Holding does not remove it from the selection. Tapping still adds/removes
  devices; removing the final selected device exits selection mode.
- Holding a light with the device panel open now opens quick controls rather
  than starting selection. Use the popover Select icon, the device side panel's
  **Select devices** button, or the room side panel's **Select devices** button
  to start selecting. Desktop Ctrl-click and holding a room also remain
  selection entry points.
- The popover states how many writable selected lights it controls and labels
  differing values **Mixed**. Opening it sends no commands. Full controls opens
  the same selection; dismissing quick controls keeps selection active.
- Power, brightness and color use the existing live device command path and
  scene autosave preference for each light. Color preserves each light's power
  and brightness; brightness preserves color and switches power according to
  the requested brightness. A power tap changes power only.
- Controls appear only when supported by every writable target. Color
  temperature uses the intersection of supported ranges. Sensors and read-only
  lights receive no light commands, and skipped entries are identified.
- Updates still coalesce over 120 ms. Each update fans out to the writable
  selection; the next batch waits for all acknowledgements. The local indicator
  remains until all targets confirm the edited values. A failed command uses
  the existing error path; this is independent per-device execution rather than
  an atomic server transaction.

No API, database setting or migration is needed. Selection is session state.

## Three gesture concepts

Open [the interactive study](quick-adjust-study.html) in a browser. It works
directly from disk and keeps all values local. **Play gesture** shows a
continuous finger path; mouse and touch drags also work. On smaller screens,
the A/B/C navigation shows one concept at a time. There is no dependency on
a running homectl server and no command is sent to devices.

| Concept | Switch without releasing | Protection against accidental changes | Tradeoff |
| --- | --- | --- | --- |
| **A — Guarded ring** | Pause on the other control for 320 ms, then continue dragging | A neutral gap freezes edits; crossing the ring alone does not switch; brightness starts from its existing value | Pause adds time; ring still needs a precise touch |
| **B — Mode buttons** | Slide onto Color or Brightness for 180 ms, then continue inside the dial | A visible target explicitly selects the active control; re-entering the dial does not jump brightness | More travel to the buttons; brightness replaces the color wheel until switched back |
| **C — Pull-out rail** | Slide through the side handle and pull 14 px farther outward; adjust vertically; pull through Color to return | Passing over the handle alone does not switch; a separate adjustment lane leaves color unchanged | Requires extra horizontal room and an edge-aware mirrored layout in production |

**C is worth trying first:** a vertical movement is easier to distinguish from
color's angle/radius movements, and both controls remain visible. **A** is the
smallest change to the current circular control. **B** makes the current mode
especially clear.

These are alternatives, not three settings we need to ship. Choose a direction
after trying it on a physical phone. The active color field still changes color
while traversed; the transition region then freezes it. If travel through that
field feels too easy to misinterpret, the chosen concept should add a neutral
escape route or preserve the last deliberately paused color before production.
That behavior needs a phone trial rather than a screenshot decision alone.

### Shared visual direction

The study retains the Compact direction: a circular control over a muted
floorplan, colored brightness gauge with flat ends, softer center fill with a
clear colored outline, and a title identifying the selection. The active-control
pill reports which value is frozen; switch targets provide visible progress or
arming feedback. Releasing keeps controls open. Outside tap or a held power
button dismisses; a short power tap toggles. Selecting remains a separate action.

These studies concentrate on hue/saturation and brightness. The chosen mechanism
can also switch between temperature and brightness. Production integration would
retain device capability checks, current mode, live debouncing, error handling,
keyboard access and selection behavior. It must also mirror/reposition the rail
near screen edges and respect reduced motion.

## Review artifacts

- [Screenshot gallery](quick-adjust-review.html)
- [Desktop comparison](previews/quick-adjust-study/desktop-compare.png)
- [A on phone](previews/quick-adjust-study/phone-moat.png)
- [B on phone](previews/quick-adjust-study/phone-tabs.png)
- [C on phone](previews/quick-adjust-study/phone-rail.png)

## Verification

Selection behavior is covered by the existing isolated-fixture radial browser
batch on desktop and phone, including opening without commands, preserving
selection, fan-out to exactly both selected lights, per-device power preservation
during color changes, power-only changes, side-panel selection, last deselection,
and existing sensor/history interactions. Unit coverage checks common controls,
mixed capabilities, read-only/sensor exclusions and disjoint temperature ranges.

The study has its own mouse/touch browser batch covering each handoff in both
directions without pointer release, boundary crossings, no brightness jump,
unchanged inactive values, retained controls after release, and power hold.
No live household devices or configuration were changed.

Verification passed: **274 UI tests**, type check and production build;
lint retains the existing import/export cleanup warning. **126 application
browser checks** (63 desktop, 63 phone) and **36 study gesture checks** (18
desktop, 18 phone) passed with no browser errors. Desktop comparison and all
three phone screenshot captures also report no browser errors.
All three animated **Play gesture** paths also complete both adjustments and
return to color mode with the edited values retained.

[Desktop selection](implementation-evidence/selection-quick-adjust/desktop-selection.png) ·
[Phone selection](implementation-evidence/selection-quick-adjust/phone-selection.png) ·
[Desktop application checks](implementation-evidence/selection-quick-adjust/desktop-selection-checks.json) ·
[Phone application checks](implementation-evidence/selection-quick-adjust/phone-selection-checks.json) ·
[Desktop study checks](implementation-evidence/selection-quick-adjust/desktop-study-checks.json) ·
[Phone study checks](implementation-evidence/selection-quick-adjust/phone-study-checks.json).

[Animated gesture checks](implementation-evidence/selection-quick-adjust/animated-demo-checks.json).

```sh
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url http://127.0.0.1:3021/map --width 1440 --height 1000 \
  --driver-file ui/dev/radial-history-review.mjs
CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
  --url http://127.0.0.1:3024/quick-adjust-study.html --width 430 --height 1060 \
  --driver-file ui/dev/quick-adjust-study-review.mjs
```

The second command expects these static study files served on localhost:3024.
