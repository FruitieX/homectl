use dioxus::{events::MouseEvent, prelude::*};
use itertools::Itertools;
use palette::Hsv;

use crate::util::hsv_to_css_hsl_str;

#[derive(Props)]
pub struct TileProps<'a> {
    contents: Element<'a>,

    #[props(optional)]
    full_width: Option<bool>,

    #[props(optional)]
    gradient: Option<Vec<Hsv>>,

    #[props(default)]
    onclick: EventHandler<'a, MouseEvent>,
}

#[allow(non_snake_case)]
pub fn Tile<'a>(cx: Scope<'a, TileProps<'a>>) -> Element<'a> {
    let contents = &cx.props.contents;
    let width = if cx.props.full_width == Some(true) {
        "calc(100% - .5rem)"
    } else {
        "calc(50% - .25rem)"
    };

    let background_hsl = cx
        .props
        .gradient
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|hsv| hsv_to_css_hsl_str(&Some(*hsv)))
        .collect_vec();

    // If there's only one item, duplicate it to create a valid gradient
    let background_hsl = if background_hsl.len() == 1 {
        vec![background_hsl[0].clone(), background_hsl[0].clone()]
    } else {
        background_hsl
    };

    let background = if background_hsl.is_empty() {
        String::from("#fff")
    } else {
        format!("linear-gradient(90deg, {})", background_hsl.join(", "))
    };

    let style = r#"
        -webkit-tap-highlight-color: transparent;
    "#;

    cx.render(rsx! {
        div {
            class: "gap-2 max-w-[16rem] h-10 flex flex-row items-center rounded-lg border border-slate-300 p-2 shadow-sm cursor-pointer text-black hover:shadow-md",
            style: "{style}",
            width: "{width}",
            text_decoration_line: "none",
            background: "{background}",
            prevent_default: "onclick",
            onclick: move |evt| cx.props.onclick.call(evt),

            contents
        }
    })
}
