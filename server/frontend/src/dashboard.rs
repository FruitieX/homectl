use dioxus::prelude::*;
use dioxus_router::Link;

use crate::tile::Tile;

#[allow(non_snake_case)]
pub fn Dashboard(cx: Scope) -> Element {
    let arrow_styles = r#"
        text-align: right;
        margin-right: 0.5rem;
        line-height: 1;
        font-size: 2rem;
        flex: 1;
    "#;

    cx.render(rsx! {
        div {
            "data-testid": "my-test",
            display: "flex",
            flex_direction: "column",
            gap: "1rem",
            margin: "1rem",

            Link {
                to: "/scenes",
                Tile { full_width: true, contents: cx.render(rsx! { "Scenes", div { style: "{arrow_styles}", ">" } }) }
            }
            Link {
                to: "/groups",
                Tile { full_width: true, contents: cx.render(rsx! { "Groups", div { style: "{arrow_styles}", ">" } }) }
            }
            Link {
                to: "/devices",
                Tile { full_width: true, contents: cx.render(rsx! { "Devices", div { style: "{arrow_styles}", ">" } }) }
            }
        }
    })
}
