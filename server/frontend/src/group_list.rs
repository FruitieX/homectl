use dioxus::prelude::*;
use dioxus_router::Link;
use fermi::use_read;
use homectl_types::group::{FlattenedGroupConfig, GroupId};

use crate::app_state::GROUPS_ATOM;

#[derive(Props, PartialEq)]
struct GroupRowProps {
    group_id: GroupId,
    group: FlattenedGroupConfig,
}

#[allow(non_snake_case)]
fn GroupRow(cx: Scope<GroupRowProps>) -> Element {
    let group_id = &cx.props.group_id;
    let name = &cx.props.group.name;

    cx.render(rsx! {
        div {
            Link {
                to: "/groups/{group_id}",
                button { "{name}" }
            }
        }
    })
}

#[allow(non_snake_case)]
pub fn GroupList(cx: Scope) -> Element {
    let groups = use_read(&cx, GROUPS_ATOM);

    let mut groups: Vec<(GroupId, FlattenedGroupConfig)> = groups
        .iter()
        .map(|(group_id, config)| (group_id.clone(), config.clone()))
        .collect();

    groups.sort_by(|a, b| a.1.name.cmp(&b.1.name));

    let groups = groups.iter().map(|(key, group)| {
        rsx! {
            GroupRow {
                key: "{key}",
                group_id: key.clone(),
                group: group.clone()
            }
        }
    });

    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Groups:" }
        groups
    })
}
