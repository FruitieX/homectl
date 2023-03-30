#[allow(unused_imports)]
#[macro_use]
extern crate homectl_console;

use crate::{
    dashboard::Dashboard, device_list::DeviceList, group_device_list::GroupDeviceList,
    group_list::GroupList, header::Header, redirect::Redirect, scene_list::SceneList,
};
use app_state::{use_init_app_state, DISABLE_SCROLL_ATOM};
use dioxus::prelude::*;
use dioxus_router::{Route, Router};
use fermi::use_read;

mod app_state;
mod color_swatch;
mod dashboard;
mod device_list;
mod device_modal;
mod edit_scene_modal;
mod group_device_list;
mod group_list;
mod header;
mod modal;
mod redirect;
mod save_scene_modal;
mod scene_list;
mod tile;
mod util;

fn main() {
    dioxus_web::launch(app);
}

fn app(cx: Scope) -> Element {
    cx.render(rsx!(main { "asd" }))
    // use_init_app_state(&cx);

    // let disable_scroll = use_read(&cx, DISABLE_SCROLL_ATOM);
    // let disable_scroll_css = if *disable_scroll { "hidden" } else { "visible" };

    // cx.render(rsx! (
    //     style {
    //         r"* {{
    //             font-family: sans-serif;
    //             user-select: none;
    //         }}

    //         body {{
    //             margin: 0;
    //             height: 100vh;
    //             width: 100%;
    //             overflow-y: {disable_scroll_css};
    //             overflow-x: hidden;
    //         }}"
    //     }
    //     Router {
    //         Header {}
    //         main {
    //             class: "m-2 pb-8 pt-0.5",

    //             Route { to: "/", Dashboard {} },
    //             Route { to: "/index.html", Redirect { to: "/" } },
    //             Route { to: "/devices", DeviceList { filters: None } },
    //             Route { to: "/groups", GroupList {} },
    //             Route { to: "/groups/:group_id", GroupDeviceList {} },
    //             Route { to: "/scenes", SceneList {} }
    //         }
    //     }
    // ))
}
