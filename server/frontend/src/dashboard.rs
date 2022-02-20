use dioxus::prelude::*;
use dioxus_router::Link;

use crate::{tile::Tile, util::ARROW_STYLES};

#[allow(non_snake_case)]
pub fn Dashboard(cx: Scope) -> Element {
    cx.render(rsx! {
        div {
            class: "flex flex-col gap-2",
            "data-testid": "my-test",

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
