#[allow(unused_imports)]
#[macro_use]
extern crate homectl_console;

use crate::{
    dashboard::Dashboard, device_list::DeviceList, group_device_list::GroupDeviceList,
    group_list::GroupList, scene_list::SceneList, header::Header,
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
mod save_scene_modal;
mod scene_list;
mod tile;
mod util;

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
            Router {
                Header {}
                Route { to: "/", Dashboard {} },
                Route { to: "/devices", DeviceList { filters: None } },
                Route { to: "/groups", GroupList {} },
                Route { to: "/groups/:group_id", GroupDeviceList {} },
                Route { to: "/scenes", SceneList {} }
            }
        }
    ))
}
