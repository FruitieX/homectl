use dioxus::{events::MouseEvent, prelude::*};
use fermi::use_set;

use crate::app_state::DISABLE_SCROLL_ATOM;

#[derive(Props)]
pub struct ModalProps<'a> {
    contents: Element<'a>,
    title: &'a str,
    modal_open: &'a bool,
    set_modal_open: &'a UseState<bool>,
}

#[allow(non_snake_case)]
pub fn Modal<'a>(cx: Scope<'a, ModalProps<'a>>) -> Element<'a> {
    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);

    let cancel_bubble = move |evt: MouseEvent| {
        evt.cancel_bubble();
    };

    let close_modal = move |evt: MouseEvent| {
        evt.cancel_bubble();
        (cx.props.set_modal_open)(false);
        set_disable_scroll(false);
    };

    if *cx.props.modal_open {
        set_disable_scroll(true);
    }

    if !cx.props.modal_open {
        None
    } else {
        cx.render(rsx! {
            div {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100vw",
                height: "100vh",
                background_color: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                align_items: "center",
                justify_content: "center",
                onclick: close_modal,

                div {
                    style: "gap: 1rem;",
                    background_color: "white",
                    width: "20rem",
                    max_width: "80vw",
                    height: "35rem",
                    max_height: "80vh",
                    border_radius: "0.5rem",
                    border: "1px solid #cccccc",
                    padding: "1rem",
                    display: "flex",
                    flex_direction: "column",
                    overflow_y: "auto",

                    onclick: cancel_bubble,

                    div {
                        style: "gap: 1rem;",
                        display: "flex",
                        flex_direction: "row",

                        h2 {
                            flex: "1",
                            margin: "0",
                            "{cx.props.title}"
                        }
                        button {
                            border: "none",
                            background_color: "transparent",
                            height: "1.5rem",
                            font_size: "1.5rem",
                            color: "#444444",

                            onclick: close_modal,

                            "X"
                        }
                    }

                    cx.props.contents.as_ref()
                }
            }
        })
    }
}
