//! Device-independent color calibration in CIE 1976 u′v′ chromaticity.
//! Brightness remains a separate controllable-state channel; only outbound
//! chromaticity and the expected state used for reconciliation are corrected.
use crate::types::{
    color::{DeviceColor, Xy},
    device::{Device, DeviceData},
};
use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Uv {
    pub u: OrderedFloat<f32>,
    pub v: OrderedFloat<f32>,
}

impl Uv {
    pub fn from_xy(xy: &Xy) -> Self {
        let denominator = -2.0 * *xy.x + 12.0 * *xy.y + 3.0;
        if !denominator.is_finite() || denominator.abs() <= f32::EPSILON {
            return Self::from_xy(&Xy {
                x: OrderedFloat(0.3127),
                y: OrderedFloat(0.3290),
            });
        }
        Self {
            u: OrderedFloat(4.0 * *xy.x / denominator),
            v: OrderedFloat(9.0 * *xy.y / denominator),
        }
    }

    pub fn to_xy(&self) -> Option<Xy> {
        let denominator = 6.0 * *self.u - 16.0 * *self.v + 12.0;
        if !denominator.is_finite() || denominator.abs() <= f32::EPSILON {
            return None;
        }
        let x = 9.0 * *self.u / denominator;
        let y = 4.0 * *self.v / denominator;
        (x.is_finite() && y.is_finite() && x >= 0.0 && y > 0.0 && x + y <= 1.0).then_some(Xy {
            x: OrderedFloat(x),
            y: OrderedFloat(y),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColorCalibrationPoint {
    pub reference: Uv,
    pub output: Uv,
}

/// One editable brightness anchor: `logical` is the brightness a person sees in
/// homectl, `output` is the brightness command sent to the device. Both are
/// fractions in `(0, 1]`; an empty curve means identity.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BrightnessCalibrationPoint {
    pub logical: OrderedFloat<f32>,
    pub output: OrderedFloat<f32>,
}

/// Brightness curves are authored by hand, so keep them small and ordered:
/// two points is the smallest useful mapping, sixteen is plenty for a dimmer.
pub const BRIGHTNESS_CURVE_MIN_POINTS: usize = 2;
pub const BRIGHTNESS_CURVE_MAX_POINTS: usize = 16;

/// Validate one brightness curve. An empty curve is valid (it means identity);
/// a curve with points must be strictly increasing in `logical`, non-decreasing
/// in `output`, and stay inside `(0, 1]`.
pub fn validate_brightness_points(points: &[BrightnessCalibrationPoint]) -> Result<(), String> {
    if points.is_empty() {
        return Ok(());
    }
    if points.len() < BRIGHTNESS_CURVE_MIN_POINTS {
        return Err(format!(
            "A brightness curve needs at least {BRIGHTNESS_CURVE_MIN_POINTS} points",
        ));
    }
    if points.len() > BRIGHTNESS_CURVE_MAX_POINTS {
        return Err(format!(
            "A brightness curve takes at most {BRIGHTNESS_CURVE_MAX_POINTS} points",
        ));
    }
    let mut previous: Option<BrightnessCalibrationPoint> = None;
    for point in points {
        let logical = point.logical.into_inner();
        let output = point.output.into_inner();
        if !logical.is_finite() || !output.is_finite() {
            return Err("Brightness points must be numbers".into());
        }
        if logical <= 0.0 || logical > 1.0 || output <= 0.0 || output > 1.0 {
            return Err("Brightness points run from just above 0% up to 100%".into());
        }
        if let Some(previous) = previous {
            if logical <= previous.logical.into_inner() {
                return Err("Desired brightness levels must strictly increase".into());
            }
            if output < previous.output.into_inner() {
                return Err("Target output must not decrease as brightness rises".into());
            }
        }
        previous = Some(*point);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeviceColorCalibration {
    pub device_key: String,
    #[serde(default)]
    pub points: Vec<ColorCalibrationPoint>,
    /// Brightness anchors resolved for this device; empty means identity.
    #[serde(default)]
    pub brightness_points: Vec<BrightnessCalibrationPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColorCalibrationProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub points: Vec<ColorCalibrationPoint>,
    #[serde(default)]
    pub reference_device_key: Option<String>,
    /// Light level used while matching color points. Metadata only — never an
    /// anchor or curve parameter — and defaulted so a brightness-only profile
    /// needs no color setup.
    #[serde(default = "default_profile_brightness")]
    pub brightness: f32,
    /// Brightness anchors; empty means identity.
    #[serde(default)]
    pub brightness_points: Vec<BrightnessCalibrationPoint>,
}

pub fn default_profile_brightness() -> f32 {
    1.0
}

impl ColorCalibrationProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 100
            || self.name.trim().is_empty()
            || self.name.len() > 200
        {
            return Err("Give the profile a valid id and a name (up to 200 characters)".into());
        }
        if !self.brightness.is_finite() || !(0.01..=1.0).contains(&self.brightness) {
            return Err("Match brightness must be between 1 and 100%".into());
        }
        // A profile may carry color points, a brightness curve, or both; one
        // valid channel is enough, and an empty profile is not a profile.
        DeviceColorCalibration {
            device_key: self.id.clone(),
            points: self.points.clone(),
            brightness_points: self.brightness_points.clone(),
        }
        .validate()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColorCalibrationAssignment {
    pub device_key: String,
    pub profile_id: String,
}

impl crate::db::config_queries::ConfigExport {
    pub fn calibration_for_device(&self, key: &str) -> Option<DeviceColorCalibration> {
        if let Some(assignment) = self
            .color_calibration_assignments
            .iter()
            .find(|row| row.device_key == key)
        {
            return self
                .color_calibration_profiles
                .iter()
                .find(|profile| profile.id == assignment.profile_id)
                .map(|profile| DeviceColorCalibration {
                    device_key: key.into(),
                    points: profile.points.clone(),
                    brightness_points: profile.brightness_points.clone(),
                });
        }
        self.device_color_calibrations
            .iter()
            .find(|row| row.device_key == key)
            .cloned()
    }

    pub fn validate_calibration_profiles(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for profile in &self.color_calibration_profiles {
            profile.validate()?;
            if !ids.insert(&profile.id) {
                return Err("Duplicate calibration profile id".into());
            }
        }
        let mut keys = std::collections::HashSet::new();
        for assignment in &self.color_calibration_assignments {
            if assignment.device_key.is_empty()
                || !ids.contains(&assignment.profile_id)
                || !keys.insert(&assignment.device_key)
            {
                return Err(
                    "Calibration assignments must have unique devices and an existing profile"
                        .into(),
                );
            }
        }
        Ok(())
    }
}

impl crate::core::state::AppState {
    pub async fn save_calibration_profile(
        &mut self,
        profile: ColorCalibrationProfile,
    ) -> Result<(), String> {
        profile.validate()?;
        let db = crate::db::get_db_connection().map_err(|error| error.to_string())?;
        crate::db::config_queries::calibration::save_profile(db, &profile)
            .await
            .map_err(|error| error.to_string())?;
        self.runtime_config
            .color_calibration_profiles
            .retain(|row| row.id != profile.id);
        self.runtime_config.color_calibration_profiles.push(profile);
        Ok(())
    }

    pub async fn assign_calibration_profile(
        &mut self,
        keys: Vec<String>,
        profile_id: Option<String>,
    ) -> Result<(), String> {
        if keys.is_empty() || keys.len() > 500 {
            return Err("Select between 1 and 500 lights".into());
        }
        if let Some(id) = &profile_id {
            if !self
                .runtime_config
                .color_calibration_profiles
                .iter()
                .any(|row| &row.id == id)
            {
                return Err("Calibration profile does not exist".into());
            }
        }
        // Which channels the profile carries decides who can take it: a
        // brightness-only curve fits a dimmer with no color support, and a
        // profile with color points needs the target's color path. Nothing is
        // dropped silently — the whole selection is validated first, and an
        // incompatible device is reported with its name.
        let channels = match &profile_id {
            Some(id) => {
                let profile = self
                    .runtime_config
                    .color_calibration_profiles
                    .iter()
                    .find(|row| &row.id == id)
                    .ok_or("Calibration profile does not exist")?;
                CalibrationChannels {
                    color: !profile.points.is_empty(),
                    brightness: !profile.brightness_points.is_empty(),
                }
            }
            // Removing an assignment asks nothing of the device's channels.
            None => CalibrationChannels {
                color: false,
                brightness: false,
            },
        };
        let mut devices = Vec::new();
        for key in &keys {
            if self.calibration_sessions.values().any(|session| {
                std::iter::once(&session.target)
                    .chain(session.reference.iter())
                    .any(|device| device.get_device_key().to_string() == *key)
            }) {
                return Err("Finish the calibration using this light as a reference before changing its profile".into());
            }
            devices.push(self.calibration_device_for(key, channels)?);
        }
        let db = crate::db::get_db_connection().map_err(|error| error.to_string())?;
        crate::db::config_queries::calibration::assign(db, &keys, profile_id.as_deref())
            .await
            .map_err(|error| error.to_string())?;
        self.runtime_config
            .color_calibration_assignments
            .retain(|row| !keys.contains(&row.device_key));
        self.runtime_config
            .device_color_calibrations
            .retain(|row| !keys.contains(&row.device_key));
        if let Some(id) = profile_id {
            for key in keys.into_iter().collect::<std::collections::BTreeSet<_>>() {
                self.runtime_config.color_calibration_assignments.push(
                    ColorCalibrationAssignment {
                        device_key: key,
                        profile_id: id.clone(),
                    },
                );
            }
        }
        for device in devices {
            self.event_tx
                .send(crate::types::event::Event::SetExternalState { device });
        }
        Ok(())
    }
}

fn distance(a: &Uv, b: &Uv) -> f32 {
    (*a.u - *b.u).powi(2) + (*a.v - *b.v).powi(2)
}

impl DeviceColorCalibration {
    /// True when the resolved calibration changes nothing.
    pub fn is_identity(&self) -> bool {
        self.points.is_empty() && self.brightness_points.is_empty()
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.device_key.trim().is_empty() || self.points.len() > 64 {
            return Err("Calibration needs a device key and at most 64 points".into());
        }
        // A calibration may correct color, brightness, or both; the channel
        // that is present must be valid, and at least one must be present.
        validate_brightness_points(&self.brightness_points)?;
        for (index, point) in self.points.iter().enumerate() {
            for uv in [&point.reference, &point.output] {
                if !uv.u.is_finite() || !uv.v.is_finite() || uv.to_xy().is_none() {
                    return Err("Calibration chromaticities must be valid CIE u′v′ colors".into());
                }
            }
            if self.points[..index]
                .iter()
                .any(|other| distance(&point.reference, &other.reference) < 1e-8)
            {
                return Err("Reference chromaticities must be distinct".into());
            }
        }
        if self.points.is_empty() && self.brightness_points.is_empty() {
            return Err("A calibration needs color points, a brightness curve, or both".into());
        }
        Ok(())
    }

    pub fn correct(&self, color: &DeviceColor) -> DeviceColor {
        // CT remains a separate hardware mode. RGB, HS and XY all enter the
        // same chromaticity calibration and are converted to transport format
        // only after correction.
        if self.points.is_empty() || self.validate().is_err() {
            return color.clone();
        }
        let Some(input) = color.to_xy().map(|xy| Uv::from_xy(&xy)) else {
            return color.clone();
        };
        if matches!(color, DeviceColor::Ct(_)) {
            return color.clone();
        }
        self.interpolate(&input)
            .to_xy()
            .map(DeviceColor::Xy)
            .unwrap_or_else(|| color.clone())
    }

    fn interpolate(&self, input: &Uv) -> Uv {
        let mut weight_sum = 0.0;
        let mut du = 0.0;
        let mut dv = 0.0;
        for point in &self.points {
            let d = distance(input, &point.reference);
            if d < 1e-8 {
                return point.output.clone();
            }
            // Inverse-distance blend of correction vectors in the more
            // perceptually uniform 1976 chromaticity plane.
            let weight = 1.0 / d;
            weight_sum += weight;
            du += weight * (*point.output.u - *point.reference.u);
            dv += weight * (*point.output.v - *point.reference.v);
        }
        if du == 0.0 && dv == 0.0 {
            return input.clone();
        }
        let candidate = Uv {
            u: OrderedFloat(*input.u + du / weight_sum),
            v: OrderedFloat(*input.v + dv / weight_sum),
        };
        if candidate.to_xy().is_some() {
            return candidate;
        }

        // An extreme collection of correction vectors can point outside the
        // physical xy chromaticity triangle. Project along the requested
        // correction until the result is valid instead of discontinuously
        // falling back to the uncalibrated input.
        let mut low = 0.0;
        let mut high = 1.0;
        let mut result = input.clone();
        for _ in 0..20 {
            let amount = (low + high) / 2.0;
            let projected = Uv {
                u: OrderedFloat(*input.u + (du / weight_sum) * amount),
                v: OrderedFloat(*input.v + (dv / weight_sum) * amount),
            };
            if projected.to_xy().is_some() {
                result = projected;
                low = amount;
            } else {
                high = amount;
            }
        }
        result
    }

    /// Best-fit reference for a report with no known corresponding command.
    /// Clipping makes inversion ambiguous, so callers prefer the last requested
    /// reference whenever its corrected value matches the report.
    pub fn reference_for_report(&self, color: &DeviceColor) -> DeviceColor {
        if matches!(color, DeviceColor::Ct(_)) {
            return color.clone();
        }
        if self.points.is_empty() || self.validate().is_err() {
            return color.clone();
        }
        let Some(output) = color.to_xy().map(|xy| Uv::from_xy(&xy)) else {
            return color.clone();
        };
        if let Some(point) = self
            .points
            .iter()
            .find(|point| distance(&output, &point.output) < 1e-8)
        {
            return point
                .reference
                .to_xy()
                .map(DeviceColor::Xy)
                .unwrap_or_else(|| color.clone());
        }
        // Fixed-point inversion is sufficient for the smooth, modest
        // correction field produced by visual matching. Normal command/report
        // reconciliation still prefers the exact last logical request.
        let mut reference = output.clone();
        for _ in 0..16 {
            let mapped = self.interpolate(&reference);
            let du = *output.u - *mapped.u;
            let dv = *output.v - *mapped.v;
            reference.u = OrderedFloat(*reference.u + du);
            reference.v = OrderedFloat(*reference.v + dv);
            if du * du + dv * dv < 1e-10 {
                break;
            }
        }
        reference
            .to_xy()
            .map(DeviceColor::Xy)
            .unwrap_or_else(|| color.clone())
    }
}

/// Map a logical brightness to the command a calibrated device receives.
///
/// Zero stays zero and a missing value stays missing, so a light that is off
/// never turns on through calibration. Positive values below the first anchor
/// clamp to its output, values above the last anchor clamp to its output, and
/// values in between interpolate linearly. A flat segment is allowed: a device
/// that quantizes gets the same output for a range of requests.
pub fn map_brightness_output(points: &[BrightnessCalibrationPoint], logical: f32) -> f32 {
    if points.is_empty() || !logical.is_finite() || logical <= 0.0 {
        return logical;
    }
    let first = points[0];
    if logical <= first.logical.into_inner() {
        return first.output.into_inner();
    }
    let last = points[points.len() - 1];
    if logical >= last.logical.into_inner() {
        return last.output.into_inner();
    }
    for pair in points.windows(2) {
        let [low, high] = [pair[0], pair[1]];
        let low_logical = low.logical.into_inner();
        let high_logical = high.logical.into_inner();
        if logical >= low_logical && logical <= high_logical {
            let span = high_logical - low_logical;
            if span <= 0.0 {
                return low.output.into_inner();
            }
            let ratio = (logical - low_logical) / span;
            let low_output = low.output.into_inner();
            let high_output = high.output.into_inner();
            return low_output + (high_output - low_output) * ratio;
        }
    }
    last.output.into_inner()
}

/// Map a physical brightness report back to the logical level a person asked
/// for. Used when a report has to become logical state and there is no request
/// to compare against; a plateau (or a clamp) resolves to its lowest logical
/// level, deterministically.
pub fn map_brightness_input(points: &[BrightnessCalibrationPoint], physical: f32) -> f32 {
    if points.is_empty() || !physical.is_finite() || physical <= 0.0 {
        return physical;
    }
    let mut best: Option<(f32, f32)> = None;
    for window in points.windows(2) {
        let [low, high] = [window[0], window[1]];
        let low_output = low.output.into_inner();
        let high_output = high.output.into_inner();
        if physical < low_output.min(high_output) || physical > low_output.max(high_output) {
            continue;
        }
        let span = high_output - low_output;
        // A flat segment cannot be inverted: the lowest logical level that
        // produced this output wins.
        let logical = if span <= 0.0 {
            low.logical.into_inner()
        } else {
            let ratio = (physical - low_output) / span;
            low.logical.into_inner()
                + (high.logical.into_inner() - low.logical.into_inner()) * ratio
        };
        if best.is_none_or(|(candidate, _)| logical < candidate) {
            best = Some((logical, low.output.into_inner()));
        }
    }
    if let Some((logical, _)) = best {
        return logical;
    }
    // Outside the curve: follow the clamp the forward map would have produced.
    if physical < points[0].output.into_inner() {
        points[0].logical.into_inner()
    } else {
        points[points.len() - 1].logical.into_inner()
    }
}

/// What a profile keeps when it is composed for one device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CalibrationChannels {
    pub color: bool,
    pub brightness: bool,
}

/// The identity of a composed profile, so the composition itself stays under
/// the argument limit and reads as "this profile, from these channels".
#[derive(Debug, Clone, Default)]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    pub reference_device_key: Option<String>,
}

/// Compose a profile for one device from what it resolves today plus the
/// channels being authored. The source profile is never mutated: a change to
/// brightness leaves every other device assigned to it untouched.
pub fn compose_profile_for_device(
    meta: ProfileMeta,
    existing: &DeviceColorCalibration,
    channels: CalibrationChannels,
    color_points: Vec<ColorCalibrationPoint>,
    brightness_points: Vec<BrightnessCalibrationPoint>,
    brightness: f32,
) -> ColorCalibrationProfile {
    let ProfileMeta {
        id,
        name,
        reference_device_key,
    } = meta;
    // A channel the new profile carries but for which nothing new was authored
    // keeps what the device resolves today, so adding brightness never drops an
    // existing color match (and the other way round).
    ColorCalibrationProfile {
        id,
        name,
        points: if !channels.color {
            Vec::new()
        } else if color_points.is_empty() {
            existing.points.clone()
        } else {
            color_points
        },
        reference_device_key,
        brightness,
        brightness_points: if !channels.brightness {
            Vec::new()
        } else if brightness_points.is_empty() {
            existing.brightness_points.clone()
        } else {
            brightness_points
        },
    }
}

pub fn calibrated_device(device: &Device, calibration: Option<&DeviceColorCalibration>) -> Device {
    let mut physical = device.clone();
    if let (Some(calibration), DeviceData::Controllable(data)) = (calibration, &mut physical.data) {
        if let Some(color) = &data.state.color {
            data.state.color = Some(calibration.correct(color));
        }
        // Brightness travels on its own channel: `None` and zero stay as they
        // are, so a saved next-on level can be mapped while the light is off.
        if let Some(brightness) = data.state.brightness {
            data.state.brightness = Some(OrderedFloat(map_brightness_output(
                &calibration.brightness_points,
                brightness.into_inner(),
            )));
        }
    }
    physical.color_to_preferred_mode()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, DeviceId, ManageKind},
    };

    fn curve() -> Vec<BrightnessCalibrationPoint> {
        vec![
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.10),
                output: OrderedFloat(0.04),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.50),
                output: OrderedFloat(0.30),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(1.00),
                output: OrderedFloat(0.80),
            },
        ]
    }

    #[test]
    fn brightness_curve_validation_accepts_identity_and_rejects_bad_curves() {
        assert!(validate_brightness_points(&[]).is_ok());

        let one = vec![BrightnessCalibrationPoint {
            logical: OrderedFloat(0.5),
            output: OrderedFloat(0.5),
        }];
        assert!(validate_brightness_points(&one).is_err());

        let duplicate = vec![
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.5),
                output: OrderedFloat(0.2),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.5),
                output: OrderedFloat(0.6),
            },
        ];
        assert!(validate_brightness_points(&duplicate).is_err());

        let descending = vec![
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.2),
                output: OrderedFloat(0.6),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.4),
                output: OrderedFloat(0.3),
            },
        ];
        assert!(validate_brightness_points(&descending).is_err());

        let out_of_range = vec![
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.0),
                output: OrderedFloat(0.2),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.5),
                output: OrderedFloat(1.2),
            },
        ];
        assert!(validate_brightness_points(&out_of_range).is_err());

        let too_many = (1..=17)
            .map(|index| BrightnessCalibrationPoint {
                logical: OrderedFloat(index as f32 / 100.0),
                output: OrderedFloat(index as f32 / 100.0),
            })
            .collect::<Vec<_>>();
        assert!(validate_brightness_points(&too_many).is_err());
    }

    #[test]
    fn brightness_maps_forward_with_identity_zero_and_clamps() {
        assert_eq!(map_brightness_output(&[], 0.42), 0.42);
        // Zero and a missing value never move.
        assert_eq!(map_brightness_output(&curve(), 0.0), 0.0);
        // Below the lowest anchor still clamps to it.
        assert_eq!(map_brightness_output(&curve(), 0.02), 0.04);
        // Above the highest anchor clamps to the top output, not to 100%.
        assert_eq!(map_brightness_output(&curve(), 1.0), 0.80);
        // Between anchors interpolates linearly.
        let middle = map_brightness_output(&curve(), 0.30);
        assert!((middle - 0.17).abs() < 1e-6, "got {middle}");
    }

    #[test]
    fn brightness_maps_back_from_a_report_deterministically() {
        assert_eq!(map_brightness_input(&curve(), 0.30), 0.50);
        let middle = map_brightness_input(&curve(), 0.17);
        assert!((middle - 0.30).abs() < 1e-5, "got {middle}");
        // A plateau resolves to its lowest logical level.
        let plateau = vec![
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.2),
                output: OrderedFloat(0.3),
            },
            BrightnessCalibrationPoint {
                logical: OrderedFloat(0.6),
                output: OrderedFloat(0.3),
            },
        ];
        assert_eq!(map_brightness_input(&plateau, 0.3), 0.2);
        // Outside the curve follows the forward clamp.
        assert_eq!(map_brightness_input(&curve(), 0.01), 0.10);
        assert_eq!(map_brightness_input(&curve(), 0.95), 1.0);
        assert_eq!(map_brightness_input(&[], 0.5), 0.5);
    }

    #[test]
    fn composition_keeps_the_other_channel_and_leaves_the_source_alone() {
        let source = DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            points: vec![ColorCalibrationPoint {
                reference: uv(30, 0.25),
                output: uv(55, 0.1),
            }],
            brightness_points: Vec::new(),
        };

        // Authoring brightness for a device that already matches color keeps
        // those color points in the new profile.
        let composed = compose_profile_for_device(
            ProfileMeta {
                id: "lamp-brightness".into(),
                name: "Lamp brightness".into(),
                reference_device_key: None,
            },
            &source,
            CalibrationChannels {
                color: true,
                brightness: true,
            },
            Vec::new(),
            curve(),
            1.0,
        );
        assert_eq!(composed.brightness_points.len(), 3);
        assert_eq!(source.brightness_points.len(), 0);
        assert_eq!(composed.points.len(), 1);

        // Removing brightness keeps color: the composed profile has no curve
        // and still carries the color points.
        let without_brightness = compose_profile_for_device(
            ProfileMeta {
                id: "lamp-color".into(),
                name: "Lamp color".into(),
                reference_device_key: None,
            },
            &source,
            CalibrationChannels {
                color: true,
                brightness: false,
            },
            source.points.clone(),
            Vec::new(),
            1.0,
        );
        assert!(without_brightness.brightness_points.is_empty());
        assert_eq!(without_brightness.points.len(), 1);
        without_brightness.validate().unwrap();

        // A profile with neither channel is not a profile.
        let empty = DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            points: Vec::new(),
            brightness_points: Vec::new(),
        };
        assert!(empty.validate().is_err());
    }

    #[test]
    fn legacy_json_deserializes_and_new_exports_round_trip() {
        // An old row has neither `brightness` nor `brightness_points`.
        let legacy = r#"{"id":"old","name":"Old","points":[]}"#;
        let profile: ColorCalibrationProfile = serde_json::from_str(legacy).unwrap();
        assert_eq!(profile.brightness, 1.0);
        assert!(profile.brightness_points.is_empty());
        // An empty color set alone is not valid any more, and a brightness
        // curve makes it valid.
        assert!(profile.validate().is_err());
        let brightness_only = ColorCalibrationProfile {
            brightness_points: curve(),
            ..profile
        };
        brightness_only.validate().unwrap();

        let round_tripped: ColorCalibrationProfile =
            serde_json::from_str(&serde_json::to_string(&brightness_only).unwrap()).unwrap();
        assert_eq!(
            round_tripped.brightness_points,
            brightness_only.brightness_points
        );
        assert!(round_tripped.brightness_points[0].logical.into_inner() > 0.0);

        // A combined profile carries both channels through an export, and the
        // resolved calibration of an assigned profile copies both sets.
        let combined = ColorCalibrationProfile {
            points: vec![ColorCalibrationPoint {
                reference: uv(30, 0.25),
                output: uv(55, 0.1),
            }],
            brightness_points: curve(),
            ..brightness_only.clone()
        };
        combined.validate().unwrap();
        let combined_round_trip: ColorCalibrationProfile =
            serde_json::from_str(&serde_json::to_string(&combined).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&combined_round_trip.points).unwrap(),
            serde_json::to_value(&combined.points).unwrap()
        );
        assert_eq!(
            combined_round_trip.brightness_points,
            combined.brightness_points
        );
        let resolved = DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            points: combined_round_trip.points.clone(),
            brightness_points: combined_round_trip.brightness_points.clone(),
        };
        assert_eq!(resolved.points.len(), 1);
        assert_eq!(resolved.brightness_points.len(), 3);
    }

    #[test]
    fn calibrated_device_maps_brightness_without_turning_anything_on() {
        let calibration = DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            points: Vec::new(),
            brightness_points: curve(),
        };

        // Off stays off, and a zero level stays zero.
        let off = lamp(
            Capabilities {
                brightness: Some(true),
                ..Capabilities::default()
            },
            DeviceColor::new_from_hs(30, 0.5),
        );
        let mut off = off;
        if let DeviceData::Controllable(data) = &mut off.data {
            data.state.power = false;
            data.state.brightness = Some(OrderedFloat(0.5));
        }
        let mapped = calibrated_device(&off, Some(&calibration));
        if let DeviceData::Controllable(data) = &mapped.data {
            assert!(!data.state.power);
            assert_eq!(
                data.state.brightness.map(|value| value.into_inner()),
                Some(0.30)
            );
        } else {
            panic!("expected a controllable device");
        }

        let mut zero = off.clone();
        if let DeviceData::Controllable(data) = &mut zero.data {
            data.state.brightness = Some(OrderedFloat(0.0));
        }
        let mapped_zero = calibrated_device(&zero, Some(&calibration));
        if let DeviceData::Controllable(data) = &mapped_zero.data {
            assert_eq!(
                data.state.brightness.map(|value| value.into_inner()),
                Some(0.0)
            );
        } else {
            panic!("expected a controllable device");
        }
    }

    fn uv(h: u16, s: f32) -> Uv {
        Uv::from_xy(&DeviceColor::new_from_hs(h, s).to_xy().unwrap())
    }

    fn profile() -> DeviceColorCalibration {
        DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            brightness_points: Vec::new(),
            points: vec![
                ColorCalibrationPoint {
                    reference: uv(30, 0.25),
                    output: uv(55, 0.1),
                },
                ColorCalibrationPoint {
                    reference: uv(27, 0.9),
                    output: uv(35, 0.8),
                },
            ],
        }
    }

    fn lamp(capabilities: Capabilities, color: DeviceColor) -> Device {
        Device {
            id: DeviceId::new("lamp"),
            name: "Lamp".into(),
            integration_id: "mqtt".parse().unwrap(),
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(1.0),
                Some(color),
                None,
                capabilities,
                ManageKind::Full,
            )),
            raw: None,
        }
    }

    #[test]
    fn matching_anchors_are_exact() {
        let p = profile();
        for point in &p.points {
            let input = DeviceColor::Xy(point.reference.to_xy().unwrap());
            assert_eq!(
                p.correct(&input),
                DeviceColor::Xy(point.output.to_xy().unwrap())
            );
        }
    }

    #[test]
    fn empty_and_other_modes_are_identity() {
        let mut p = profile();
        assert_eq!(
            p.correct(&DeviceColor::new_from_ct(2700)),
            DeviceColor::new_from_ct(2700)
        );
        p.points.clear();
        assert_eq!(
            p.correct(&DeviceColor::new_from_hs(120, 0.5)),
            DeviceColor::new_from_hs(120, 0.5)
        );
    }

    #[test]
    fn identity_calibration_keeps_neutral_white_neutral() {
        let white = uv(0, 0.0);
        let calibration = DeviceColorCalibration {
            device_key: "x/y".into(),
            brightness_points: Vec::new(),
            points: vec![ColorCalibrationPoint {
                reference: white.clone(),
                output: white,
            }],
        };
        let physical = calibrated_device(
            &lamp(
                Capabilities {
                    rgb: true,
                    ..Default::default()
                },
                DeviceColor::new_from_hs(237, 0.0),
            ),
            Some(&calibration),
        );
        let Some(DeviceColor::Rgb(rgb)) = physical.get_controllable_state().unwrap().color.as_ref()
        else {
            panic!("RGB-only device must receive RGB")
        };
        assert_eq!((rgb.r, rgb.g, rgb.b), (255, 255, 255));
    }

    #[test]
    fn calibrated_output_uses_each_devices_supported_transport() {
        let calibration = DeviceColorCalibration {
            device_key: "x/y".into(),
            brightness_points: Vec::new(),
            points: vec![ColorCalibrationPoint {
                reference: uv(0, 1.0),
                output: uv(120, 1.0),
            }],
        };
        for capabilities in [
            Capabilities::singleton(crate::types::color::ColorMode::Rgb),
            Capabilities::singleton(crate::types::color::ColorMode::Hs),
            Capabilities::singleton(crate::types::color::ColorMode::Xy),
        ] {
            let expected_rgb = capabilities.rgb;
            let expected_hs = capabilities.hs;
            let expected_xy = capabilities.xy;
            let physical = calibrated_device(
                &lamp(capabilities, DeviceColor::new_from_hs(0, 1.0)),
                Some(&calibration),
            );
            let color = physical
                .get_controllable_state()
                .unwrap()
                .color
                .as_ref()
                .unwrap();
            assert_eq!(matches!(color, DeviceColor::Rgb(_)), expected_rgb);
            assert_eq!(matches!(color, DeviceColor::Hs(_)), expected_hs);
            assert_eq!(matches!(color, DeviceColor::Xy(_)), expected_xy);
        }
    }

    #[test]
    fn rejects_invalid_and_duplicate_anchors() {
        let mut p = profile();
        p.points.push(p.points[0].clone());
        assert!(p.validate().is_err());
        p.points.pop();
        p.points[0].output.u = f32::NAN.into();
        assert!(p.validate().is_err());
    }

    #[test]
    fn extreme_interpolation_is_projected_to_valid_chromaticity() {
        let input = uv(240, 1.0);
        let calibration = DeviceColorCalibration {
            device_key: "x/y".into(),
            brightness_points: Vec::new(),
            points: vec![ColorCalibrationPoint {
                reference: uv(0, 1.0),
                output: uv(120, 1.0),
            }],
        };
        assert!(calibration.interpolate(&input).to_xy().is_some());
    }

    #[test]
    fn report_inverse_recovers_anchors_and_intermediate_colors() {
        let p = profile();
        for point in &p.points {
            let reported = DeviceColor::Xy(point.output.to_xy().unwrap());
            assert_eq!(
                p.reference_for_report(&reported),
                DeviceColor::Xy(point.reference.to_xy().unwrap())
            );
        }
        for color in [
            DeviceColor::new_from_hs(29, 0.5),
            DeviceColor::new_from_hs(359, 0.7),
            DeviceColor::new_from_rgb(80, 220, 120),
        ] {
            let corrected = p.correct(&color);
            let reference = p.reference_for_report(&corrected);
            let round_trip = Uv::from_xy(&p.correct(&reference).to_xy().unwrap());
            let expected = Uv::from_xy(&corrected.to_xy().unwrap());
            assert!(distance(&round_trip, &expected) < 1e-5);
        }
    }

    #[tokio::test]
    async fn assignment_eligibility_follows_the_channels_in_the_profile() {
        use crate::core::event::tests::test_state;
        use crate::types::{
            color::Capabilities,
            device::{ControllableDevice, DeviceData, DeviceId, ManageKind},
            integration::IntegrationId,
        };

        let (mut state, _rx) = test_state();
        let dimmer = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new("dimmer"),
            "Dimmer".into(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                false,
                Some(0.4),
                None,
                None,
                Capabilities {
                    brightness: Some(true),
                    ..Default::default()
                },
                ManageKind::Full,
            )),
            None,
        );
        state.devices.set_state(&dimmer, true, true);
        let key = dimmer.get_device_key().to_string();

        let brightness_only = ColorCalibrationProfile {
            id: "dimmer-curve".into(),
            name: "Dimmer curve".into(),
            points: Vec::new(),
            reference_device_key: None,
            brightness: 1.0,
            brightness_points: curve(),
        };
        state
            .runtime_config
            .color_calibration_profiles
            .push(brightness_only.clone());

        // A brightness-only profile fits a colourless dimmer: the eligibility
        // check never reaches the database on the way to the assignment.
        let refused = state
            .assign_calibration_profile(vec![key.clone()], Some("dimmer-curve".into()))
            .await
            .unwrap_err();
        assert!(
            !refused.contains("color"),
            "a brightness-only profile must accept a dimmer: {refused}"
        );

        // A profile that carries colour points is refused, by name, with the
        // channel that does not fit.
        state
            .runtime_config
            .color_calibration_profiles
            .push(ColorCalibrationProfile {
                id: "color-curve".into(),
                name: "Color curve".into(),
                points: vec![ColorCalibrationPoint {
                    reference: Uv::from_xy(&DeviceColor::new_from_hs(30, 0.3).to_xy().unwrap()),
                    output: Uv::from_xy(&DeviceColor::new_from_hs(60, 0.4).to_xy().unwrap()),
                }],
                reference_device_key: None,
                brightness: 0.5,
                brightness_points: Vec::new(),
            });
        let refused = state
            .assign_calibration_profile(vec![key.clone()], Some("color-curve".into()))
            .await
            .unwrap_err();
        assert!(refused.contains("Dimmer"), "{refused}");
        assert!(refused.contains("color"), "{refused}");
    }
}
