use dioxus::prelude::*;
use dioxus_router::use_route;
use fermi::use_read;
use homectl_types::group::{FlattenedGroupConfig, GroupId};

use crate::{app_state::GROUPS_ATOM, device_list::DeviceList};

#[derive(Props, PartialEq)]
struct GroupRowProps {
    group_id: GroupId,
    group: FlattenedGroupConfig,
}

#[allow(non_snake_case)]
pub fn GroupDeviceList(cx: Scope) -> Element {
    let group_id: GroupId = use_route(&cx).segment("group_id")?.ok()?;
    let groups = use_read(&cx, GROUPS_ATOM);

    let (_, group) = groups
        .iter()
        .find(|(candidate_group_id, _)| *candidate_group_id == &group_id)?;

    cx.render(rsx! {
        h2 { margin_bottom: "1rem", "Group: {group.name}" }
        DeviceList { filters: Some(group.device_ids.clone()) }
    })
}
