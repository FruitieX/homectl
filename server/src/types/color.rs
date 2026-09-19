use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use serde_this_or_that::as_u64;
use ts_rs::TS;

#[derive(TS, Clone, Debug, Default, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Capabilities {
    /// Explicit dimming support. Legacy integrations are normalized at ingestion.
    /// Set false to override color-based legacy inference for switches/heaters.
    #[serde(default)]
    pub brightness: Option<bool>,
    /// XY color space (0.0 - 1.0)
    #[serde(default)]
    pub xy: bool,

    /// Hue (0 - 360) and saturation (0.0 - 1.0)
    #[serde(default)]
    pub hs: bool,

    /// RGB values (0 - 255)
    #[serde(default)]
    pub rgb: bool,

    /// Color temperature (2000 - 6500)
    pub ct: Option<std::ops::Range<u16>>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub enum ColorMode {
    Xy,
    Hs,
    Rgb,
    Ct(std::ops::Range<u16>),
}

impl Capabilities {
    pub fn singleton(mode: ColorMode) -> Capabilities {
        let mut xy = false;
        let mut hs = false;
        let mut rgb = false;
        let mut ct = None;

        match mode {
            ColorMode::Xy => {
                xy = true;
            }
            ColorMode::Hs => {
                hs = true;
            }
            ColorMode::Rgb => {
                rgb = true;
            }
            ColorMode::Ct(range) => {
                ct = Some(range);
            }
        };

        Capabilities {
            xy,
            hs,
            rgb,
            ct,
            brightness: Some(true),
        }
    }

    pub fn is_supported(&self, color: &DeviceColor) -> bool {
        match color {
            DeviceColor::Xy(_) => self.xy,
            DeviceColor::Hs(_) => self.hs,
            DeviceColor::Rgb(_) => self.rgb,
            DeviceColor::Ct(_) => self.ct.is_some(),
        }
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Xy {
    pub x: OrderedFloat<f32>,

    pub y: OrderedFloat<f32>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Hs {
    #[serde(deserialize_with = "as_u64")]
    #[ts(type = "number")]
    pub h: u64,

    pub s: OrderedFloat<f32>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Rgb {
    #[serde(deserialize_with = "as_u64")]
    #[ts(type = "number")]
    pub r: u64,

    #[serde(deserialize_with = "as_u64")]
    #[ts(type = "number")]
    pub g: u64,

    #[serde(deserialize_with = "as_u64")]
    #[ts(type = "number")]
    pub b: u64,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Ct {
    #[serde(deserialize_with = "as_u64")]
    #[ts(type = "number")]
    pub ct: u64,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[serde(untagged)]
#[ts(export)]
pub enum DeviceColor {
    Xy(Xy),
    Hs(Hs),
    Rgb(Rgb),
    Ct(Ct),
}

impl Ct {
    /// The repo stores color temperature in Kelvin in `ct`, never mireds.
    pub fn from_kelvin(kelvin: u16) -> Self {
        Ct { ct: kelvin as u64 }
    }
}

impl DeviceColor {
    const D65_X: f32 = 0.3127;
    const D65_Y: f32 = 0.3290;

    pub fn new_from_xy(x: f32, y: f32) -> DeviceColor {
        DeviceColor::Xy(Xy {
            x: OrderedFloat(x),
            y: OrderedFloat(y),
        })
    }

    pub fn new_from_hs(h: u16, s: f32) -> DeviceColor {
        DeviceColor::Hs(Hs {
            h: h as u64,
            s: OrderedFloat(s),
        })
    }

    pub fn new_from_rgb(r: u8, g: u8, b: u8) -> DeviceColor {
        DeviceColor::Rgb(Rgb {
            r: r as u64,
            g: g as u64,
            b: b as u64,
        })
    }

    pub fn new_from_ct(ct: u16) -> DeviceColor {
        DeviceColor::Ct(Ct { ct: ct as u64 })
    }

    /// Named Kelvin constructor, making the unit explicit at call sites.
    pub fn new_from_kelvin(kelvin: u16) -> DeviceColor {
        DeviceColor::Ct(Ct::from_kelvin(kelvin))
    }

    pub fn to_device_preferred_mode(&self, capabilities: &Capabilities) -> Option<DeviceColor> {
        // Don't perform any conversion if device supports current color mode
        if capabilities.is_supported(self) {
            return Some(self.clone());
        }

        // Convert through chromaticity only. Brightness/value is represented by
        // ControllableState::brightness and must not leak into color conversion.
        let xy = self.to_xy()?;
        if capabilities.xy {
            Some(DeviceColor::Xy(xy))
        } else if capabilities.hs {
            Some(DeviceColor::Hs(Self::xy_to_hs(&xy)))
        } else if capabilities.rgb {
            Some(DeviceColor::Rgb(Self::xy_to_rgb(&xy)))
        } else if let Some(supported_range) = &capabilities.ct {
            // McCamy's approximation
            let x = *xy.x;
            let y = *xy.y;
            let n = (x - 0.3320) / (0.1858 - y);
            let cct = (437.0 * n.powi(3) + 3601.0 * n.powi(2) + 6861.0 * n + 5517.0) as u16;

            let clamped = cct.clamp(supported_range.start, supported_range.end);
            Some(clamped.into())
        } else {
            None
        }
    }

    /// Convert any color representation to CIE 1931 xy chromaticity.
    /// Luminance/value is intentionally discarded.
    pub fn to_xy(&self) -> Option<Xy> {
        match self {
            DeviceColor::Xy(xy) => Some(xy.clone()),
            DeviceColor::Hs(hs) => {
                let rgb = Self::hs_to_srgb(hs);
                Some(Self::srgb_to_xy(rgb.0, rgb.1, rgb.2))
            }
            DeviceColor::Rgb(rgb) => Some(Self::srgb_to_xy(
                rgb.r.min(255) as f32 / 255.0,
                rgb.g.min(255) as f32 / 255.0,
                rgb.b.min(255) as f32 / 255.0,
            )),
            DeviceColor::Ct(ct) => {
                // http://www.brucelindbloom.com/index.html?Eqn_T_to_xy.html
                let t = (ct.ct as f32).clamp(1667.0, 25000.0);
                let x = if t <= 7000.0 {
                    -4.607 * 1e9 / t.powi(3)
                        + 2.9678 * 1e6 / t.powi(2)
                        + 0.09911 * 1e3 / t
                        + 0.244063
                } else {
                    -2.0064 * 1e9 / t.powi(3)
                        + 1.9018 * 1e6 / t.powi(2)
                        + 0.24748 * 1e3 / t
                        + 0.23704
                };
                let y = -3.0 * x.powi(2) + 2.87 * x - 0.275;
                Some(Xy {
                    x: OrderedFloat(x),
                    y: OrderedFloat(y),
                })
            }
        }
    }

    /// Perceptual chromaticity distance in CIE 1976 u′v′. This is the same
    /// space used by device color calibration and is far more uniform than
    /// raw CIE 1931 xy deltas.
    pub fn uv_distance(a: &Xy, b: &Xy) -> f32 {
        let to_uv = |xy: &Xy| -> (f32, f32) {
            let denominator = -2.0 * *xy.x + 12.0 * *xy.y + 3.0;
            if !denominator.is_finite() || denominator.abs() <= f32::EPSILON {
                let d65 = -2.0 * Self::D65_X + 12.0 * Self::D65_Y + 3.0;
                return (4.0 * Self::D65_X / d65, 9.0 * Self::D65_Y / d65);
            }
            (4.0 * *xy.x / denominator, 9.0 * *xy.y / denominator)
        };
        let (au, av) = to_uv(a);
        let (bu, bv) = to_uv(b);
        ((au - bu).powi(2) + (av - bv).powi(2)).sqrt()
    }

    pub fn to_hs(&self) -> Option<Hs> {
        match self {
            DeviceColor::Hs(hs) => Some(hs.clone()),
            _ => self.to_xy().map(|xy| Self::xy_to_hs(&xy)),
        }
    }

    pub fn to_rgb(&self) -> Option<Rgb> {
        match self {
            DeviceColor::Rgb(rgb) => Some(rgb.clone()),
            _ => self.to_xy().map(|xy| Self::xy_to_rgb(&xy)),
        }
    }

    fn hs_to_srgb(hs: &Hs) -> (f32, f32, f32) {
        let hue = (hs.h % 360) as f32;
        let saturation = (*hs.s).clamp(0.0, 1.0);
        let chroma = saturation;
        let x = chroma * (1.0 - ((hue / 60.0).rem_euclid(2.0) - 1.0).abs());
        let (r, g, b) = match (hue / 60.0).floor() as u8 {
            0 => (chroma, x, 0.0),
            1 => (x, chroma, 0.0),
            2 => (0.0, chroma, x),
            3 => (0.0, x, chroma),
            4 => (x, 0.0, chroma),
            _ => (chroma, 0.0, x),
        };
        let m = 1.0 - chroma;
        (r + m, g + m, b + m)
    }

    fn srgb_to_xy(red: f32, green: f32, blue: f32) -> Xy {
        let linear = |channel: f32| {
            let channel = channel.clamp(0.0, 1.0);
            if channel <= 0.04045 {
                channel / 12.92
            } else {
                ((channel + 0.055) / 1.055).powf(2.4)
            }
        };
        let r = linear(red);
        let g = linear(green);
        let b = linear(blue);
        let x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
        let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
        let z = 0.0193339 * r + 0.119_192 * g + 0.9503041 * b;
        let sum = x + y + z;
        if !sum.is_finite() || sum <= f32::EPSILON {
            return Xy {
                x: OrderedFloat(Self::D65_X),
                y: OrderedFloat(Self::D65_Y),
            };
        }
        Xy {
            x: OrderedFloat(x / sum),
            y: OrderedFloat(y / sum),
        }
    }

    fn xy_to_srgb(xy: &Xy) -> (f32, f32, f32) {
        let x = (*xy.x).clamp(0.0, 1.0);
        let y = (*xy.y).clamp(0.000001, 1.0);
        let z = (1.0 - x - y).max(0.0);
        // Y=1 chooses an arbitrary luminance. Normalize after conversion so
        // chromaticity is retained while value remains the caller's concern.
        let xyz_x = x / y;
        let xyz_y = 1.0;
        let xyz_z = z / y;
        let mut r = 3.2404542 * xyz_x - 1.5371385 * xyz_y - 0.4985314 * xyz_z;
        let mut g = -0.969_266 * xyz_x + 1.8760108 * xyz_y + 0.0415560 * xyz_z;
        let mut b = 0.0556434 * xyz_x - 0.2040259 * xyz_y + 1.0572252 * xyz_z;
        r = r.max(0.0);
        g = g.max(0.0);
        b = b.max(0.0);
        let max = r.max(g).max(b);
        if !max.is_finite() || max <= f32::EPSILON {
            return (1.0, 1.0, 1.0);
        }
        r /= max;
        g /= max;
        b /= max;
        let gamma = |channel: f32| {
            if channel <= 0.0031308 {
                12.92 * channel
            } else {
                1.055 * channel.powf(1.0 / 2.4) - 0.055
            }
        };
        (gamma(r), gamma(g), gamma(b))
    }

    fn xy_to_rgb(xy: &Xy) -> Rgb {
        let (r, g, b) = Self::xy_to_srgb(xy);
        let channel = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u64;
        Rgb {
            r: channel(r),
            g: channel(g),
            b: channel(b),
        }
    }

    fn xy_to_hs(xy: &Xy) -> Hs {
        let (r, g, b) = Self::xy_to_srgb(xy);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let delta = max - min;
        let hue = if delta <= 0.000001 {
            0.0
        } else if max == r {
            60.0 * ((g - b) / delta).rem_euclid(6.0)
        } else if max == g {
            60.0 * ((b - r) / delta + 2.0)
        } else {
            60.0 * ((r - g) / delta + 4.0)
        };
        Hs {
            h: hue.round().rem_euclid(360.0) as u64,
            s: OrderedFloat(if max <= f32::EPSILON {
                0.0
            } else {
                delta / max
            }),
        }
    }
}

impl From<u16> for DeviceColor {
    fn from(ct: u16) -> Self {
        DeviceColor::Ct(Ct { ct: ct as u64 })
    }
}

// Keep the small palette interoperability surface used by the circadian
// integration while all device-bound conversion goes through the explicit,
// brightness-independent helpers above.
impl From<palette::Hsv> for DeviceColor {
    fn from(hsv: palette::Hsv) -> Self {
        DeviceColor::new_from_hs(
            hsv.hue.into_positive_degrees().round().rem_euclid(360.0) as u16,
            hsv.saturation,
        )
    }
}

impl From<&DeviceColor> for palette::Yxy {
    fn from(color: &DeviceColor) -> Self {
        let xy = color.to_xy().unwrap_or(Xy {
            x: OrderedFloat(DeviceColor::D65_X),
            y: OrderedFloat(DeviceColor::D65_Y),
        });
        palette::Yxy::from_components((*xy.x, *xy.y, 1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb_capabilities() -> Capabilities {
        Capabilities {
            brightness: Some(true),
            rgb: true,
            ..Default::default()
        }
    }

    #[test]
    fn zero_saturation_is_neutral_rgb_at_every_hue() {
        for hue in (0..360).step_by(15) {
            assert_eq!(
                DeviceColor::new_from_hs(hue, 0.0).to_device_preferred_mode(&rgb_capabilities()),
                Some(DeviceColor::new_from_rgb(255, 255, 255))
            );
        }
    }

    #[test]
    fn hs_rgb_xy_round_trips_are_sensible() {
        for (hue, saturation) in [
            (0, 0.0),
            (0, 1.0),
            (60, 0.7),
            (120, 1.0),
            (210, 0.7),
            (300, 0.5),
        ] {
            let hs = DeviceColor::new_from_hs(hue, saturation);
            let xy = DeviceColor::Xy(hs.to_xy().unwrap());
            let rgb = DeviceColor::Rgb(xy.to_rgb().unwrap());
            let round_trip = rgb.to_hs().unwrap();
            if saturation == 0.0 {
                assert!(round_trip.s.into_inner() <= 0.01);
            } else {
                let hue_delta =
                    ((round_trip.h as i32 - hue as i32 + 180).rem_euclid(360) - 180).abs();
                assert!(hue_delta <= 2, "hue {hue} became {}", round_trip.h);
                assert!((round_trip.s.into_inner() - saturation).abs() <= 0.03);
            }
        }
    }

    #[test]
    fn uv_distance_is_small_for_rounding_and_large_for_different_colors() {
        let reference = Xy {
            x: OrderedFloat(0.4168),
            y: OrderedFloat(0.3826),
        };
        let rounded = Xy {
            x: OrderedFloat(0.4167849),
            y: OrderedFloat(0.38260472),
        };
        assert!(DeviceColor::uv_distance(&reference, &rounded) < 1e-4);

        let shifted = Xy {
            x: OrderedFloat(0.3469),
            y: OrderedFloat(0.3590),
        };
        assert!(DeviceColor::uv_distance(&reference, &shifted) > 0.03);
    }
}
