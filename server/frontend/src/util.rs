use std::cmp::Ordering;

use homectl_types::{device::DeviceState, utils::cct_to_rgb};
use palette::{Hsl, Hsv};

pub fn hsv_to_css_hsl_str(hsv: &Option<Hsv>) -> String {
    let hsv = hsv.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
    let hsl: Hsl = hsv.into();

    format!(
        "hsl({}, {}%, {}%)",
        hsl.hue.to_positive_degrees().floor(),
        (hsl.saturation * 100.0).floor(),
        (hsl.lightness * 100.0).floor()
    )
}

pub fn scale_hsv_value_to_display(hsv: Hsv) -> Hsv {
    let value = (hsv.value + 1.0) / 2.0;
    Hsv::new(hsv.hue, hsv.saturation, value)
}

pub fn get_device_state_color(state: &DeviceState) -> Option<Hsv> {
    match (state.get_color(), state.get_cct()) {
        (Some(color), _) => Some(color),
        (_, Some(cct)) => {
            let rgb = cct_to_rgb(cct.get_cct());
            let hsv: Hsv = rgb.into();
            Some(hsv)
        }
        (_, _) => None,
    }
}

pub fn cmp_hsv(a: &Hsv, b: &Hsv) -> Ordering {
    let a = hsv_to_css_hsl_str(&Some(*a));
    let b = hsv_to_css_hsl_str(&Some(*b));

    a.cmp(&b)
}
