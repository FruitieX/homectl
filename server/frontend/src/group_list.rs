use dioxus::prelude::*;
use dioxus_router::Link;
use fermi::use_read;
use homectl_types::group::{FlattenedGroupConfig, GroupId};
use itertools::Itertools;

use crate::{app_state::GROUPS_ATOM, tile::Tile};

#[derive(Props, PartialEq)]
struct GroupRowProps {
    group_id: GroupId,
    name: String,
}

#[allow(non_snake_case)]
fn GroupRow(cx: Scope<GroupRowProps>) -> Element {
    let group_id = &cx.props.group_id;
    let name = &cx.props.name;

    cx.render(rsx! {
        div {
            Link {
                to: "/groups/{group_id}",
                Tile { full_width: true, contents: cx.render(rsx! { "{name}" }) }
            }
        }
    })
}

#[allow(non_snake_case)]
pub fn GroupList(cx: Scope) -> Element {
    let groups = use_read(&cx, GROUPS_ATOM);

    let groups: Vec<(GroupId, FlattenedGroupConfig)> = groups
        .iter()
        .map(|(group_id, config)| (group_id.clone(), config.clone()))
        .sorted_by(|a, b| a.1.name.cmp(&b.1.name))
        .collect();

    let groups = groups.iter().map(|(key, group)| {
        rsx! {
            GroupRow {
                key: "{key}",
                group_id: key.clone(),
                name: group.name.clone()
            }
        }
    });

    cx.render(rsx! {
        div {
            display: "flex",
            flex_direction: "column",
            margin: "1rem",
            gap: "1rem",
            groups
        }
    })
}
