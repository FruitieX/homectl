# Floorplan pinch-to-pan handoff

Implemented 2026-10-01 after a report that lifting one finger after a pinch
caused the canvas to snap when the remaining finger moved.

## Cause and fix

The second finger replaced the active one-finger gesture. Pinch movement
updated the pointer map and view transform, but left that gesture's last pan
position at its original touch-down location. Lifting the other finger then
applied the survivor's entire pre-pinch displacement as a pan. Lifting the
second finger instead could leave the first finger unable to continue panning.

Multi-touch now owns all participating pointers without retaining a tap/hold
candidate. When one finger remains, its latest recorded position becomes the
new pan baseline. Its subsequent movement pans by exactly that new delta,
regardless of which finger lifted. It cannot trigger a tap or long press when
the gesture ends.

When three fingers become two, the new pair also gets a fresh pinch baseline.
Unrelated pointer-up events outside the tracked gesture are ignored.

## Verification

The native Chromium driver `ui/dev/floorplan-pinch-review.mjs` creates a
temporary floorplan on the guarded loopback fixture. It observes Pixi's actual
world transform through the application's initialization hook; it does not
replace any gesture logic or modify the view itself.

Checks cover both release orders, stationary surviving fingers, continued pan
delta, final release, a three-to-two-finger transition, cancellation and a
fresh pan afterward. Starting on a light also verifies that a pinch cannot
leave behind a pending long press or open its details accidentally.

**48 checks pass** across phone **430 × 932** and desktop **1440 × 1000**,
with no browser errors. The existing phone quick-control dismissal journey
also passes, preserving ordinary taps and holds after the gesture fix.
See [recorded transforms and browser results](implementation-evidence/pinch-handoff/).

Type checking, lint and production build pass with existing warnings. No live
configuration or device commands are changed.
