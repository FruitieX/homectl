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

fn position(hs: &Hs) -> (f32, f32) {
    let angle = (hs.h as f32).to_radians();
    (*hs.s * angle.cos(), *hs.s * angle.sin())
}

fn distance(a: &Hs, b: &Hs) -> f32 {
    let (ax, ay) = position(a);
    let (bx, by) = position(b);
    (ax - bx).powi(2) + (ay - by).powi(2)
}

fn hue_delta(from: u64, to: u64) -> f32 {
    (to as f32 - from as f32 + 180.0).rem_euclid(360.0) - 180.0
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
        let mut hue = 0.0;
        let mut saturation = 0.0;
        for point in &self.points {
            let d = distance(input, &point.reference);
            if d < 1e-8 {
                return DeviceColor::Hs(point.output.clone());
            }
            // Inverse-distance interpolation on the saturation/hue disk makes
            // the red seam continuous and distinguishes whites of equal hue.
            let weight = 1.0 / d;
            weight_sum += weight;
            hue += weight * hue_delta(point.reference.h, point.output.h);
            saturation += weight * (*point.output.s - *point.reference.s);
        }
        DeviceColor::new_from_hs(
            ((input.h as f32 + hue / weight_sum)
                .rem_euclid(360.0)
                .round() as u16)
                % 360,
            (*input.s + saturation / weight_sum).clamp(0.0, 1.0),
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
    fn circadian_anchors_are_exact() {
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
        assert_eq!(
            p.correct(&DeviceColor::new_from_hs(355, 0.9)),
            DeviceColor::new_from_hs(15, 1.0)
        );
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
