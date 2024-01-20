use ordered_float::OrderedFloat;
use palette::{convert::FromColorUnclamped, FromColor, IntoColor};
use serde::{Deserialize, Serialize};
use serde_this_or_that::as_u64;
use ts_rs::TS;

#[derive(TS, Clone, Debug, Default, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Capabilities {
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

        Capabilities { xy, hs, rgb, ct }
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
    #[ts(type = "f32")]
    pub x: OrderedFloat<f32>,
    #[ts(type = "f32")]
    pub y: OrderedFloat<f32>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Hs {
    #[serde(deserialize_with = "as_u64")]
    pub h: u64,
    #[ts(type = "f32")]
    pub s: OrderedFloat<f32>,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Rgb {
    #[serde(deserialize_with = "as_u64")]
    pub r: u64,
    #[serde(deserialize_with = "as_u64")]
    pub g: u64,
    #[serde(deserialize_with = "as_u64")]
    pub b: u64,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize, Hash, Eq)]
#[ts(export)]
pub struct Ct {
    #[serde(deserialize_with = "as_u64")]
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

impl DeviceColor {
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

    pub fn to_device_preferred_mode(&self, capabilities: &Capabilities) -> Option<DeviceColor> {
        // Don't perform any conversion if device supports current color mode
        if capabilities.is_supported(self) {
            return Some(self.clone());
        }

        // Convert color into supported color mode
        let yxy: palette::Yxy = self.into();
        if capabilities.xy {
            Some(yxy.into())
        } else if capabilities.hs {
            let hsv: palette::Hsv = yxy.into_color();
            Some(hsv.into())
        } else if capabilities.rgb {
            let rgb: palette::rgb::Rgb = yxy.into_color();
            Some(rgb.into())
        } else if let Some(supported_range) = &capabilities.ct {
            // McCamy's approximation
            let x = yxy.x;
            let y = yxy.y;
            let n = (x - 0.3320) / (0.1858 - y);
            let cct = (437.0 * n.powi(3) + 3601.0 * n.powi(2) + 6861.0 * n + 5517.0) as u16;

            let clamped = cct.clamp(supported_range.start, supported_range.end);
            Some(clamped.into())
        } else {
            None
        }
    }
}

impl From<&DeviceColor> for palette::Yxy {
    fn from(color: &DeviceColor) -> Self {
        match color {
            DeviceColor::Xy(xy) => palette::Yxy::from_components((*xy.x, *xy.y, 1.0)),
            DeviceColor::Hs(hs) => {
                let hsv: palette::hsv::Hsv = palette::Hsv::new(hs.h as f32, *hs.s, 1.0);
                palette::Yxy::from_color_unclamped(hsv)
            }
            DeviceColor::Rgb(rgb) => {
                let rgb = palette::rgb::Srgb::new(rgb.r, rgb.g, rgb.b);
                palette::Yxy::from_color(rgb.into_format::<f32>())
            }
            DeviceColor::Ct(ct) => {
                // http://www.brucelindbloom.com/index.html?Eqn_T_to_xy.html
                let t = ct.ct as f32;
                let x = if t <= 7000.0 {
                    -4.607 * 10e9 / t.powi(3)
                        + 2.9678 * 10e6 / t.powi(2)
                        + 0.09911 * 10e3 / t
                        + 0.244063
                } else {
                    -2.0064 * 10e9 / t.powi(3)
                        + 1.9018 * 10e6 / t.powi(2)
                        + 0.24748 * 10e3 / t
                        + 0.23704
                };
                let y = -3.0 * x.powi(2) + 2.87 * x - 0.275;

                palette::Yxy::from_components((x, y, 1.0))
            }
        }
    }
}

impl From<palette::Yxy> for DeviceColor {
    fn from(yxy: palette::Yxy) -> Self {
        DeviceColor::Xy(Xy {
            x: OrderedFloat(yxy.x),
            y: OrderedFloat(yxy.y),
        })
    }
}

impl From<palette::Hsv> for DeviceColor {
    fn from(hsv: palette::Hsv) -> Self {
        DeviceColor::Hs(Hs {
            h: hsv.hue.into_positive_degrees() as u64,
            s: OrderedFloat(hsv.saturation),
        })
    }
}

impl From<palette::rgb::Rgb> for DeviceColor {
    fn from(rgb: palette::rgb::Rgb) -> Self {
        DeviceColor::Rgb(Rgb {
            r: (rgb.red * 255.0) as u64,
            g: (rgb.green * 255.0) as u64,
            b: (rgb.blue * 255.0) as u64,
        })
    }
}

impl From<u16> for DeviceColor {
    fn from(ct: u16) -> Self {
        DeviceColor::Ct(Ct { ct: ct as u64 })
    }
}
