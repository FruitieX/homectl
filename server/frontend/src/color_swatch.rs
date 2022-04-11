use dioxus::prelude::*;
use palette::Hsv;

use crate::util::hsv_to_css_hsl_str;

#[derive(Props, PartialEq)]
pub struct ColorSwatchProps {
    #[props(!optional)]
    color: Option<Hsv>,
}

#[allow(non_snake_case)]
pub fn ColorSwatch(cx: Scope<ColorSwatchProps>) -> Element {
    let background_color = hsv_to_css_hsl_str(&cx.props.color);

    cx.render(rsx! {
        span {
            class: "h-8 w-8 rounded-full border border-slate-300 flex-shrink-0",
            background_color: "{background_color}",
        }
    })
}
