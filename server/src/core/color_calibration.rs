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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeviceColorCalibration {
    pub device_key: String,
    #[serde(default)]
    pub points: Vec<ColorCalibrationPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColorCalibrationProfile {
    pub id: String,
    pub name: String,
    pub points: Vec<ColorCalibrationPoint>,
    #[serde(default)]
    pub reference_device_key: Option<String>,
    pub brightness: f32,
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
        if self.points.is_empty()
            || !self.brightness.is_finite()
            || !(0.01..=1.0).contains(&self.brightness)
        {
            return Err(
                "A profile needs matching points and a brightness between 1 and 100%".into(),
            );
        }
        DeviceColorCalibration {
            device_key: self.id.clone(),
            points: self.points.clone(),
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
        // Validate the whole selection before touching either storage or runtime.
        let mut devices = Vec::new();
        for key in &keys {
            if self
                .calibration_sessions
                .values()
                .any(|session| session.reference.get_device_key().to_string() == *key)
            {
                return Err("Finish the calibration using this light as a reference before changing its profile".into());
            }
            devices.push(self.calibration_device(key)?);
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
    pub fn validate(&self) -> Result<(), String> {
        if self.device_key.trim().is_empty() || self.points.len() > 64 {
            return Err("Calibration needs a device key and at most 64 points".into());
        }
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

pub fn calibrated_device(device: &Device, calibration: Option<&DeviceColorCalibration>) -> Device {
    let mut physical = device.clone();
    if let (Some(calibration), DeviceData::Controllable(data)) = (calibration, &mut physical.data) {
        if let Some(color) = &data.state.color {
            data.state.color = Some(calibration.correct(color));
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

    fn uv(h: u16, s: f32) -> Uv {
        Uv::from_xy(&DeviceColor::new_from_hs(h, s).to_xy().unwrap())
    }

    fn profile() -> DeviceColorCalibration {
        DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
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
}
