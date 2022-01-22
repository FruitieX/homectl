#[allow(unused_imports)]
#[macro_use]
extern crate homectl_console;

use crate::{device_list::DeviceList, scene_list::SceneList};
use app_state::use_app_state;
use dioxus::prelude::*;

mod app_state;
mod device_list;
mod scene_list;

fn main() {
    dioxus::web::launch(app);
}

fn app(cx: Scope) -> Element {
    use_app_state(&cx);

    cx.render(rsx! (
        DeviceList {}
        SceneList {}
    ))
}
