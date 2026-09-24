# Brightness calibration implementation plan

**Goal:** Let a person make brightness commands feel consistent across any writable dimmable lights, regardless of integration or brand. The user can choose a reference light for visual matching, enter and adjust exact calibration points themselves, and preserve any existing color calibration. The UI must distinguish the requested logical brightness from the command sent to the target light.

This is a plan, not an implementation. Do not assume a particular device, firmware setting, broker, topic layout, or “correct” brand. Use the device catalog and brightness capability for eligibility. Keep user-managed profiles in the existing database-backed calibration store and retain JSON export/import compatibility.

## 0. Repo facts and gaps in the prior plan

- `Capabilities.brightness: Option<bool>` is the explicit dimming signal; legacy integrations normalize it when devices are created (`server/src/types/color.rs`, `server/src/types/device.rs`). The existing `calibration_device` and UI `canCalibrateDevice` require color support, so simply adding a wizard phase would exclude brightness-only dimmers.
- `ColorCalibrationProfile::validate` currently requires at least one color point. A brightness-only profile needs validation to accept either a valid color set, a valid brightness curve, or both.
- A profile assignment supersedes a device's legacy color points. Saving a brightness-only profile over an existing assignment would silently remove color calibration unless the current color points are copied or the data model supports independent channel assignments.
- `CalibrationPreview` currently requires color `reference` and `output` values, and `preview_calibration` forces both lights into a color mode. Merely appending optional `brightness_output` cannot support a brightness-only light. The brightness preview needs its own request shape/branch within the existing session lifecycle.
- `calibrated_device()` is the outbound correction point. Managed reports compare against its physical output; unmanaged/discovery reports may be mapped back to logical values. Extend the existing “preserve the last requested logical value when the physical report matches” principle to brightness.
- Profiles live as JSON in `calibration_profiles.config`; assignments are separate database rows. Additive `#[serde(default)]` fields require no new table, but export/import and old-row round trips must be tested.
- The current UI wizard is color-specific. The new entry must offer brightness calibration independently; a user must not complete color matching before working on brightness.

## 1. Product and data decisions

### 1.1 Keep calibration generic and composable

- A reference light is one the user chooses because they like its output. Do not preselect or elevate a particular integration, device model, or manufacturer.
- Brightness calibration applies to a writable controllable device whose normalized `capabilities.brightness == Some(true)`, including devices with no color capability. A reference used for visual matching must also be controllable and dimmable. Keep the existing color eligibility rule only for color calibration.
- A profile may contain color points, brightness points, or both. Reusing a profile on another device applies only the channels present in that profile. The UI must say which channels a profile contains before assignment.
- Adding brightness calibration to a device that already has color calibration must preserve the latter. Default to creating a **new combined profile** from the device's currently resolved color points plus the new brightness points, then assign that new profile to this device. Do not mutate a shared profile or silently change its other assigned devices. A deliberate “Apply to more devices” action can assign the combined profile later.
- Keep the existing `ColorCalibration*` type names for compatibility in this pass, but label the user-facing feature “Light calibration” and its two parts “Color” and “Brightness.” The legacy `ColorCalibrationProfile.brightness` field remains metadata for the light level used during color matching; it is **not** an anchor or curve parameter. Give it a backward-compatible default for brightness-only profiles and keep it out of the brightness UI.

### 1.2 Editable brightness anchors

Add `BrightnessCalibrationPoint { logical: OrderedFloat<f32>, output: OrderedFloat<f32> }` to the resolved `DeviceColorCalibration` and reusable `ColorCalibrationProfile`, with `#[serde(default)]`.

- `logical` is the desired brightness shown in homectl; `output` is the brightness command sent to the target device. Store fractions in `(0, 1]`; the UI displays percentages and permits at least 0.1% precision. Show both columns everywhere the point is edited or reviewed.
- An empty curve means identity. An active curve has **2–16** points. Logical values are strictly increasing; output values are non-decreasing. Reject duplicate logical levels, NaN/infinity, values outside `(0, 1]`, and descending output. A one-point curve is invalid because it would collapse nearly every brightness request to one output.
- `power: false` must remain off, and an absent or zero brightness must never be raised to the calibration floor. Zero remains zero. A positive brightness field may still represent the next-on level while power is off, so map that field consistently without turning the device on. Positive values below the lowest logical anchor clamp to its output; values above the highest anchor clamp to its output; values between anchors use linear interpolation. This defines the usable positive floor and ceiling without assuming firmware-specific limits.
- A flat output segment is permitted for devices that quantize or clamp. Inversion is ambiguous there: when a report matches the physical value of the current request, retain that requested logical value; for an unsolicited report with no matching request, choose and document a deterministic fallback (lowest logical point on a plateau).
- If the chosen endpoints do not cover 100% or a low desired level, the review must show an example of the resulting clamp. Do not silently imply that 100% remains 100% when a custom top anchor is lower.

### 1.3 Visual matching and extra-low range

- For an ordinary matched point, set the reference to the selected logical brightness through its normal calibration, set the target to the candidate physical output **without its existing calibration**, and let the user compare them. Save exactly the two numbers the user selected.
- The user can set either number directly. Provide numeric inputs, a slider for target output, and coarse ±1% and fine ±0.1% adjustment. “Use current requested level” may fill the desired/reference level. Only offer “Use last sent target output” when the actual post-calibration command is known; copying the target's logical requested value into a physical-output field would be misleading. Label requested, sent, and reported values separately; none is a measurement of light output.
- To match another light's floor exactly, let the user command the reference to its lowest stable on level, enter that exact reference/logical percentage, adjust the target until it visually matches, and save the point. Do not force one of five preset levels.
- A target may dim below the chosen reference's floor. Offer an optional **extra-low target point**: the user chooses a logical percentage and target output using that light alone. Say explicitly that this point is an authored extension, not a visual match to a reference that cannot reach that level. Never pin the reference at its floor and claim a lower logical level “matches” it.
- Physical brightness depends on placement, diffuser, color/temperature, and ambient light. The wizard should ask users to compare under the same conditions and report the result as a visual match, not a measured luminance guarantee.

## 2. Backend work, in dependency order

### Task A — types, validation, profile composition

**Files:** `server/src/core/color_calibration.rs`, config export/import tests, generated bindings later.

- [ ] Add the point type and default-empty `brightness_points` to both profile and resolved calibration. A legacy JSON profile/backup deserializes to an empty curve; new exports round-trip both channels.
- [ ] Make profile validation accept color-only, brightness-only, and combined profiles. Preserve existing color-point validation when color points are present. Validate the brightness curve with the rules above. An empty profile with neither channel is invalid.
- [ ] Keep `ColorCalibrationProfile.brightness` backward compatible and valid for brightness-only profiles without forcing the user through color setup.
- [ ] Make `ConfigExport::calibration_for_device` copy both point sets. Test resolution from an assigned combined profile, a brightness-only profile, a legacy color profile, and legacy per-device color points.
- [ ] Add an explicit “compose for this device” path for the wizard: copy the device's currently resolved color points and color-match metadata into a new profile when adding brightness, and copy currently resolved brightness points when adding color. Preserve the existing shared profile; never overwrite other assignments as a side effect. If the source was legacy per-device color points, retain those values in the new combined profile before its assignment supersedes them.
- [ ] Removing only one calibrated channel follows the same composition rule: assign a new profile containing the remaining channel, or remove the assignment only if neither channel remains. Do not make “Remove brightness calibration” erase saved color matching.
- [ ] Split eligibility by channel in the server and UI. Brightness sessions accept brightness-only writable devices; color sessions retain their color capability requirements. Disabled/read-only/missing devices still fail with a specific reason.
- [ ] Make profile assignment eligibility depend on the channels **in that profile**. A brightness-only profile can be assigned to a brightness-only dimmer; a profile containing color points requires the target's supported color path as well. Do not silently drop an unsupported channel. Validate every device before a batch write, keep the operation atomic, and show incompatible devices with a reason in the picker.

### Task B — forward and inverse behavior

**Files:** `server/src/core/color_calibration.rs`, `server/src/core/devices.rs`.

- [ ] Implement a pure forward mapper with identity/zero/clamp/interpolation semantics. Apply it in `calibrated_device()` to positive `Some(brightness)` while preserving the power bit; a saved next-on brightness may be mapped while the light is off. Leave `None` and zero unchanged. Preserve color correction and preferred-mode conversion.
- [ ] Implement a pure inverse mapper for physical reports, with deterministic plateau handling. On managed reports, compare the physical report with the calibrated expected output and preserve the current logical request when it matches. On unmanaged/discovery paths, invert when a physical report must become logical state, preferring the current requested value if it maps to the report within the existing physical tolerance.
- [ ] Cover power Off, zero brightness, missing brightness, two anchors, exact anchors, interpolation, below/above endpoints, a plateau, and bad/legacy data. Test a scene, a routine/device command, and an automated source through the common outbound path. Test that a physical mismatch remains a mismatch and does not produce a correction loop.
- [ ] Check every report site in `devices.rs` rather than mechanically adding inverse calls at three line numbers. The managed path must not overwrite a logical request just because a device reports its calibrated physical output.

### Task C — safe brightness preview session

**Files:** `server/src/core/calibration_session.rs`, `server/src/api/config/calibration.rs`.

- [ ] Add an explicit brightness-preview request/branch compatible with the existing color-preview payload. It may use a discriminated request type or a separate route in the same session lifecycle. Do **not** make brightness-only preview require color `reference`/`output` values or force a color mode.
- [ ] The brightness branch sets power on, target physical output to the candidate value, reference logical brightness through its normal calibration when a reference is used, and transition to zero for responsive comparison. Preserve each light's existing color/temperature state. For manual-only authoring, preview the target without a reference.
- [ ] Validate finite positive percentages up to 100%, including values below 1% if the device accepts them; never treat 0 as a positive floor. The UI may show a warning when hardware rounds a requested output, but it must not invent a physical reading.
- [ ] Reuse session locking, heartbeat/idle expiry, and Cancel/Finish restoration. Previews must not persist device state or profile changes. Test a brightness-only target/reference, an existing calibration on each, missing/offline devices, concurrent sessions, expired sessions, and restoration to the **latest** normal runtime state.

## 3. Wizard and profile UX

**Files:** `ui/ui/ColorCalibrationWizard.tsx` or a shared LightCalibrationWizard, `ui/lib/colorCalibration.ts`, device entry point/hooks.

### Step 1 — choose what to calibrate

- [ ] From a dimmable device detail page, offer **Calibrate brightness** without requiring color setup. If the device supports both, offer Brightness and Color as separate starting choices. Show the existing assignment and which channels it already calibrates.
- [ ] Ask for a reference light for visual matching, with searchable names and device IDs in secondary text. Also offer “Enter a curve manually” for a user who already knows the desired points; reference is optional in that mode. Explain that saving a new combined profile preserves this device's existing other channel.
- [ ] When editing an existing profile, prefill its current points and allow jumping straight to Brightness. A shared profile edit must show how many devices use it and default to “Save as a new profile for this device”; changing all assignments requires a separate explicit choice.

### Step 2 — build and preview points

- [ ] Start with a small set of **editable suggestions**, not mandatory fixed levels. For example 100%, 50%, and 10%; user can replace them, add a point anywhere, or remove one (minimum two to save). Do not make 100/60/30/15/5 a hard-coded sequence or gate progress on five matches.
- [ ] Every point row shows **Desired brightness** and **Target output**, both directly editable as numeric percentages. Provide a target-output slider and ±1%/±0.1% buttons for visual matching. Numeric input is authoritative; slider steps are a convenience. Preserve the exact entered values, subject to validation and transport precision.
- [ ] Changing or selecting a point can preview it on the lights; provide a clear “Preview this point” control, progress/connection feedback, and a Stop preview action. “Looks matched” records the current numbers but is not required for manually entered points. Never save calibration automatically while previewing.
- [ ] Show current requested values and recent report/freshness when available, labeled as such. If reports are missing, keep numeric authoring available and say preview confirmation is unavailable. If a device is offline or becomes unavailable, stop preview safely and preserve the unsaved curve.
- [ ] Put validation beside the affected row: duplicated desired level, descending target output, point out of range, or fewer than two points. The user must be able to revisit and change any point from the review without restarting the wizard.

### Step 3 — review and save

- [ ] Show a compact ordered table or small curve: “Desired 10% → send 4.2%,” with exact floor and ceiling behavior illustrated. Mark visually matched points versus manually authored extra-low points. State whether color calibration is preserved and which device(s) will receive the new profile.
- [ ] Name the profile, suggest a unique ID, and keep ID under Details. Default to saving a new profile and assigning it only to this target. Do not apply to other devices merely because they share an integration or model.
- [ ] Save only after explicit review. Creation/editing must not command lights except through the clearly labeled temporary preview. After save, show the resulting curve on the device detail page with Change brightness calibration, Remove brightness calibration, and Apply profile to more devices as distinct actions.
- [ ] Keep the UI language generic: “reference light,” “target light,” “desired brightness,” “target output,” “minimum usable output.” No integration names or vendor-specific commands in component copy, IDs, fixtures, or happy-path documentation.

## 4. Tests, documentation, and release gates

- [ ] Regenerate TypeScript bindings after the Rust type changes. Add UI helper tests for validation, sort/insert/delete, interpolation, clamps, decimals, and preserving an untouched other channel.
- [ ] Add interaction tests: brightness-only light enters the wizard; exact manual points can be typed; reference-floor match uses the user-selected percentage; extra-low authored point is clearly labeled; user can edit/reorder by logical level and delete points; preview/cancel restores both lights; save creates a combined profile without changing other assigned devices.
- [ ] Test removing brightness from a combined profile and removing color from a combined profile. The other channel must remain effective, and devices sharing the original profile must not change.
- [ ] Add server tests for old DB JSON and backups, brightness-only and combined profiles, profile-aware batch assignment and rejection, export/import, physical report reconciliation, and no correction loop. Keep `cmp_device_states` physical tolerance behavior covered.
- [ ] Update `docs/color-calibration.md` to describe the independent brightness workflow, manual points, off/zero behavior, floor/ceiling clamps, preview restoration, and profile reuse. Keep the existing limits on color-channel calibration accurate. Remove the brightness item from `docs/todo.md` only after the feature and verification are complete.
- [ ] Run the appropriate Rust tests and checks plus `pnpm tsc`, `pnpm lint`, `pnpm test`, and `pnpm build`. Test keyboard/phone/200% zoom, numeric input with a software keyboard, and screen-reader labels for each point/action.
- [ ] With **any two available writable dimmable lights** in a safe test environment, create two manual points, visually match a reference floor, preview a middle point, save, activate a scene, and verify that a report of the calibrated physical value does not change the stored logical request or cause repeated correction. This is an optional live-device acceptance test; automated fixtures must cover the behavior without a particular broker or integration.

## 5. Risks and decisions to preserve

- Piecewise linear interpolation is deliberately simple and reviewable. Multiple editable points let the user correct midrange mismatch; do not switch interpolation spaces without a separate comparison and migration plan.
- A visual match is subjective, and two lights in different fixtures may not have the same apparent brightness from every position. Use plain, bounded claims.
- A device's firmware or integration may quantize or clamp brightness. The UI must distinguish the command it sent from a fresh reported value; it must not present the latter as measured light output.
- The reference may have its own calibration. Preview it through its normal path and label the chosen logical level. The target preview bypasses its old curve so the entered output is the actual candidate command.
- Profiles can be reused, but brightness curves often depend on the particular hardware. Show the mapping and target count before applying a profile to a selection; never infer compatibility from an integration name.
