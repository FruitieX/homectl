use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(TS, Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct SupportedColorModes {
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

pub enum ColorMode {
    Xy,
    Hs,
    Rgb,
    Ct(std::ops::Range<u16>),
}

impl SupportedColorModes {
    pub fn singleton(mode: ColorMode) -> SupportedColorModes {
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

        SupportedColorModes { xy, hs, rgb, ct }
    }
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Xy {
    pub x: f32,
    pub y: f32,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Hs {
    pub h: u16,
    pub s: f32,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
#[ts(export)]
pub struct Ct {
    pub ct: u16,
}

#[derive(TS, Clone, Debug, PartialEq, Deserialize, Serialize)]
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
        DeviceColor::Xy(Xy { x, y })
    }

    pub fn new_from_hs(h: u16, s: f32) -> DeviceColor {
        DeviceColor::Hs(Hs { h, s })
    }

    pub fn new_from_rgb(r: u8, g: u8, b: u8) -> DeviceColor {
        DeviceColor::Rgb(Rgb { r, g, b })
    }

    pub fn new_from_ct(ct: u16) -> DeviceColor {
        DeviceColor::Ct(Ct { ct })
    }
}

impl From<palette::Xyz> for DeviceColor {
    fn from(xyz: palette::Xyz) -> Self {
        DeviceColor::Xy(Xy { x: xyz.x, y: xyz.y })
    }
}

impl From<palette::Hsv> for DeviceColor {
    fn from(hsv: palette::Hsv) -> Self {
        DeviceColor::Hs(Hs {
            h: hsv.hue.into_positive_degrees() as u16,
            s: hsv.saturation,
        })
    }
}

impl From<palette::rgb::Rgb> for DeviceColor {
    fn from(rgb: palette::rgb::Rgb) -> Self {
        DeviceColor::Rgb(Rgb {
            r: (rgb.red * 255.0) as u8,
            g: (rgb.green * 255.0) as u8,
            b: (rgb.blue * 255.0) as u8,
        })
    }
}
