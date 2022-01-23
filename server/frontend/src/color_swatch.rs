use dioxus::prelude::*;
use palette::{Hsl, Hsv};

#[derive(Props, PartialEq)]
pub struct ColorSwatchProps {
    color: Option<Hsv>,
}

#[allow(non_snake_case)]
pub fn ColorSwatch(cx: Scope<ColorSwatchProps>) -> Element {
    let hsv = cx.props.color.unwrap_or_else(|| Hsv::new(0.0, 0.0, 1.0));
    let hsl: Hsl = hsv.into();
    let background_color = format!(
        "hsl({}, {}%, {}%)",
        hsl.hue.to_positive_degrees(),
        (hsl.saturation * 100.0).floor(),
        (hsl.lightness * 100.0).floor()
    );

    let size = 2.0;
    let border_radius = size / 2.0;

    cx.render(rsx! {
        span {
            width: "{size}rem",
            height: "{size}rem",
            border_radius: "{border_radius}rem",
            background_color: "{background_color}",
            border: "1px solid #cccccc",
            flex_shrink: "0",
        }
    })
}
