use std::collections::{BTreeMap, BTreeSet};

use color_eyre::Result;

use crate::{
    db::config_queries,
    types::{
        device::{Device, DeviceKey, DeviceRef, DevicesState},
        group::{
            FlattenedGroupConfig, FlattenedGroupsConfig, GroupConfig, GroupId, GroupLink,
            GroupsConfig,
        },
        integration::IntegrationId,
        scene::SceneId,
    },
    utils::keys_match,
};

use super::devices::Devices;

#[derive(Clone, Default)]
pub struct Groups {
    config: GroupsConfig,
    device_refs_by_groups: BTreeMap<GroupId, BTreeSet<DeviceRef>>,
    flattened_groups: FlattenedGroupsConfig,
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
    devices: &Devices,
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
                    device_keys: device_refs
                        .iter()
                        .filter_map(|device_ref| devices.get_device_by_ref(device_ref))
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
                .device_keys
                .iter()
                .filter_map(|device_key| devices.0.get(device_key))
                .collect();

            let all_devices_powered_on = group_devices
                .iter()
                .all(|device| device.is_powered_on() == Some(true));

            let first_group_device = group_devices.first();

            // group_scene_id is set only if all devices have the same scene activated
            let group_scene_id = {
                let first_device_scene_id = first_group_device.and_then(|d| d.get_scene_id());
                if group_devices
                    .iter()
                    .all(|device| device.get_scene_id() == first_device_scene_id)
                {
                    first_device_scene_id
                } else {
                    None
                }
            };

            let prefix = format!("groups.{group_id}");

            vec![
                (
                    format!("{prefix}.name"),
                    serde_json::Value::String(group.name.clone()),
                ),
                (
                    format!("{prefix}.power"),
                    serde_json::Value::Bool(all_devices_powered_on),
                ),
                (
                    format!("{prefix}.scene_id"),
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

    pub fn load_config_rows(&mut self, groups: &[config_queries::GroupRow]) {
        let mut new_config = GroupsConfig::new();
        for group in groups {
            let device_refs = group
                .devices
                .iter()
                .map(|device| {
                    DeviceRef::new_with_id(
                        IntegrationId::from(device.integration_id.clone()),
                        device.device_id.clone().into(),
                    )
                })
                .collect::<Vec<_>>();

            let devices: Option<Vec<DeviceRef>> = if device_refs.is_empty() {
                None
            } else {
                Some(device_refs)
            };

            let linked_groups: Option<Vec<GroupLink>> = if group.linked_groups.is_empty() {
                None
            } else {
                Some(
                    group
                        .linked_groups
                        .iter()
                        .cloned()
                        .map(|group_id| GroupLink {
                            group_id: GroupId(group_id),
                        })
                        .collect(),
                )
            };

            new_config.insert(
                GroupId(group.id.clone()),
                GroupConfig {
                    name: group.name.clone(),
                    devices,
                    groups: linked_groups,
                    hidden: Some(group.hidden),
                },
            );
        }

        self.config = new_config;
        self.device_refs_by_groups = mk_device_refs_by_groups(&self.config);
    }

    /// Hot-reload groups configuration from the database
    pub async fn reload_from_db(&mut self) -> Result<()> {
        let db_groups = config_queries::db_get_groups().await?;

        self.load_config_rows(&db_groups);

        Ok(())
    }

    /// Returns a flattened version of the groups config, with any contained
    /// groups expanded.
    pub fn get_flattened_groups(&self) -> &FlattenedGroupsConfig {
        &self.flattened_groups
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

        let group_device_keys = &group.device_keys;
        group_device_keys
            .iter()
            .filter_map(|device_key| devices.0.get(device_key))
            .collect()
    }

    /// Returns the unanimous currently-active scene of the given group, if
    /// all online devices in the group share the same scene. Offline devices
    /// and devices without a scene disqualify the group from reporting a
    /// unanimous scene, mirroring the semantics used by group rules and the
    /// scene-cycle detection logic.
    pub fn get_group_scene_id(
        &self,
        devices: &DevicesState,
        group_id: &GroupId,
    ) -> Option<SceneId> {
        let group_devices = self.find_group_devices(devices, group_id);
        let first = group_devices.first()?;
        let first_scene = first.get_scene_id()?;

        if group_devices
            .iter()
            .all(|device| device.get_scene_id().as_ref() == Some(&first_scene))
        {
            Some(first_scene)
        } else {
            None
        }
    }

    /// Returns every group id that contains the given device.
    pub fn groups_containing_device(&self, device_key: &DeviceKey) -> Vec<GroupId> {
        self.flattened_groups
            .0
            .iter()
            .filter_map(|(group_id, group)| {
                if group.device_keys.contains(device_key) {
                    Some(group_id.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn invalidate(
        &mut self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        devices: &Devices,
    ) -> bool {
        // Only invalidate groups if device ids have changed
        if !keys_match(&old_state.0, &new_state.0) {
            self.flattened_groups =
                mk_flattened_groups(&self.config, &self.device_refs_by_groups, devices);
            true
        } else {
            false
        }
    }

    pub fn force_invalidate(&mut self, devices: &Devices) {
        self.flattened_groups =
            mk_flattened_groups(&self.config, &self.device_refs_by_groups, devices);
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

#[cfg(test)]
mod groups_runtime_tests {
    use std::str::FromStr;

    use ordered_float::OrderedFloat;

    use crate::types::color::{Capabilities, DeviceColor, Hs};
    use crate::types::device::{
        ControllableDevice, ControllableState, Device, DeviceData, DeviceId, ManageKind,
    };
    use crate::types::event::mk_event_channel;
    use crate::types::integration::IntegrationId;
    use crate::types::scene::SceneId;
    use crate::utils::cli::Cli;

    use super::*;

    fn make_controllable(
        integration_id: &str,
        device_id: &str,
        name: &str,
        scene_id: Option<&str>,
    ) -> Device {
        Device::new(
            IntegrationId::from(integration_id.to_string()),
            DeviceId::new(device_id),
            name.to_string(),
            DeviceData::Controllable(ControllableDevice {
                scene_id: scene_id.map(|s| SceneId::from_str(s).unwrap()),
                state_source: None,
                capabilities: Capabilities {
                    xy: false,
                    hs: true,
                    rgb: false,
                    ct: None,
                },
                state: ControllableState {
                    power: true,
                    brightness: Some(OrderedFloat(1.0)),
                    color: Some(DeviceColor::Hs(Hs {
                        h: 0,
                        s: OrderedFloat(0.0),
                    })),
                    transition: None,
                },
                managed: ManageKind::Full,
            }),
            None,
        )
    }

    fn populated_groups(devices_vec: Vec<Device>, config: GroupsConfig) -> (Devices, Groups) {
        let (tx, _rx) = mk_event_channel();
        let cli = Cli {
            dry_run: true,
            port: 45289,
            database_url: None,
            config: None,
            warmup_time: None,
            command: None,
        };
        let mut devices = Devices::new(tx, &cli);
        for device in devices_vec {
            devices.set_state(&device, true, true);
        }
        let mut groups = Groups::new(config);
        groups.force_invalidate(&devices);
        (devices, groups)
    }

    #[test]
    fn group_scene_id_returns_unanimous_scene() {
        let device_a = make_controllable("z2m", "a", "A", Some("normal"));
        let device_b = make_controllable("z2m", "b", "B", Some("normal"));

        let mut config = GroupsConfig::new();
        config.insert(
            GroupId::from_str("upstairs").unwrap(),
            GroupConfig {
                name: "Upstairs".into(),
                devices: Some(vec![
                    DeviceRef::new_with_id(
                        IntegrationId::from("z2m".to_string()),
                        DeviceId::new("a"),
                    ),
                    DeviceRef::new_with_id(
                        IntegrationId::from("z2m".to_string()),
                        DeviceId::new("b"),
                    ),
                ]),
                groups: None,
                hidden: None,
            },
        );

        let (devices, groups) = populated_groups(vec![device_a, device_b], config);

        assert_eq!(
            groups.get_group_scene_id(devices.get_state(), &GroupId::from_str("upstairs").unwrap()),
            Some(SceneId::from_str("normal").unwrap())
        );
    }

    #[test]
    fn group_scene_id_is_none_when_mixed() {
        let device_a = make_controllable("z2m", "a", "A", Some("normal"));
        let device_b = make_controllable("z2m", "b", "B", Some("dark"));

        let mut config = GroupsConfig::new();
        config.insert(
            GroupId::from_str("mixed").unwrap(),
            GroupConfig {
                name: "Mixed".into(),
                devices: Some(vec![
                    DeviceRef::new_with_id(
                        IntegrationId::from("z2m".to_string()),
                        DeviceId::new("a"),
                    ),
                    DeviceRef::new_with_id(
                        IntegrationId::from("z2m".to_string()),
                        DeviceId::new("b"),
                    ),
                ]),
                groups: None,
                hidden: None,
            },
        );

        let (devices, groups) = populated_groups(vec![device_a, device_b], config);

        assert_eq!(
            groups.get_group_scene_id(devices.get_state(), &GroupId::from_str("mixed").unwrap()),
            None
        );
    }

    #[test]
    fn groups_containing_device_returns_all_memberships() {
        let device_a = make_controllable("z2m", "a", "Switch", None);

        let mut config = GroupsConfig::new();
        config.insert(
            GroupId::from_str("room").unwrap(),
            GroupConfig {
                name: "Room".into(),
                devices: Some(vec![DeviceRef::new_with_id(
                    IntegrationId::from("z2m".to_string()),
                    DeviceId::new("a"),
                )]),
                groups: None,
                hidden: None,
            },
        );
        config.insert(
            GroupId::from_str("floor").unwrap(),
            GroupConfig {
                name: "Floor".into(),
                devices: None,
                groups: Some(vec![GroupLink {
                    group_id: GroupId::from_str("room").unwrap(),
                }]),
                hidden: None,
            },
        );
        config.insert(
            GroupId::from_str("unrelated").unwrap(),
            GroupConfig {
                name: "Unrelated".into(),
                devices: None,
                groups: None,
                hidden: None,
            },
        );

        let (_devices, groups) = populated_groups(vec![device_a.clone()], config);

        let mut memberships = groups.groups_containing_device(&device_a.get_device_key());
        memberships.sort();
        assert_eq!(
            memberships,
            vec![
                GroupId::from_str("floor").unwrap(),
                GroupId::from_str("room").unwrap(),
            ]
        );
    }
}
