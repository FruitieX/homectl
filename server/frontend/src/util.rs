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
