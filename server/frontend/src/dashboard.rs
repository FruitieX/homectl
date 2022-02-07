use dioxus::prelude::*;
use dioxus_router::Link;

use crate::tile::Tile;

#[allow(non_snake_case)]
pub fn Dashboard(cx: Scope) -> Element {
    cx.render(rsx! {
        div {
            display: "flex",
            flex_direction: "column",
            gap: "1rem",
            margin: "1rem",

            Link {
                to: "/scenes",
                Tile { full_width: true, contents: cx.render(rsx! { "Scenes" }) }
            }
            Link {
                to: "/groups",
                Tile { full_width: true, contents: cx.render(rsx! { "Groups" }) }
            }
            Link {
                to: "/devices",
                Tile { full_width: true, contents: cx.render(rsx! { "Devices" }) }
            }
        }
    })
}
