use super::group::{GroupDeviceLink, GroupId, GroupsConfig};

#[derive(Clone)]
pub struct Groups {
    config: GroupsConfig,
}

impl Groups {
    pub fn new(config: GroupsConfig) -> Self {
        Groups { config }
    }

    /// Returns all GroupDeviceLinks that belong to given group
    pub fn find_group_device_links(&self, group_id: &GroupId) -> Vec<GroupDeviceLink> {
        let group = self.config.get(group_id);

        let results = group.map(|group| {
            let mut results = vec![];

            for device_link in group.devices.clone().unwrap_or_default() {
                results.push(device_link);
            }

            for group_link in group.groups.clone().unwrap_or_default() {
                let mut device_links = self.find_group_device_links(&group_link.group_id);
                results.append(device_links.as_mut());
            }

            results
        });

        results.unwrap_or_default()
    }
}
