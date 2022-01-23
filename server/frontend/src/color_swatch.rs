use dioxus::prelude::*;
use palette::Hsv;

use crate::util::hsv_to_css_hsl_str;

#[derive(Props, PartialEq)]
pub struct ColorSwatchProps {
    color: Option<Hsv>,
}

#[allow(non_snake_case)]
pub fn ColorSwatch(cx: Scope<ColorSwatchProps>) -> Element {
    let background_color = hsv_to_css_hsl_str(&cx.props.color);

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
