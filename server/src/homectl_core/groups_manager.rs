use super::{
    group::{GroupsConfig, GroupId, GroupDeviceLink},
};

pub struct GroupsManager {
    config: GroupsConfig,
}

impl GroupsManager {
    pub fn new(config: GroupsConfig) -> Self {
        GroupsManager { config }
    }

    /// Returns all GroupDeviceLinks that belong to given group
    pub fn find_group_device_links(&self, group_id: &GroupId) -> Vec<GroupDeviceLink> {
        let results: Option<Vec<GroupDeviceLink>> = try {
            let group = self.config.get(group_id)?;
            let mut results = vec![];

            for device_link in group.devices.clone()? {
                results.push(device_link);
            }

            for group_link in group.groups.clone()? {
                let mut device_links = self.find_group_device_links(&group_link.group_id);
                results.append(device_links.as_mut());
            }

            results
        };

        results.unwrap_or(vec![])
    }
}
