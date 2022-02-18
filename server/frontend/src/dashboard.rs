use dioxus::prelude::*;
use dioxus_router::Link;

use crate::{tile::Tile, util::ARROW_STYLES};

#[allow(non_snake_case)]
pub fn Dashboard(cx: Scope) -> Element {
    cx.render(rsx! {
        div {
            "data-testid": "my-test",
            class: "flex flex-col gap-4 m-4",

            Link {
                to: "/scenes",
                Tile { full_width: true, contents: cx.render(rsx! { "Scenes", div { class: "{ARROW_STYLES}", ">" } }) }
            }
            Link {
                to: "/groups",
                Tile { full_width: true, contents: cx.render(rsx! { "Groups", div { class: "{ARROW_STYLES}", ">" } }) }
            }
            Link {
                to: "/devices",
                Tile { full_width: true, contents: cx.render(rsx! { "Devices", div { class: "{ARROW_STYLES}", ">" } }) }
            }
        }
    })
}
