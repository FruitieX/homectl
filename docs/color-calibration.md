# Color matching wizard and reusable profiles

Open **Configuration → Devices**, open a writable light, and use **Light
calibration**. A light can be calibrated on two channels: **color** (HSV hue and
saturation) and **brightness** (which level means which command). Each channel is
calibrated separately and a profile may carry either or both.

- **Calibrate color** needs HSV support. The wizard suggests 15 distinct points:
  neutral white, warm white, cool white, six saturated hues around the color
  wheel, and six softer hues. Select a reference light whose colors you want to
  match, name the profile, and choose the brightness you normally use.
- **Calibrate brightness** needs dimming support, and no color match at all.
  See [Brightness calibration](#brightness-calibration) below.

## Match two lights

The wizard suggests 15 distinct points: neutral white, warm white, cool white,
six saturated hues around the color wheel, and six softer hues. For each point,
adjust the target lamp's hue and saturation until the illumination matches the
reference. Changes preview automatically; **Looks matched** confirms the point.
Compare light on the same neutral surface, not the colors shown on a screen.

Review then offers four colors between the initial matches. Test them and use
**Improve this color** to add any weak match to the calibration. You can also
revisit earlier points. Fifteen points provide broad coverage, not a guarantee
of a perfect match: lamp gamut, brightness, placement and visual judgment matter.
This calibration adjusts HSV hue and saturation; brightness, native color
temperature, RGB and XY commands are not calibrated.

Saving a brightness calibration keeps any color match the light already has:
the new profile carries both channels, and the old profile is left untouched. Existing target
calibration is bypassed; the reference light retains its normal calibration.
Scene state continues advancing normally and is not replaced by preview values.
**Cancel** or **Finish** returns both lights to their current normal state.
Closing the view requests cancellation; a disconnected session expires after
two minutes without a heartbeat (checked every 30 seconds). Previews are not
saved to device state or configuration.

## Save once, reuse from the devices list

**Save profile & finish** saves the named profile and assigns it to the target
lamp. Checkboxes in the devices list select other writable HSV lights. Choose a
saved profile in the selection toolbar and apply it to the whole selection, or
remove calibration from the selection. Filtering preserves selected lights and
the toolbar explicitly indicates selections hidden by filters.

A batch validates every selected device before applying anything, then persists
the assignments in one transaction. Reuse works best for lamps of the same model;
check a representative lamp before assigning a profile to many lights. Profile
changes are saved as a new profile so other assigned lamps are not changed
unexpectedly. Deleting/replacing a lamp removes its assignment but keeps the
reusable profile.

Profiles and assignments are stored in the database and round-trip through JSON
exports. Older backups and existing per-device matching points remain supported.
A profile assignment supersedes the older points; removing calibration removes
both. No integration configuration is needed for calibration.

## Brightness calibration

Brightness is otherwise forwarded unchanged, so the same requested value means
different things per bulb: a dimmable light that reaches 0.1% and one that stops
at 5% both call their floor "1%". Brightness calibration stores the mapping.

The wizard has three steps:

1. **What to match** — match a reference light, or enter a curve manually. The
   reference picker lists dimmable lights with their ids; a manual curve needs no
   reference. A light that is already calibrated says which channels it has.
2. **Build points** — edit *Desired brightness* (the level you pick in homectl)
   and *Target output* (the command the light receives) as percentages, with a
   slider, ±1% buttons and a ±0.1% nudge for the last bit. Points start at
   100 / 50 / 10 % and you can add or remove points anywhere. **Preview this
   point** applies the candidate number to the light and shows the reference at
   the same level; **Stop preview** or leaving the wizard returns both lights to
   their previous state. A point below the reference's reachable range is called
   an *authored extra-low point*, because it is your choice rather than a visual
   match.
3. **Review and save** — a table of desired levels and what the light will be
   sent, whether the top of the curve is capped (so 100% no longer means full
   output), whether a floor is in play, what the reference was, and whether the
   color channel is preserved. Saving creates a **new profile** assigned to this
   light only; existing profiles are never modified. **Remove brightness
   calibration** drops the brightness channel and keeps the color match.

The mapping is piecewise linear between points, clamped to the endpoints, and is
applied wherever brightness is commanded — direct control, scenes, device links
and the circadian brightness output. Reported brightness is mapped back through
the inverse, so a level shown in the UI is the level you asked for; a reading
that falls on a flat segment or outside the curve maps to the lowest logical
level it could have come from.

Profile validation: two to sixteen points, desired brightness strictly
increasing, target output never decreasing, all values in (0, 100]. A profile is
valid with color points, a brightness curve, or both. The devices list applies a
profile to a selection and rejects the whole batch with a per-device reason when
any selected light cannot do what the profile needs — a brightness-only curve
applies to dimmers that have no color support, while a color profile still needs
HSV.
