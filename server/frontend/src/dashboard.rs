use dioxus::prelude::*;
use dioxus_router::Link;

#[allow(non_snake_case)]
pub fn Dashboard(cx: Scope) -> Element {
    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Dashboard" }

        div {
            display: "flex",
            flex_direction: "column",
            gap: "1rem",

            Link {
                to: "/scenes",
                button { "Scenes" }
            }
            Link {
                to: "/groups",
                button { "Groups" }
            }
            Link {
                to: "/devices",
                button { "Devices" }
            }
        }
    })
}
