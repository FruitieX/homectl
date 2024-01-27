use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, RwLock},
};

use crate::{
    types::{
        device::{Device, DeviceRef, DevicesState},
        group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupConfig, GroupId, GroupsConfig},
    },
    utils::keys_match,
};

use super::devices::find_device;

#[derive(Clone, Default)]
pub struct Groups {
    config: GroupsConfig,
    device_refs_by_groups: BTreeMap<GroupId, BTreeSet<DeviceRef>>,
    flattened_groups: Arc<RwLock<FlattenedGroupsConfig>>,
}

/// Evaluates the group config and returns a flattened version of it
///
/// # Arguments
///
/// * `group` - The group config to be evaluated
/// * `groups` - Used for recursing into linked groups
fn eval_group_config_device_refs(
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
    flattened_config: &FlattenedGroupsConfig,
    devices: &DevicesState,
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

        Groups {
            config,
            device_refs_by_groups,
            flattened_groups: Default::default(),
        }
    }

    /// Returns a flattened version of the groups config, with any contained
    /// groups expanded.
    pub fn get_flattened_groups(&self) -> FlattenedGroupsConfig {
        self.flattened_groups.read().unwrap().clone()
    }

    /// Returns all Devices that belong to given group
    pub fn find_group_devices<'a>(
        &self,
        devices: &'a DevicesState,
        group_id: &GroupId,
    ) -> Vec<&'a Device> {
        let flattened_groups = self.get_flattened_groups();
        let group = flattened_groups.0.get(group_id);
        let Some(group) = group else { return vec![] };

        let group_device_keys = &group.device_ids;
        group_device_keys
            .iter()
            .filter_map(|device_id| devices.0.get(device_id))
            .collect()
    }

    pub fn invalidate(&self, old_state: &DevicesState, new_state: &DevicesState) -> bool {
        // Only invalidate groups if device ids have changed
        if !keys_match(&old_state.0, &new_state.0) {
            let flattened_groups =
                mk_flattened_groups(&self.config, &self.device_refs_by_groups, new_state);
            let mut rw_lock = self.flattened_groups.write().unwrap();
            *rw_lock = flattened_groups;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod eval_group_config_device_links_tests {
    use std::str::FromStr;

    use crate::types::{device::DeviceId, group::GroupLink, integration::IntegrationId};

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
