# Per-device HSV color calibration

Open **Configuration → Devices**, expand a lamp, and use **Config → Color calibration**.
Calibration is stored in the database per physical device and included in JSON
exports. Existing backups without calibration remain compatible.

Each matching point maps a reference HSV color (the value shared by scenes) to
the HSV command that makes this lamp look like the reference lamp. Brightness
stays separate. Native color-temperature, XY and RGB commands are unchanged.

## Start with existing circadian profiles

Select the reference circadian integration and the lamp's existing compensated
integration, then load their day/night points. The profiles are read from the
runtime configuration; loading them only changes the editor draft.

For the existing profiles, use `circadian` as reference:

| Point | Reference H/S | LIFX H/S | Tuya H/S |
| --- | --- | --- | --- |
| Day | 30° / 25% | 55° / 10% | 48° / 60% |
| Night | 27° / 90% | 35° / 80% | 34° / 100% |

Save the calibration on the corresponding physical lamps. Then change those
lamps' scene links to `circadian`. The compensated integrations and scene links
are not rewritten automatically: keeping an old compensated link after enabling
calibration applies the correction twice. Leave the reference Hue lamps without
a profile unless you want to correct them too.

## Match additional colors

Choose a reference lamp and a fixed test brightness. Start with the two white
points, then add red, yellow, green, cyan, blue and magenta, followed by less
saturated colors where matching is poor. Enter the same reference and output
values initially. Use **Save & test**, adjust the output hue/saturation until the
light matches, and test again. Compare illumination on the same neutral surface.

Testing saves the entire draft, powers on the selected lamps and detaches their
active scenes. Reactivate their scenes when finished. There is no automatic
measurement: the browser cannot observe the actual light emitted by the lamps.

The server blends hue and saturation offsets using inverse-distance weights on
a hue/saturation disk. This respects the red hue wrap and distinguishes points
with similar hue but different saturation. Every saved matching point is exact;
colors between and outside points are estimates. Two warm-white points do not
determine a full lamp gamut, and lamps may require different corrections at
different brightness levels. This version has no brightness-dependent profiles.

Scene state stays in reference coordinates. Outbound HSV commands are corrected
once, and managed-device reports are compared against the corrected expected
state. Unmanaged reports reuse the known reference command where possible;
otherwise the server estimates an inverse. Saturation clipping can make that
inverse ambiguous. Raw report metadata remains in the lamp's coordinates.

**Reset calibration** removes the saved profile. The next command uses the
uncorrected reference color. Deleting or replacing a physical device removes its
calibration instead of copying it to a different lamp.
