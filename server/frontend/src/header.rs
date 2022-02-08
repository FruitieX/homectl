use dioxus::prelude::*;
use dioxus_router::use_route;
use fermi::use_read;
use homectl_types::group::GroupId;
use itertools::Itertools;

use crate::app_state::GROUPS_ATOM;

#[derive(PartialEq, Props)]
pub struct HeaderProps {}

#[allow(non_snake_case)]
pub fn Header(cx: Scope<HeaderProps>) -> Element {
    let window = web_sys::window().unwrap();
    let history = window.history().unwrap();

    let groups = use_read(&cx, GROUPS_ATOM);

    let route = use_route(&cx);
    let mut segments = vec![];

    let mut n = 0;
    while let Some(segment) = route.nth_segment(n) {
        if !segment.is_empty() {
            segments.push(segment);
        }
        n += 1;
    }

    // Vec<String> -> &[&str]
    let segments = segments.iter().map(|s| &**s).collect_vec();
    let segments = segments.as_slice();

    let title = match segments {
        [] => "homectl dashboard".to_string(),
        ["scenes"] => "Scenes".to_string(),
        ["groups"] => "Groups".to_string(),
        ["groups", group_id] => {
            let group = groups.get(&GroupId::new(group_id.to_string()));

            match group {
                Some(group) => format!("{} devices", group.name),
                None => "Unknown group devices".to_string(),
            }
        }
        ["devices"] => "Devices".to_string(),
        _ => "Unknown".to_string(),
    };

    let disable_back_button = segments.is_empty();
    let cursor = if disable_back_button { "default" } else { "pointer" };
    let back_button_opacity = if disable_back_button { 0.0 } else { 1.0 };

    cx.render(rsx! {
        div {
            position: "sticky",
            top: "0",
            height: "4rem",
            background_color: "rgb(240, 240, 240)",
            box_shadow: "0px 0px 6px 3px rgba(0, 0, 0, 0.2)",
            display: "flex",
            flex_direction: "row",
            align_items: "center",
            gap: "1rem",
            padding_left: "0.5rem",
            padding_right: "0.5rem",

            button {
                width: "2rem",
                height: "2rem",
                font_size: "1.5rem",
                line_height: "1",
                border: "none",
                background: "none",
                disabled: "{disable_back_button}",
                cursor: "{cursor}",
                opacity: "{back_button_opacity}",
                onclick: move |_| { history.back().unwrap() },

                "<"
            }
            h2 { "{title}" }
        }
    })
}
