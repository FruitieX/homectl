//! Versioned circadian-compatibility preset (P11, D01–D03).
//!
//! Pure oracle extracted from the legacy circadian integration. The curve is
//! frozen: the day fade is linear, the night fade uses sine easing, color
//! temperature interpolation happens in Kelvin, and optional brightness
//! stays optional. The legacy integration delegates here so there is exactly
//! one implementation; its historical tests remain the golden baseline.
//!
//! [`CircadianCompatCurve::from_params`] validates the v2 parameter form
//! strictly (zero/negative durations, cross-midnight windows, overlapping
//! fades, out-of-range brightness, bad `HH:MM` strings). The legacy
//! integration constructs the curve through [`CircadianCompatCurve::new`],
//! which deliberately preserves the original silent interpretation for
//! configs that predate validation.

use chrono::{Duration, NaiveTime};
use ordered_float::OrderedFloat;
use palette::{IntoColor, Mix};

use crate::types::automation_source::{CircadianCompatParams, LightProfile};
use crate::types::color::DeviceColor;

/// Version of the shipped circadian-compatibility preset. Stored in source
/// definitions so a future preset update is a deliberate migration.
pub const CIRCADIAN_COMPAT_PRESET_VERSION: u32 = 1;

/// Device transition published with every profile, in milliseconds. The
/// legacy integration published its 60-second poll rate as the transition.
pub const CIRCADIAN_COMPAT_TRANSITION_MS: u64 = 60_000;

/// A validated circadian-compatibility curve. All fields are derived from
/// the parameters; the curve itself has no clock or I/O.
#[derive(Clone, Debug)]
pub struct CircadianCompatCurve {
    day_fade_start: NaiveTime,
    day_fade_end: NaiveTime,
    day_fade_duration: Duration,
    day_color: DeviceColor,
    day_brightness: Option<f32>,

    night_fade_start: NaiveTime,
    night_fade_end: NaiveTime,
    night_fade_duration: Duration,
    night_color: DeviceColor,
    night_brightness: Option<f32>,
}

impl CircadianCompatCurve {
    /// Legacy constructor: no validation, preserving the original behavior
    /// for configs the old integration accepted.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        day_fade_start: NaiveTime,
        day_fade_duration: Duration,
        day_color: DeviceColor,
        day_brightness: Option<f32>,
        night_fade_start: NaiveTime,
        night_fade_duration: Duration,
        night_color: DeviceColor,
        night_brightness: Option<f32>,
    ) -> Self {
        Self {
            day_fade_end: day_fade_start + day_fade_duration,
            night_fade_end: night_fade_start + night_fade_duration,
            day_fade_start,
            day_fade_duration,
            day_color,
            day_brightness,
            night_fade_start,
            night_fade_duration,
            night_color,
            night_brightness,
        }
    }

    /// Strict v2 constructor. Returns a descriptive error instead of
    /// silently interpreting an ambiguous configuration (D03).
    pub fn from_params(params: &CircadianCompatParams) -> Result<Self, String> {
        let day_fade_start = parse_hh_mm("day_fade_start", &params.day_fade_start)?;
        let night_fade_start = parse_hh_mm("night_fade_start", &params.night_fade_start)?;
        validate_duration_hours("day_fade_duration_hours", params.day_fade_duration_hours)?;
        validate_duration_hours(
            "night_fade_duration_hours",
            params.night_fade_duration_hours,
        )?;
        validate_brightness("day_brightness", params.day_brightness)?;
        validate_brightness("night_brightness", params.night_brightness)?;

        let day_fade_duration = Duration::hours(params.day_fade_duration_hours);
        let night_fade_duration = Duration::hours(params.night_fade_duration_hours);
        let day_fade_end = day_fade_start + day_fade_duration;
        let night_fade_end = night_fade_start + night_fade_duration;

        if day_fade_end <= day_fade_start {
            return Err("day_fade_start: the day fade must not cross midnight.".to_string());
        }
        if night_fade_end <= night_fade_start {
            return Err("night_fade_start: the night fade must not cross midnight.".to_string());
        }
        if day_fade_end > night_fade_start {
            return Err(format!(
                "day and night fades overlap: the day fade ends at {} but the night fade starts at {}.",
                day_fade_end.format("%H:%M"),
                night_fade_start.format("%H:%M"),
            ));
        }

        Ok(Self::new(
            day_fade_start,
            day_fade_duration,
            params.day_color.clone(),
            params.day_brightness,
            night_fade_start,
            night_fade_duration,
            params.night_color.clone(),
            params.night_brightness,
        ))
    }

    /// Night-fade factor at an injected local time: `1.0` at night, `0.0`
    /// during the day, interpolated through the two fades.
    pub fn night_fade_at(&self, local: NaiveTime) -> f32 {
        if local <= self.day_fade_start || local >= self.night_fade_end {
            return 1.0;
        }
        if local >= self.day_fade_end && local <= self.night_fade_start {
            return 0.0;
        }

        if local < self.day_fade_end {
            // fading from night to day: linear
            let d = local - self.day_fade_start;
            let p = d.num_milliseconds() as f32 / self.day_fade_duration.num_milliseconds() as f32;

            1.0 - p
        } else {
            // fading from day to night: sine easing
            let d = local - self.night_fade_start;
            let p =
                d.num_milliseconds() as f32 / self.night_fade_duration.num_milliseconds() as f32;
            f32::sin(p * std::f32::consts::PI / 2.0)
        }
    }

    /// Color at a night-fade factor. Color temperature interpolates in
    /// Kelvin and rounds to whole Kelvin; other pairs mix through
    /// chromaticity in HSV.
    pub fn color_at(&self, i: f32) -> DeviceColor {
        match (self.day_color.clone(), self.night_color.clone()) {
            (DeviceColor::Hs(day), DeviceColor::Hs(night)) => {
                let day = palette::Hsv::new(day.h as f32, *day.s, 1.0);
                let night = palette::Hsv::new(night.h as f32, *night.s, 1.0);
                let color = day.mix(night, i);

                color.into()
            }
            (DeviceColor::Ct(day), DeviceColor::Ct(night)) => {
                let ct = ((1.0 - i) * day.ct as f32 + i * night.ct as f32)
                    .round()
                    .clamp(0.0, u16::MAX as f32) as u16;
                DeviceColor::new_from_kelvin(ct)
            }
            (day, night) => {
                let day_yxy: palette::Yxy = (&day).into();
                let night_yxy: palette::Yxy = (&night).into();
                let day: palette::Hsv = day_yxy.into_color();
                let night: palette::Hsv = night_yxy.into_color();

                day.mix(night, i).into()
            }
        }
    }

    /// Brightness at a night-fade factor. Absence on either end keeps the
    /// output absent.
    pub fn brightness_at(&self, i: f32) -> Option<f32> {
        match (self.day_brightness, self.night_brightness) {
            (Some(day), Some(night)) => Some((1.0 - i) * day + i * night),
            (_, _) => None,
        }
    }

    /// Complete profile at an injected local time. The transition matches
    /// the legacy integration's published transition.
    pub fn profile_at(&self, local: NaiveTime) -> LightProfile {
        let i = self.night_fade_at(local);
        LightProfile {
            color: Some(self.color_at(i)),
            brightness: self.brightness_at(i).map(OrderedFloat),
            transition_ms: Some(CIRCADIAN_COMPAT_TRANSITION_MS),
        }
    }
}

fn parse_hh_mm(field: &str, value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| format!("{field}: expected a HH:MM civil time, got {value:?}."))
}

fn validate_duration_hours(field: &str, hours: i64) -> Result<(), String> {
    if !(1..=24).contains(&hours) {
        return Err(format!(
            "{field}: must be between 1 and 24 whole hours, got {hours}."
        ));
    }
    Ok(())
}

fn validate_brightness(field: &str, brightness: Option<f32>) -> Result<(), String> {
    if let Some(brightness) = brightness {
        if !brightness.is_finite() || !(0.0..=1.0).contains(&brightness) {
            return Err(format!(
                "{field}: must be finite and within 0.0..=1.0, got {brightness}."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(hour: u32, minute: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(hour, minute, 0).unwrap()
    }

    fn params() -> CircadianCompatParams {
        CircadianCompatParams {
            day_fade_start: "06:00".to_string(),
            day_fade_duration_hours: 2,
            day_color: DeviceColor::new_from_kelvin(3000),
            day_brightness: Some(0.8),
            night_fade_start: "20:00".to_string(),
            night_fade_duration_hours: 2,
            night_color: DeviceColor::new_from_kelvin(2000),
            night_brightness: Some(0.2),
        }
    }

    fn curve() -> CircadianCompatCurve {
        CircadianCompatCurve::from_params(&params()).unwrap()
    }

    /// D01: golden samples of the legacy fade curve, including boundaries.
    #[test]
    fn d01_legacy_fade_golden_samples() {
        let curve = curve();
        // Boundaries and outside both fades.
        assert_eq!(curve.night_fade_at(time(3, 0)), 1.0);
        assert_eq!(curve.night_fade_at(time(6, 0)), 1.0);
        assert_eq!(curve.night_fade_at(time(8, 0)), 0.0);
        assert_eq!(curve.night_fade_at(time(12, 0)), 0.0);
        assert_eq!(curve.night_fade_at(time(20, 0)), 0.0);
        assert_eq!(curve.night_fade_at(time(22, 0)), 1.0);
        assert_eq!(curve.night_fade_at(time(23, 0)), 1.0);

        // Linear day fade: quarter, half, three-quarter.
        assert!((curve.night_fade_at(time(6, 30)) - 0.75).abs() < 1e-6);
        assert!((curve.night_fade_at(time(7, 0)) - 0.5).abs() < 1e-6);
        assert!((curve.night_fade_at(time(7, 30)) - 0.25).abs() < 1e-6);

        // Sine-eased night fade.
        assert!(
            (curve.night_fade_at(time(20, 30)) - (std::f32::consts::PI / 8.0).sin()).abs() < 1e-6
        );
        assert!((curve.night_fade_at(time(21, 0)) - (2f32.sqrt() / 2.0)).abs() < 1e-6);
        assert!(
            (curve.night_fade_at(time(21, 30)) - (3.0 * std::f32::consts::PI / 8.0).sin()).abs()
                < 1e-6
        );
    }

    /// D02: color mixing, Kelvin rounding, optional brightness, transition.
    #[test]
    fn d02_color_and_brightness_mapping() {
        let curve = curve();

        // Kelvin interpolation is linear and rounds to whole Kelvin.
        assert_eq!(curve.color_at(0.0), DeviceColor::new_from_kelvin(3000));
        assert_eq!(curve.color_at(0.25), DeviceColor::new_from_kelvin(2750));
        assert_eq!(curve.color_at(0.5), DeviceColor::new_from_kelvin(2500));
        assert_eq!(curve.color_at(1.0), DeviceColor::new_from_kelvin(2000));

        // Optional brightness: both present interpolates, absence stays absent.
        assert_eq!(curve.brightness_at(0.5), Some(0.5));
        let absent = CircadianCompatParams {
            day_brightness: Some(0.8),
            night_brightness: None,
            ..params()
        };
        let absent = CircadianCompatCurve::from_params(&absent).unwrap();
        assert_eq!(absent.brightness_at(0.5), None);

        // The composed profile carries the legacy transition.
        let profile = curve.profile_at(time(12, 0));
        assert_eq!(profile.color, Some(DeviceColor::new_from_kelvin(3000)));
        assert_eq!(profile.brightness, Some(OrderedFloat(0.8)));
        assert_eq!(profile.transition_ms, Some(CIRCADIAN_COMPAT_TRANSITION_MS));
        profile.validate().unwrap();
    }

    /// D02: HS pairs mix in HSV with value forced to 1.0, and the endpoints
    /// are preserved.
    #[test]
    fn d02_hs_pair_mixes_in_hsv() {
        let params = CircadianCompatParams {
            day_color: DeviceColor::new_from_hs(60, 1.0),
            night_color: DeviceColor::new_from_hs(240, 1.0),
            ..params()
        };
        let curve = CircadianCompatCurve::from_params(&params).unwrap();
        assert_eq!(curve.color_at(0.0), DeviceColor::new_from_hs(60, 1.0));
        assert_eq!(curve.color_at(1.0), DeviceColor::new_from_hs(240, 1.0));

        let middle = curve.color_at(0.5);
        let DeviceColor::Hs(hs) = middle else {
            panic!("expected an HS mix");
        };
        assert!((120..=180).contains(&hs.h), "unexpected hue {}", hs.h);
    }

    /// D03: ambiguous or invalid v2 parameters are reported, not normalized.
    #[test]
    fn d03_invalid_params_are_reported() {
        let zero_duration = CircadianCompatParams {
            day_fade_duration_hours: 0,
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&zero_duration)
            .unwrap_err()
            .contains("day_fade_duration_hours"));

        let negative_duration = CircadianCompatParams {
            night_fade_duration_hours: -2,
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&negative_duration)
            .unwrap_err()
            .contains("night_fade_duration_hours"));

        let cross_midnight = CircadianCompatParams {
            night_fade_start: "23:00".to_string(),
            night_fade_duration_hours: 4,
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&cross_midnight)
            .unwrap_err()
            .contains("cross midnight"));

        let overlap = CircadianCompatParams {
            day_fade_duration_hours: 16,
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&overlap)
            .unwrap_err()
            .contains("overlap"));

        let bad_time = CircadianCompatParams {
            day_fade_start: "6am".to_string(),
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&bad_time)
            .unwrap_err()
            .contains("HH:MM"));

        let bad_brightness = CircadianCompatParams {
            day_brightness: Some(1.5),
            ..params()
        };
        assert!(CircadianCompatCurve::from_params(&bad_brightness)
            .unwrap_err()
            .contains("day_brightness"));

        let valid = CircadianCompatCurve::from_params(&params()).unwrap();
        assert_eq!(valid.profile_at(time(12, 0)).transition_ms, Some(60_000));
    }
}
