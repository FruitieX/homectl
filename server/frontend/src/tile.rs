use dioxus::{events::MouseEvent, prelude::*};

#[derive(Props)]
pub struct TileProps<'a> {
    contents: Element<'a>,

    #[props(optional)]
    full_width: Option<bool>,

    #[props(default)]
    onclick: EventHandler<'a, MouseEvent>,
}

#[allow(non_snake_case)]
pub fn Tile<'a>(cx: Scope<'a, TileProps<'a>>) -> Element<'a> {
    let contents = &cx.props.contents;
    let width = if cx.props.full_width == Some(true) {
        "calc(100% - 1.5rem)"
    } else {
        "calc(50% - 1.5rem)"
    };

    let style = r#"
        -webkit-tap-highlight-color: transparent;
    "#;

    cx.render(rsx! {
        div {
            style: "{style}",
            gap: "0.5rem",
            width: "{width}",
            max_width: "16rem",
            height: "2.5rem",
            display: "flex",
            flex_direction: "row",
            align_items: "center",
            border_radius: "0.5rem",
            border: "1px solid #cccccc",
            padding: "0.5rem",
            box_shadow: "0px 0.25rem 0.5rem 0px rgba(0,0,0,0.1)",
            cursor: "pointer",
            color: "#000",
            text_decoration_line: "none",
            prevent_default: "onclick",
            onclick: move |evt| cx.props.onclick.call(evt),

            contents
        }
    })
}
