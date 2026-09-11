//! User-matched HSV anchors. State remains in reference space; only outbound
//! commands and the expected state used for reconciliation are corrected.
use crate::types::{
    color::{DeviceColor, Hs},
    device::{Device, DeviceData},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColorCalibrationPoint {
    pub reference: Hs,
    pub output: Hs,
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

fn position(hs: &Hs) -> (f32, f32) {
    let angle = (hs.h as f32).to_radians();
    (*hs.s * angle.cos(), *hs.s * angle.sin())
}

fn distance(a: &Hs, b: &Hs) -> f32 {
    let (ax, ay) = position(a);
    let (bx, by) = position(b);
    (ax - bx).powi(2) + (ay - by).powi(2)
}

impl DeviceColorCalibration {
    pub fn validate(&self) -> Result<(), String> {
        if self.device_key.trim().is_empty() || self.points.len() > 64 {
            return Err("Calibration needs a device key and at most 64 points".into());
        }
        for (index, point) in self.points.iter().enumerate() {
            for hs in [&point.reference, &point.output] {
                if hs.h >= 360 || !hs.s.is_finite() || !(0.0..=1.0).contains(&*hs.s) {
                    return Err("Hue must be 0–359 and saturation 0–1".into());
                }
            }
            if self.points[..index]
                .iter()
                .any(|other| distance(&point.reference, &other.reference) < 1e-8)
            {
                return Err("Reference colors must be distinct (white has no hue)".into());
            }
        }
        Ok(())
    }

    pub fn correct(&self, color: &DeviceColor) -> DeviceColor {
        // CT remains a separate hardware mode. XY/RGB inputs are left alone:
        // this profile explicitly calibrates the device's HSV command path.
        if self.points.is_empty() || self.validate().is_err() {
            return color.clone();
        }
        self.interpolate(color)
    }

    fn interpolate(&self, color: &DeviceColor) -> DeviceColor {
        let DeviceColor::Hs(input) = color else {
            return color.clone();
        };
        let mut weight_sum = 0.0;
        let (x, y) = position(input);
        let mut dx = 0.0;
        let mut dy = 0.0;
        for point in &self.points {
            let d = distance(input, &point.reference);
            if d < 1e-8 {
                return DeviceColor::Hs(point.output.clone());
            }
            // Blend chroma corrections on the hue/saturation disk. Both the
            // red seam and neutral white stay continuous, even when matching
            // white requires a tinted output (white itself has no hue).
            let weight = 1.0 / d;
            weight_sum += weight;
            let (rx, ry) = position(&point.reference);
            let (ox, oy) = position(&point.output);
            dx += weight * (ox - rx);
            dy += weight * (oy - ry);
        }
        if dx == 0.0 && dy == 0.0 {
            return color.clone();
        }
        let x = x + dx / weight_sum;
        let y = y + dy / weight_sum;
        DeviceColor::new_from_hs(
            (y.atan2(x).to_degrees().rem_euclid(360.0).round() as u16) % 360,
            x.hypot(y).clamp(0.0, 1.0),
        )
    }

    /// Best-fit reference for a report with no known corresponding command.
    /// Clipping makes inversion ambiguous, so callers prefer the last requested
    /// reference whenever its corrected value matches the report.
    pub fn reference_for_report(&self, color: &DeviceColor) -> DeviceColor {
        let DeviceColor::Hs(output) = color else {
            return color.clone();
        };
        if self.points.is_empty() || self.validate().is_err() {
            return color.clone();
        }
        if let Some(point) = self
            .points
            .iter()
            .find(|point| distance(output, &point.output) < 1e-8)
        {
            return DeviceColor::Hs(point.reference.clone());
        }
        let score = |h: u16, s: f32| {
            let DeviceColor::Hs(mapped) = self.interpolate(&DeviceColor::new_from_hs(h, s)) else {
                unreachable!()
            };
            distance(&mapped, output)
        };
        let mut best = (output.h as u16 % 360, *output.s);
        let mut error = score(best.0, best.1);
        for h in (0..360).step_by(15) {
            for s in 0..=10 {
                let candidate = (h, s as f32 / 10.0);
                let next = score(candidate.0, candidate.1);
                if next < error {
                    best = candidate;
                    error = next;
                }
            }
        }
        for (dh, ds) in [(8, 0.05), (4, 0.025), (2, 0.01), (1, 0.005), (1, 0.001)] {
            for _ in 0..8 {
                let previous = best;
                for hue in [-dh, 0, dh] {
                    for saturation in [-ds, 0.0, ds] {
                        let candidate = (
                            ((previous.0 as i32 + hue).rem_euclid(360)) as u16,
                            (previous.1 + saturation).clamp(0.0, 1.0),
                        );
                        let next = score(candidate.0, candidate.1);
                        if next < error {
                            best = candidate;
                            error = next;
                        }
                    }
                }
                if previous == best {
                    break;
                }
            }
        }
        DeviceColor::new_from_hs(best.0, best.1)
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
    fn hs(h: u16, s: f32) -> Hs {
        let DeviceColor::Hs(hs) = DeviceColor::new_from_hs(h, s) else {
            unreachable!()
        };
        hs
    }
    fn profile() -> DeviceColorCalibration {
        DeviceColorCalibration {
            device_key: "mqtt/lamp".into(),
            points: vec![
                ColorCalibrationPoint {
                    reference: hs(30, 0.25),
                    output: hs(55, 0.1),
                },
                ColorCalibrationPoint {
                    reference: hs(27, 0.9),
                    output: hs(35, 0.8),
                },
            ],
        }
    }
    #[test]
    fn matching_anchors_are_exact() {
        let p = profile();
        for point in &p.points {
            assert_eq!(
                p.correct(&DeviceColor::Hs(point.reference.clone())),
                DeviceColor::Hs(point.output.clone())
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
    fn wraps_hue_and_clamps_saturation() {
        let p = DeviceColorCalibration {
            device_key: "x/y".into(),
            points: vec![ColorCalibrationPoint {
                reference: hs(350, 0.5),
                output: hs(10, 1.0),
            }],
        };
        let DeviceColor::Hs(output) = p.correct(&DeviceColor::new_from_hs(355, 0.9)) else {
            unreachable!()
        };
        assert!(output.h < 20);
        assert_eq!(*output.s, 1.0);
    }
    #[test]
    fn white_correction_is_continuous_from_every_hue() {
        let p = DeviceColorCalibration {
            device_key: "x/y".into(),
            points: vec![ColorCalibrationPoint {
                reference: hs(0, 0.0),
                output: hs(30, 0.2),
            }],
        };
        for h in (0..360).step_by(30) {
            let DeviceColor::Hs(output) = p.correct(&DeviceColor::new_from_hs(h, 0.001)) else {
                unreachable!()
            };
            assert!(distance(&output, &hs(30, 0.2)) < 0.00001);
        }
    }
    #[test]
    fn rejects_invalid_and_duplicate_anchors() {
        let mut p = profile();
        p.points.push(p.points[0].clone());
        assert!(p.validate().is_err());
        p.points.pop();
        p.points[0].output.s = f32::NAN.into();
        assert!(p.validate().is_err());
    }

    #[test]
    fn report_inverse_recovers_anchors_and_intermediate_colors() {
        let p = profile();
        for point in &p.points {
            assert_eq!(
                p.reference_for_report(&DeviceColor::Hs(point.output.clone())),
                DeviceColor::Hs(point.reference.clone())
            );
        }
        for color in [hs(29, 0.5), hs(359, 0.7), hs(120, 0.6)] {
            let corrected = p.correct(&DeviceColor::Hs(color));
            let reference = p.reference_for_report(&corrected);
            let DeviceColor::Hs(round_trip) = p.correct(&reference) else {
                unreachable!()
            };
            let DeviceColor::Hs(expected) = corrected else {
                unreachable!()
            };
            assert!(distance(&round_trip, &expected) < 1e-4);
        }
    }
}
