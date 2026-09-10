# Color matching wizard and reusable profiles

Open **Configuration → Devices**, expand a writable HSV light, and choose
**Config → Color calibration**. Select a reference light whose colors you want
to match, name the profile, and choose the brightness you normally use.

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

Testing temporarily overrides the two lights' physical output. Existing target
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
