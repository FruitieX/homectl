use dioxus::prelude::*;
use dioxus_router::use_route;
use fermi::use_read;
use homectl_types::group::GroupId;

use crate::{app_state::GROUPS_ATOM, device_list::DeviceList, scene_list::SceneList};

#[allow(non_snake_case)]
pub fn GroupDeviceList(cx: Scope) -> Element {
    let group_id: GroupId = GroupId::new(use_route(&cx).segment("group_id")?.to_string());
    let groups = use_read(&cx, GROUPS_ATOM);

    let (_, group) = groups.0
        .iter()
        .find(|(candidate_group_id, _)| *candidate_group_id == &group_id)?;

    let name = &group.name;

    cx.render(rsx! {
        DeviceList { filters: Some(group.device_ids.clone()) }

        h2 { class: "mt-4", "{name} scenes:" }
        SceneList { filter_by_device_ids: group.device_ids.clone() }
    })
}
