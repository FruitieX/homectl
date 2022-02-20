use homectl_types::{
    device::{Device, DevicesState},
    group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupDeviceLink, GroupId, GroupsConfig},
};

use super::devices::find_device;

#[derive(Clone)]
pub struct Groups {
    config: GroupsConfig,
}

impl Groups {
    pub fn new(config: GroupsConfig) -> Self {
        Groups { config }
    }

    pub fn get_flattened_groups(&self, devices: &DevicesState) -> FlattenedGroupsConfig {
        self.config
            .iter()
            .map(|(group_id, group)| {
                (
                    group_id.clone(),
                    FlattenedGroupConfig {
                        name: group.name.clone(),
                        device_ids: self
                            .find_group_devices(devices, group_id)
                            .into_iter()
                            .map(|device| device.get_device_key())
                            .collect(),
                    },
                )
            })
            .collect()
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

    pub fn find_group_devices(&self, devices: &DevicesState, group_id: &GroupId) -> Vec<Device> {
        let group_device_links = self.find_group_device_links(group_id);
        group_device_links
            .iter()
            .filter_map(|gdl| {
                find_device(
                    devices,
                    &gdl.integration_id,
                    gdl.device_id.as_ref(),
                    gdl.name.as_ref(),
                )
            })
            .collect()
    }
}
