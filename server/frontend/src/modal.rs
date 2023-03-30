use dioxus::{events::MouseEvent, prelude::*};
use fermi::use_set;

use crate::app_state::DISABLE_SCROLL_ATOM;

#[derive(Props)]
pub struct ModalProps<'a> {
    contents: Element<'a>,
    title: &'a str,
    modal_open: &'a UseState<bool>,
}

#[allow(non_snake_case)]
pub fn Modal<'a>(cx: Scope<'a, ModalProps<'a>>) -> Element<'a> {
    let set_disable_scroll = use_set(&cx, DISABLE_SCROLL_ATOM);

    let stop_propagation = move |evt: MouseEvent| {
        evt.stop_propagation();
    };

    let close_modal = move |evt: MouseEvent| {
        evt.stop_propagation();
        cx.props.modal_open.set(false);
        set_disable_scroll(false);
    };

    if **cx.props.modal_open {
        set_disable_scroll(true);
    }

    if !cx.props.modal_open {
        None
    } else {
        cx.render(rsx! {
            div {
                class: "cursor-default fixed top-0 left-0 w-screen h-screen bg-black bg-opacity-50 flex items-center justify-center",
                onclick: close_modal,

                div {
                    class: "gap-4 bg-white w-80 max-w-[80vw] h-[35rem] max-h-[80vh] rounded-lg border border-slate-300 p-4 flex flex-col overflow-y-auto relative",
                    onclick: stop_propagation,

                    div {
                        class: "gap-4 flex flex-row",

                        h2 {
                            class: "flex-1 m-0",

                            "{cx.props.title}"
                        }
                        button {
                            class: "h-6 text-2xl text-slate-700 cursor-pointer",
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
