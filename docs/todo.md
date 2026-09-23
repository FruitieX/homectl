# Todo

Ideas and requested changes that are not implemented yet. Add new items at the
top with enough context to act on them later, and remove an item once it lands.

## Brightness calibration for lights

Color calibration covers HSV hue and saturation only: `docs/color-calibration.md`
states that brightness, native color temperature, RGB and XY commands are not
calibrated. Brightness is forwarded unchanged, so the same requested value means
different things per bulb:

- Tuya/ESPHome bulbs can get significantly more dim than Hue bulbs (different dim
  curves and usable minimums), so the same percentage is visibly different
  between them.
- The circadian integration's evening brightness is mismatched across bulb types,
  because one profile is emitted for every linked light.

Extend the calibration wizard with a brightness step: pick a reference light and
a few levels (for example 100 / 60 / 30 / 15 / 5 %), adjust the target lamp's
brightness until the illumination matches the reference, and store the pairs as a
piecewise-linear curve on the profile. Apply that curve wherever brightness is
commanded, including scene device links and the circadian brightness output, and
clamp to the device's usable minimum/maximum so a low evening request does not
land below what a bulb can actually do, or above a high floor. Keep the existing
profile persistence and batch validation semantics. Out of scope: native color
temperature, RGB and XY calibration.

## Assistant plans that create what they reference (2026-09-23)

- [ ] Let a plan reference entities its own earlier operations create. Plan: `.hermes/plans/20260923-assistant-and-housekeeping.md`; half-finished WIP is stashed as `staged-creates-wip` in `~/homectl-wt/panel`.
- [ ] Dependency housekeeping: 87 Dependabot alerts (39 high) on the default branch.
- [ ] Decide how "which scene state is this group in" should be expressed before asking the assistant to write such routines.
