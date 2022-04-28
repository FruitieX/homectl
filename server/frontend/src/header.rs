use dioxus::prelude::*;
use dioxus_router::{use_route, Link};
use fermi::use_read;
use homectl_types::group::GroupId;
use itertools::Itertools;

use crate::{app_state::GROUPS_ATOM, util::tw};

#[derive(PartialEq, Props)]
pub struct HeaderProps {}

#[allow(non_snake_case)]
pub fn Header(cx: Scope<HeaderProps>) -> Element {
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

    let cursor = if disable_back_button {
        tw("cursor-default")
    } else {
        tw("cursor-pointer")
    };

    let back_button_opacity = if disable_back_button {
        tw("opacity-0")
    } else {
        tw("opacity-100")
    };

    let back_href = if segments.is_empty() {
        String::from("/")
    } else {
        String::from("/") + &segments[0..segments.len() - 1].join("/")
    };

    cx.render(rsx! {
        div {
            class: "sticky top-0 h-14 bg-stone-100 shadow-md flex flex-row items-center gap-4 px-2",

            (!disable_back_button).then(|| rsx! {
                Link {
                    to: "{back_href}",
                    span {
                        class: "w-12 h-12 flex justify-center items-center text-2xl leading-4 {cursor} {back_button_opacity} hover:text-slate-500",

                        "<"
                    }
                }
            })

            h2 { "{title}" }
        }
    })
}
