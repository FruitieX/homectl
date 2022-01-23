#[allow(unused_imports)]
#[macro_use]
extern crate homectl_console;

use crate::{device_list::DeviceList, scene_list::SceneList};
use app_state::{use_init_app_state, DISABLE_SCROLL_ATOM};
use dioxus::prelude::*;
use fermi::use_read;

mod app_state;
mod color_swatch;
mod device_list;
mod device_modal;
mod scene_list;

fn main() {
    dioxus::web::launch(app);
}

fn app(cx: Scope) -> Element {
    use_init_app_state(&cx);

    let disable_scroll = use_read(&cx, DISABLE_SCROLL_ATOM);
    let disable_scroll_css = if *disable_scroll { "hidden" } else { "visible" };

    cx.render(rsx! (
        style {
            r"* {{
                font-family: sans-serif;
                user-select: none;
            }}
            
            body {{
                margin: 0;
                height: 100vh;
                width: 100%;
                overflow: {disable_scroll_css};
            }}"
        }
        main {
            DeviceList {}
            SceneList {}
        }
    ))
}
