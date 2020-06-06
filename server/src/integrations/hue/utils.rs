use super::bridge::BridgeLight;

use palette::{Hsl, IntoColor, Lch};

pub fn hue_to_palette(bridge_light: BridgeLight) -> Option<Lch> {
    let hue: f32 = bridge_light.state.hue? as f32;
    let saturation: f32 = bridge_light.state.sat? as f32;
    let lightness: f32 = bridge_light.state.bri? as f32;

    let hsl = Hsl::new(
        (hue / 65536.0) * 360.0,
        saturation / 254.0,
        lightness / 254.0,
    );
    let lch: Lch = hsl.into_lch();

    Some(lch)
}
