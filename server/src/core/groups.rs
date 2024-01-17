use std::collections::{BTreeMap, BTreeSet};

use crate::types::{
    device::{Device, DeviceId, DeviceRef, DevicesState},
    group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupConfig, GroupId, GroupsConfig},
    integration::IntegrationId,
};

use super::devices::find_device;

#[derive(Clone, Hash, PartialEq, Eq)]
pub struct Groups {
    config: GroupsConfig,
    device_refs_by_groups: BTreeMap<GroupId, BTreeSet<DeviceRef>>,
    groups_by_device_id: BTreeMap<IntegrationId, BTreeMap<DeviceId, BTreeSet<GroupId>>>,
    groups_by_device_name: BTreeMap<IntegrationId, BTreeMap<String, BTreeSet<GroupId>>>,
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
) -> BTreeSet<DeviceRef> {
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

type DeviceRefsByGroups = BTreeMap<GroupId, BTreeSet<DeviceRef>>;
fn mk_device_refs_by_groups(config: &GroupsConfig) -> DeviceRefsByGroups {
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

type GroupsByIntegration = BTreeMap<IntegrationId, BTreeMap<GroupId, BTreeSet<DeviceRef>>>;
fn mk_groups_by_integration(device_refs_by_groups: &DeviceRefsByGroups) -> GroupsByIntegration {
    device_refs_by_groups
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

type GroupsByDeviceId = BTreeMap<IntegrationId, BTreeMap<DeviceId, BTreeSet<GroupId>>>;
fn mk_groups_by_device_id(groups_by_integration: &GroupsByIntegration) -> GroupsByDeviceId {
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

type GroupsByDeviceName = BTreeMap<IntegrationId, BTreeMap<String, BTreeSet<GroupId>>>;
fn mk_groups_by_device_name(groups_by_integration: &GroupsByIntegration) -> GroupsByDeviceName {
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

fn is_device_in_group(
    group_id: &GroupId,
    device: &Device,
    groups_by_device_id: &GroupsByDeviceId,
    groups_by_device_name: &GroupsByDeviceName,
) -> bool {
    let found_name_match = groups_by_device_name
        .get(&device.integration_id)
        .and_then(|devices| devices.get(&device.name))
        .map(|groups| groups.contains(group_id))
        .unwrap_or_default();

    if found_name_match {
        return true;
    }

    let found_id_match = groups_by_device_id
        .get(&device.integration_id)
        .and_then(|devices| devices.get(&device.id))
        .map(|groups| groups.contains(group_id))
        .unwrap_or_default();

    if found_id_match {
        return true;
    }

    false
}

fn mk_flattened_groups(
    config: &GroupsConfig,
    device_refs_by_groups: &BTreeMap<GroupId, BTreeSet<DeviceRef>>,
    devices: &DevicesState,
) -> FlattenedGroupsConfig {
    let flattened_config = device_refs_by_groups
        .iter()
        .map(|(group_id, device_refs)| {
            let group = config
                .get(group_id)
                .expect("Expected to find group with id from device_refs_by_groups");

            (
                group_id.clone(),
                FlattenedGroupConfig {
                    name: group.name.clone(),
                    device_ids: device_refs
                        .iter()
                        .filter_map(|device_ref| find_device(devices, device_ref))
                        .map(|device| device.get_device_key())
                        .collect(),
                    hidden: group.hidden,
                },
            )
        })
        .collect();

    FlattenedGroupsConfig(flattened_config)
}

pub fn flattened_groups_to_eval_context_values(
    flattened_config: FlattenedGroupsConfig,
    devices: DevicesState,
) -> Vec<(String, serde_json::Value)> {
    flattened_config
        .0
        .iter()
        .flat_map(|(group_id, group)| {
            let group_devices: Vec<&Device> = group
                .device_ids
                .iter()
                .filter_map(|device_key| devices.0.get(device_key))
                .collect();

            let all_devices_powered_on = group_devices
                .iter()
                .all(|device| device.is_powered_on() == Some(true));

            let first_group_device = group_devices.first();

            // group_scene_id is set only if all devices have the same scene activated
            let group_scene_id = {
                let first_device_scene_id = first_group_device.and_then(|d| d.get_scene());
                if group_devices
                    .iter()
                    .all(|device| device.get_scene() == first_device_scene_id)
                {
                    first_device_scene_id
                } else {
                    None
                }
            };

            let prefix = format!("groups.{}", group_id);

            vec![
                (
                    format!("{}.name", prefix),
                    serde_json::Value::String(group.name.clone()),
                ),
                (
                    format!("{}.power", prefix),
                    serde_json::Value::Bool(all_devices_powered_on),
                ),
                (
                    format!("{}.scene_id", prefix),
                    group_scene_id
                        .map(|id| serde_json::Value::String(id.to_string()))
                        .unwrap_or_else(|| serde_json::Value::Null),
                ),
            ]
        })
        .collect()
}

impl Groups {
    pub fn new(config: GroupsConfig) -> Self {
        let device_refs_by_groups = mk_device_refs_by_groups(&config);

        let groups_by_integration = mk_groups_by_integration(&device_refs_by_groups);
        let groups_by_device_id = mk_groups_by_device_id(&groups_by_integration);
        let groups_by_device_name = mk_groups_by_device_name(&groups_by_integration);

        Groups {
            config,
            device_refs_by_groups,
            groups_by_device_id,
            groups_by_device_name,
        }
    }

    /// Returns whether a device is in the given group.
    pub fn is_device_in_group(&self, group_id: &GroupId, device: &Device) -> bool {
        is_device_in_group(
            group_id,
            device,
            &self.groups_by_device_id,
            &self.groups_by_device_name,
        )
    }

    /// Returns a flattened version of the groups config, with any contained
    /// groups expanded.
    pub fn get_flattened_groups(&self, devices: &DevicesState) -> FlattenedGroupsConfig {
        mk_flattened_groups(&self.config, &self.device_refs_by_groups, devices)
    }

    /// Returns all DeviceRefs that belong to given group
    pub fn find_group_device_refs(&self, group_id: &GroupId) -> BTreeSet<DeviceRef> {
        self.device_refs_by_groups
            .get(group_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Returns all Devices that belong to given group
    pub fn find_group_devices(&self, devices: &DevicesState, group_id: &GroupId) -> Vec<Device> {
        let group_device_refs = self.find_group_device_refs(group_id);
        group_device_refs
            .iter()
            .filter_map(|device_ref| find_device(devices, device_ref))
            .collect()
    }
}

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

        assert_eq!(result.len(), 2);
        assert!(result.contains(&device1));
        assert!(result.contains(&device2));
    }
}
