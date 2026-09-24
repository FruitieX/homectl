# Brightness calibration implementation plan

**Goal:** Extend homectl's existing light calibration from colour-only (HSV hue/saturation
in u′v′) to also cover brightness, so one logical brightness value looks the same on every
bulb type — Hue as the accurate reference, ESPHome/Tuya bulbs (which dim far lower) mapped
onto the same perceptual scale, with each device's usable floor/ceiling respected.

**Architecture:** Reuse the whole existing calibration pipeline (profiles → assignments →
resolved per-device calibration → outbound transform → inverse for reports). Add a
piecewise-linear brightness curve to the same profile, applied in `calibrated_device()` and
inverted wherever reported colours are mapped back to logical values. No new tables: profiles
are JSON blobs, so `#[serde(default)]` fields are backward compatible.

**Tech stack:** Rust (warp, SeaORM, ts-rs), React/Vite UI (oxlint, tsc, node:test + vitest).

**Not planned here:** implementation. This plan is written for the main session (no subagent
delegation per standing preference).

---

## 1. Current state (verified in the repo)

| Piece | Where |
| --- | --- |
| Calibration types (`Uv`, `ColorCalibrationPoint`, `DeviceColorCalibration`, `ColorCalibrationProfile`, `ColorCalibrationAssignment`) | `server/src/core/color_calibration.rs:12-104` |
| Profile validation | `ColorCalibrationProfile::validate` (`:74-97`), `DeviceColorCalibration::validate` (`:232-250`) |
| Outbound transform (colour only) | `calibrated_device()` (`:366-374`) — corrects `state.color`, then `color_to_preferred_mode()` |
| Inverse for reports | `reference_for_report()` (`:324-363`), called at `server/src/core/devices.rs:534, 659, 682` |
| Command path | `server/src/core/devices.rs:519, 554, 1337`, `server/src/core/event.rs:681` |
| Report comparison | `cmp_device_states` (`server/src/types/device.rs:470-510`), brightness tolerance `0.01` |
| Preview sessions | `server/src/core/calibration_session.rs` (`CalibrationSession`, `CalibrationPreview`, `preview_calibration`, `finish_calibration`, 120 s idle timeout) |
| API | `server/src/api/config/calibration.rs` (`calibration-profiles`, `calibration-assignments`, `calibration-sessions/{key}`, `.../{id}`, `.../{id}/heartbeat`) |
| Persistence | `server/src/db/config_queries/calibration.rs` — profiles stored as JSON in `calibration_profiles.config`; assignments in their own table |
| Brightness today | `ControllableDeviceState.brightness: Option<OrderedFloat<f32>>`, range `0.0-1.0` (`server/src/types/device.rs:48-49`); forwarded unchanged |
| UI wizard | `ui/ui/ColorCalibrationWizard.tsx` (897 lines, phases `setup → match → review → saved`), helpers in `ui/lib/colorCalibration.ts` (335 lines), entry point in `ui/app/config/devices/page.tsx` |
| UI hooks | `ui/hooks/useConfig.ts` (`useCalibrationProfiles`, `useAssignCalibrationProfile`, …) |
| Tests | server unit tests inline in `color_calibration.rs` / `calibration_session.rs`; UI: `ui/lib/*.test.ts` (vitest via `pnpm test`) and `ui/tests/calibration-wizard.test.cjs` (node:test) |
| Docs | `docs/color-calibration.md` (user-facing; explicitly says brightness is **not** calibrated), `docs/todo.md:47-68` (the spec this plan implements) |

The todo entry already fixes the scope: brightness step in the wizard, reference light + a few
levels (100/60/30/15/5 %), piecewise-linear curve on the profile, applied wherever brightness
is commanded (including scene device links and the circadian brightness output), clamped to the
device's usable minimum/maximum. Out of scope there: native colour temperature, RGB and XY.

## 2. Design

### 2.1 Data model (no DB migration)

```rust
// server/src/core/color_calibration.rs
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BrightnessCalibrationPoint {
    /// Logical brightness homectl commands (0.0 - 1.0).
    pub logical: OrderedFloat<f32>,
    /// Device brightness that visually matches `logical` (0.0 - 1.0).
    pub output: OrderedFloat<f32>,
}
```

Add to **both** `DeviceColorCalibration` and `ColorCalibrationProfile`:

```rust
    /// Piecewise-linear brightness match; empty = brightness is uncalibrated.
    #[serde(default)]
    pub brightness_points: Vec<BrightnessCalibrationPoint>,
```

`DeviceColorCalibration` is the resolved per-device view built by
`ConfigExport::calibration_for_device` (`:107-126`) — it must copy `profile.brightness_points`
alongside `profile.points` so assigned profiles carry the curve.

Notes:
- Profiles are stored as JSON, and `ConfigExport` round-trips through JSON exports, so
  `#[serde(default)]` keeps old backups and existing rows valid — **no migration**.
- Keep the existing names (`ColorCalibration*`) rather than renaming to `LightCalibration*`:
  the rename would churn bindings, UI and docs for no behaviour (open question 4).
- The existing `ColorCalibrationProfile.brightness: f32` stays as-is — it is the brightness at
  which the *colour* matching was performed, not part of the curve.

### 2.2 Curve semantics

- Anchors are sorted by `logical`, strictly increasing; `output` must be non-decreasing
  (needed so the inverse is unambiguous). At most 16 anchors.
- Forward (`correct_brightness(logical)`): identity when empty; below the lowest anchor →
  clamp to the lowest `output`; above the highest → clamp to the highest `output`; otherwise
  linear interpolation inside the containing segment.
- Inverse (`reference_brightness_for_report(output)`): exact piecewise inversion, same
  clamping at the ends. Flat segments (`output` equal on both ends) resolve to the **lowest**
  logical value of that segment — document and test this rule.
- The curve *is* the usable range: the lowest anchor is the device's floor, the highest its
  ceiling. No extra capability fields (YAGNI); the wizard discovers the floor visually, which
  also handles firmware-side clamps like the gx53 `minimum_brightness: 13%`.

### 2.3 Where it applies

1. **Outbound** — extend `calibrated_device()` (`:366`):

```rust
    if let Some(brightness) = data.state.brightness.as_ref() {
        data.state.brightness =
            Some(OrderedFloat(calibration.correct_brightness(brightness.into_inner())));
    }
```

   Because every command path funnels through `calibrated_device` (scene device links, group
   application, circadian `SourceOutput`, the assistant), the curve covers all of them for
   free — the circadian integration needs **no code change**; it only needs a test.

2. **Inbound** — device reports carry *physical* brightness, and homectl stores logical values
   (mirroring what `reference_for_report` does for colour). At the three report sites
   (`devices.rs:534, 659, 682`) map brightness through the inverse in the same branch.
   `cmp_device_states` keeps comparing in physical space via `calibrated_device` output
   (`devices.rs:554`), so its `0.01` tolerance stays meaningful.

3. **Preview** — extend `CalibrationPreview` with `#[serde(default)] brightness_output: Option<f32>`:
   when set, the target lamp is driven at the candidate *physical* brightness while the
   reference is set to the logical level (existing behaviour for `brightness`). Previews keep
   bypassing the target's existing calibration and must not touch persisted state (existing
   session tests already assert this pattern).

### 2.4 UX flow (wizard)

- Entry: **Configuration → Devices → (writable dimmable light) → Config → Calibration**, with
  the colour step first and a new **Brightness** phase after it; when editing an existing
  profile, offer jumping straight to the brightness phase.
- Levels: default `100 / 60 / 30 / 15 / 5 %` (editable list; user can add a level).
- For each level: both lamps go to the logical level L (reference renders it normally, target
  previews candidate O, starting at O = L). The user steps O ±1 % until the illumination
  matches, then **Looks matched** records `(logical: L, output: O)`.
- **Deep-dim anchor (the important case):** the lowest level may be below what the *reference*
  can express. The reference then sits pinned at its own minimum while the target keeps
  dimming, so ESPHome bulbs retain their deeper range instead of being clamped up to the Hue
  floor. No extra data field is needed — the last anchor simply has a `logical` below the
  reference's minimum, and the wizard labels that level "as low as the target goes".
- Review phase mirrors the colour review: show the curve (table or sparkline) and allow
  **Improve this level** to re-enter any level.
- Save: profile carries `brightness_points`; batch assignment on the devices page is unchanged
  (it already validates the whole selection then persists in one transaction).
- Wizard copy must warn that brightness curves are model-specific (existing colour wording:
  "Reuse works best for lamps of the same model").

### 2.5 Out of scope

Native colour temperature, RGB/XY calibration, per-channel gamma, colour-temperature-dependent
brightness, group-level calibration, and any change to how `minimum_brightness` is configured
in firmware.

## 3. Tasks

Each task is TDD: write the failing test, run it, implement, run it, commit.

### Task 1 — Brightness anchor type + validation

**Files:** `server/src/core/color_calibration.rs`

1. Add `BrightnessCalibrationPoint` and the `brightness_points` field (with `#[serde(default)]`)
   to `DeviceColorCalibration` and `ColorCalibrationProfile` (section 2.1).
2. Extend both `validate()` methods with a shared helper:

```rust
fn validate_brightness_points(points: &[BrightnessCalibrationPoint]) -> Result<(), String> {
    if points.len() > 16 {
        return Err("Brightness calibration supports at most 16 anchors".into());
    }
    let (mut prev_logical, mut prev_output) = (None::<f32>, None::<f32>);
    for point in points {
        let (logical, output) = (point.logical.into_inner(), point.output.into_inner());
        if !logical.is_finite() || !output.is_finite()
            || !(0.0..=1.0).contains(&logical) || !(0.0..=1.0).contains(&output)
        {
            return Err("Brightness anchors must be finite values between 0 and 100%".into());
        }
        if prev_logical.is_some_and(|p| logical <= p) {
            return Err("Brightness anchors must have strictly increasing logical levels".into());
        }
        if prev_output.is_some_and(|p| output < p) {
            return Err("Brightness anchors must not decrease in output".into());
        }
        prev_logical = Some(logical);
        prev_output = Some(output);
    }
    Ok(())
}
```

3. Tests: empty is valid; duplicate/unsorted `logical` rejected; decreasing `output` rejected;
   out-of-range and NaN rejected; 17 anchors rejected.

Run: `cargo test -p homectl_server brightness` → PASS.

### Task 2 — Forward map + inverse

**Files:** `server/src/core/color_calibration.rs`

Implement `correct_brightness(&self, logical: f32) -> f32` and
`reference_brightness_for_report(&self, output: f32) -> f32` per section 2.2 (sketch below),
both `impl DeviceColorCalibration`.

```rust
    pub fn correct_brightness(&self, logical: f32) -> f32 {
        let points = &self.brightness_points;
        if points.is_empty() {
            return logical;
        }
        let first = points.first().unwrap();
        let last = points.last().unwrap();
        if logical <= *first.logical { return *first.output; }
        if logical >= *last.logical { return *last.output; }
        for pair in points.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            if logical >= *a.logical && logical <= *b.logical {
                let span = *b.logical - *a.logical;
                let t = if span.abs() <= f32::EPSILON { 0.0 } else { (logical - *a.logical) / span };
                return *a.output + t * (*b.output - *a.output);
            }
        }
        logical
    }
```

Tests (mirror the existing colour tests):
- anchors are exact (`correct_brightness(anchor.logical) == anchor.output`);
- identity when `brightness_points` is empty and when validation fails;
- clamping below the lowest anchor and above the highest;
- inverse round-trip for anchors and for intermediate values (tolerance `1e-5`);
- flat segment resolves to the lowest logical value;
- the full profile → device resolution path (`ConfigExport::calibration_for_device`) carries
  `brightness_points` from an assigned profile (extend `calibration_for_device` in Task 4 if
  the test lands here first).

### Task 3 — Apply the curve outbound

**Files:** `server/src/core/color_calibration.rs:366` (`calibrated_device`)

1. Failing test: a lamp with `brightness = Some(0.5)`, calibration with
   `[(0.0, 0.1), (1.0, 1.0)]` → `calibrated_device(...).state.brightness == 0.55`.
2. Implement the two lines from section 2.3 (after colour correction, before
   `color_to_preferred_mode()`).
3. Test that colour behaviour is unchanged when only brightness anchors exist (and vice versa).

### Task 4 — Profile resolution carries the curve

**Files:** `server/src/core/color_calibration.rs:107-126`

Extend `calibration_for_device` to copy `profile.brightness_points` into the resolved
`DeviceColorCalibration`. Test: profile with brightness anchors + assignment → resolved
calibration contains the anchors; a legacy profile without the field resolves to an empty vec.

### Task 5 — Invert reported brightness

**Files:** `server/src/core/devices.rs:534, 659, 682`

1. Failing test (extend the existing report tests around `devices.rs` / `types/device.rs`):
   with a brightness curve, a report of the *physical* brightness for logical `0.3` must
   reconcile as a match and store logical `0.3`, not the physical value.
2. At each of the three `reference_for_report` sites, map brightness through
   `reference_brightness_for_report` in the same branch.
3. Keep `cmp_device_states` physical (it compares against `calibrated_device` output at
   `devices.rs:554`); add a test asserting a mismatching physical report still flags a mismatch.

### Task 6 — Preview support

**Files:** `server/src/core/calibration_session.rs`, `server/src/api/config/calibration.rs`

1. Add `#[serde(default)] pub brightness_output: Option<f32>` to `CalibrationPreview`.
2. In `preview_calibration`, when `brightness_output` is set: target preview device gets that
   physical brightness (bypassing its existing calibration, as today), reference is set to the
   logical `brightness`; validate `0.01..=1.0` like the existing brightness check (`:276`).
3. Session tests: preview does not touch persisted devices; `finish_calibration` restores
   current runtime state; a queued preview event carries the logical value.
4. API tests: the existing preview endpoint accepts the new optional field (serde default) —
   extend `server/tests/config_api.rs` / `config_api_integration.rs` style tests if a
   calibration-session test already exists there.

### Task 7 — Bindings + UI helpers

**Files:** `server/tests/export_bindings.rs` (run), `ui/lib/colorCalibration.ts`,
`ui/lib/colorCalibration.test.ts`

1. `cargo test --test export_bindings` → regenerates `ui/bindings/` (new
   `BrightnessCalibrationPoint` binding, updated profile/device types).
2. UI helpers: `type BrightnessCalibrationPoint`, `suggestedBrightnessLevels = [100, 60, 30, 15, 5]`,
   `interpolateBrightness(points, logical)` for the review sparkline, and clamping helpers.
3. vitest unit tests for interpolation/clamping (identity, clamp ends, mid-segment).

Run: `cd ui && pnpm test`.

### Task 8 — Wizard + devices page

**Files:** `ui/ui/ColorCalibrationWizard.tsx`, `ui/app/config/devices/page.tsx`,
`ui/tests/calibration-wizard.test.cjs`

1. Add phase `'brightness'` to the existing `Phase` union (`setup | match | review | saved`);
   state: `brightnessLevels`, `brightnessIndex`, `brightnessOutputs`.
2. Per-level UI: level label, target brightness stepper (±1 %), "Looks matched", progress
   ("Level 3 of 5"), the "as low as the target goes" hint for the final level.
3. Review: curve table + "Improve this level"; save includes `brightness_points`.
4. Devices page: menu entry text and entry-point wiring next to the existing colour
   calibration item; keep the batch assignment toolbar unchanged.
5. Extend `ui/tests/calibration-wizard.test.cjs` (node:test, loads TS via vm) with: level
   sequence, clamping when the user steps below 1 %, and profile payload shape.

Run: `cd ui && pnpm lint && pnpm tsc --pretty false && pnpm test && pnpm build`.

### Task 9 — Docs

**Files:** `docs/color-calibration.md`, `docs/todo.md`

1. Update `docs/color-calibration.md`: the wizard now has a brightness step; replace the
   "brightness … not calibrated" sentence; document the deep-dim anchor behaviour, the
   model-specific caveat, and that changing a bulb's firmware `minimum_brightness` invalidates
   its curve.
2. Remove the `## Brightness calibration for lights` section from `docs/todo.md` (implemented
   work leaves the todo doc) and point at this plan/doc if useful.

### Task 10 — End-to-end verification on real lights

1. `cargo test --all --locked -- --test-threads=1`, `cargo fmt --all -- --check`,
   `cargo clippy -- -D warnings`.
2. Calibrate a Hue reference against one gx53 bulb over the real broker
   (`mqtt.fruitiex.org`, topic prefix `esphome/<node>`); verify at 5/15/30/60/100 % that both
   look matched and that the bulb's own floor is respected.
3. Set a scene to 20 % across the room and confirm equal perceived brightness; check the
   circadian evening profile lands equally (its `brightness` output flows through the same
   command path).
4. Change the bulb's brightness from the vendor app and confirm homectl reports the logical
   value and does not fight the change.

## 4. Files likely to change

- `server/src/core/color_calibration.rs` (types, validation, forward/inverse, `calibrated_device`)
- `server/src/core/devices.rs` (report inversion)
- `server/src/core/calibration_session.rs` (preview field + handling)
- `server/src/api/config/calibration.rs` (only if request/response types need the new field)
- `server/tests/export_bindings.rs` (run), `ui/bindings/*` (regenerated)
- `ui/lib/colorCalibration.ts` (+ `.test.ts`), `ui/ui/ColorCalibrationWizard.tsx`,
  `ui/app/config/devices/page.tsx`, `ui/tests/calibration-wizard.test.cjs`
- `docs/color-calibration.md`, `docs/todo.md`

## 5. Risks, tradeoffs, open questions

1. **Interpolation space.** Piecewise-linear in raw % may mismatch mid-tones because perceived
   brightness is roughly a power function of duty. Anchors at 5/15/30/60/100 % mitigate it.
   Fallback if mid-tones still look off: interpolate in CIE L* (or log) instead of %; the data
   model is unchanged either way. Recommendation: start linear, revisit after the real-light
   test in Task 10.
2. **Clamping below the floor.** Logical requests below the lowest anchor collapse to the
   device floor (by design, per the todo). The deep-dim anchor keeps ESPHome bulbs dimming
   past the reference's minimum instead of being clamped up.
3. **Model-specific curves.** Assigning a brightness-bearing profile across models is exactly
   as risky as for colour (existing wording warns). Optionally record the reference device
   model on the profile for a stronger warning — not planned now.
4. **Naming.** `ColorCalibration*` types now carry brightness. Keep the names (churn) but fix
   the doc comments; revisit only if a third channel (e.g. CT) is ever calibrated.
5. **Reconciliation tolerance.** Comparisons stay physical (`0.01`), so a steep curve segment
   maps a small physical error to a larger logical error — acceptable; note it in the report
   tests if flakiness appears.
6. **Reference floor semantics.** Open question worth confirming with the user during Task 10:
   should levels below the reference's minimum remain selectable in the wizard (recommended,
   keeps the extra dim range) or should the UI stop at the reference floor?
