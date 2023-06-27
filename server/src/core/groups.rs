use std::collections::{HashMap, HashSet};

use crate::types::{
    device::{Device, DeviceId, DeviceRef, DevicesState},
    group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupConfig, GroupId, GroupsConfig},
    integration::IntegrationId,
};

use super::devices::find_device;

#[derive(Clone)]
pub struct Groups {
    config: GroupsConfig,
    groups_by_device_id: HashMap<IntegrationId, HashMap<DeviceId, HashSet<GroupId>>>,
    groups_by_device_name: HashMap<IntegrationId, HashMap<String, HashSet<GroupId>>>,
}

/// Evaluates the group config and returns a flattened version of it
///
/// # Arguments
///
/// * `group` - The group config to be evaluated
/// * `groups` - Used for recursing into linked groups
pub fn eval_group_config_device_refs(
    group: &GroupConfig,
    groups: &GroupsConfig,
) -> HashSet<DeviceRef> {
    group
        .devices
        .clone()
        .unwrap_or_default()
        .into_iter()
        .chain(
            group
                .groups
                .clone()
                .unwrap_or_default()
                .into_iter()
                .flat_map(|group_link| {
                    let group = groups.get(&group_link.group_id);
                    group
                        .map(|group| eval_group_config_device_refs(group, groups))
                        .unwrap_or_default()
                }),
        )
        .collect()
}

// Unit tests for eval_group_config_device_links
#[cfg(test)]
mod eval_group_config_device_links_tests {
    use std::str::FromStr;

    use crate::types::group::GroupLink;

    use super::*;

    #[test]
    fn test_eval_group_device_links_with_devices() {
        let device1 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device1").unwrap(),
        );

        let device2 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device2").unwrap(),
        );

        let group_config = GroupConfig {
            name: "Test Group".to_string(),
            devices: Some(vec![device1.clone(), device2.clone()]),
            groups: None,
            hidden: None,
        };

        let result = eval_group_config_device_refs(&group_config, &GroupsConfig::new());

        assert_eq!(result.len(), 2);
        assert!(result.contains(&device1));
        assert!(result.contains(&device2));
    }

    #[test]
    fn test_eval_group_device_links_with_linked_groups() {
        let device1 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device1").unwrap(),
        );

        let device2 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device2").unwrap(),
        );

        let group_config = GroupConfig {
            name: "Test Group".to_string(),
            devices: None,
            groups: Some(vec![GroupLink {
                group_id: GroupId::from_str("test_group_2").unwrap(),
            }]),
            hidden: None,
        };

        let mut groups_config = GroupsConfig::new();
        groups_config.insert(
            GroupId::from_str("test_group_2").unwrap(),
            GroupConfig {
                name: "Test Group 2".to_string(),
                devices: Some(vec![device1.clone(), device2.clone()]),
                groups: None,
                hidden: None,
            },
        );

        let result = eval_group_config_device_refs(&group_config, &groups_config);

        assert_eq!(result.len(), 2);
        assert!(result.contains(&device1));
        assert!(result.contains(&device2));
    }

    #[test]
    fn test_eval_group_config_device_links() {
        let device1 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device1").unwrap(),
        );

        let device2 = DeviceRef::new_with_id(
            IntegrationId::from_str("test_integration").unwrap(),
            DeviceId::from_str("test_device2").unwrap(),
        );

        let group_config = GroupConfig {
            name: "Test Group 1".to_string(),
            devices: Some(vec![device1.clone()]),
            groups: Some(vec![GroupLink {
                group_id: GroupId::from_str("test_group_2").unwrap(),
            }]),
            hidden: None,
        };

        let mut groups_config = GroupsConfig::new();
        groups_config.insert(
            GroupId::from_str("test_group_2").unwrap(),
            GroupConfig {
                name: "Test Group 2".to_string(),
                devices: Some(vec![device2.clone()]),
                groups: None,
                hidden: None,
            },
        );

        let result = eval_group_config_device_refs(&group_config, &groups_config);

        assert_eq!(result.len(), 3);
        assert!(result.contains(&device1));
        assert!(result.contains(&device2));
    }
}

fn mk_flattened_groups(config: &GroupsConfig) -> HashMap<GroupId, HashSet<DeviceRef>> {
    config
        .iter()
        .map(|(group_id, group)| {
            (
                group_id.clone(),
                eval_group_config_device_refs(group, config),
            )
        })
        .collect()
}

fn mk_groups_by_integration(
    flattened_groups: &HashMap<GroupId, HashSet<DeviceRef>>,
) -> HashMap<IntegrationId, HashMap<GroupId, HashSet<DeviceRef>>> {
    flattened_groups
        .iter()
        .fold(Default::default(), |mut acc, (group_id, device_refs)| {
            for device_ref in device_refs {
                let integration_id = device_ref.integration_id().clone();

                let groups = acc.entry(integration_id).or_default();
                let integration_group_device_refs = groups.entry(group_id.clone()).or_default();
                integration_group_device_refs.insert(device_ref.clone());
            }

            acc
        })
}

fn mk_groups_by_device_id(
    groups_by_integration: &HashMap<IntegrationId, HashMap<GroupId, HashSet<DeviceRef>>>,
) -> HashMap<IntegrationId, HashMap<DeviceId, HashSet<GroupId>>> {
    groups_by_integration.iter().fold(
        Default::default(),
        |mut acc, (integration_id, integration_groups)| {
            for (group_id, device_refs) in integration_groups {
                for device_ref in device_refs {
                    if let Some(device_id) = device_ref.device_id() {
                        let integration_id = integration_id.clone();
                        let integration_devices = acc.entry(integration_id).or_default();

                        let device_id = device_id.clone();
                        let integration_device_group_ids =
                            integration_devices.entry(device_id).or_default();
                        integration_device_group_ids.insert(group_id.clone());
                    }
                }
            }

            acc
        },
    )
}

fn mk_groups_by_device_name(
    groups_by_integration: &HashMap<IntegrationId, HashMap<GroupId, HashSet<DeviceRef>>>,
) -> HashMap<IntegrationId, HashMap<String, HashSet<GroupId>>> {
    groups_by_integration.iter().fold(
        Default::default(),
        |mut acc, (integration_id, integration_groups)| {
            for (group_id, device_refs) in integration_groups {
                for device_ref in device_refs {
                    if let Some(name) = device_ref.name() {
                        let integration_id = integration_id.clone();
                        let integration_devices = acc.entry(integration_id).or_default();

                        let name = name.clone();
                        let integration_device_group_ids =
                            integration_devices.entry(name).or_default();
                        integration_device_group_ids.insert(group_id.clone());
                    }
                }
            }

            acc
        },
    )
}

impl Groups {
    pub fn new(config: GroupsConfig) -> Self {
        let flattened = mk_flattened_groups(&config);

        let groups_by_integration = mk_groups_by_integration(&flattened);
        let groups_by_device_id = mk_groups_by_device_id(&groups_by_integration);
        let groups_by_device_name = mk_groups_by_device_name(&groups_by_integration);

        Groups {
            config,
            groups_by_device_id,
            groups_by_device_name,
        }
    }

    /// Returns whether the given device is in the given group.
    /// NOTE: Currently this will only work correctly if the passed DeviceRef is
    /// of the same variant as used in the group's configuration.
    pub fn is_device_in_group(&self, group_id: &GroupId, device_ref: &DeviceRef) -> bool {
        match device_ref {
            DeviceRef::Id(d) => self
                .groups_by_device_id
                .get(&d.integration_id)
                .and_then(|devices| devices.get(&d.device_id))
                .map(|groups| groups.contains(group_id))
                .unwrap_or_default(),

            DeviceRef::Name(d) => self
                .groups_by_device_name
                .get(&d.integration_id)
                .and_then(|devices| devices.get(&d.name))
                .map(|groups| groups.contains(group_id))
                .unwrap_or_default(),
        }
    }

    pub fn get_flattened_groups(&self, devices: &DevicesState) -> FlattenedGroupsConfig {
        FlattenedGroupsConfig(
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
                            hidden: group.hidden,
                        },
                    )
                })
                .collect(),
        )
    }

    /// Returns all GroupDeviceLinks that belong to given group
    pub fn find_group_device_refs(&self, group_id: &GroupId) -> Vec<DeviceRef> {
        let group = self.config.get(group_id);

        let results = group.map(|group| {
            let mut results = vec![];

            for device_link in group.devices.clone().unwrap_or_default() {
                results.push(device_link);
            }

            for group_link in group.groups.clone().unwrap_or_default() {
                let mut device_links = self.find_group_device_refs(&group_link.group_id);
                results.append(device_links.as_mut());
            }

            results
        });

        results.unwrap_or_default()
    }

    pub fn find_group_devices(&self, devices: &DevicesState, group_id: &GroupId) -> Vec<Device> {
        let group_device_refs = self.find_group_device_refs(group_id);
        group_device_refs
            .iter()
            .filter_map(|device_ref| find_device(devices, device_ref))
            .collect()
    }
}
