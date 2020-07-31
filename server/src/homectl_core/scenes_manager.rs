use super::{
    device::{Device, DeviceSceneState, DeviceState, Light},
    devices_manager::{find_device, DevicesState},
    group::GroupDeviceLink,
    groups_manager::GroupsManager,
    scene::{
        color_config_as_device_color, SceneConfig, SceneDeviceConfig, SceneDevicesConfig, SceneId,
        ScenesConfig,
    },
};
use std::collections::HashMap;

pub struct ScenesManager {
    config: ScenesConfig,
    groups_manager: GroupsManager,
}

impl ScenesManager {
    pub fn new(config: ScenesConfig, groups_manager: GroupsManager) -> Self {
        ScenesManager {
            config,
            groups_manager,
        }
    }

    pub fn find_scene(&self, scene_id: &SceneId) -> Option<&SceneConfig> {
        self.config.get(scene_id)
    }

    pub fn find_scene_devices_config(
        &self,
        devices: &DevicesState,
        scene_id: &SceneId,
    ) -> Option<SceneDevicesConfig> {
        let scene = self.find_scene(&scene_id)?;

        let mut scene_devices = scene.devices.clone().unwrap_or(HashMap::new());

        // replace device names by device_ids in device_configs
        scene_devices = scene_devices
            .iter()
            .map(|(integration_id, device_configs)| {
                (
                    integration_id.clone(),
                    device_configs
                        .iter()
                        .map(|(device_name, device_config)| {
                            let device =
                                find_device(devices, &integration_id, None, Some(device_name));

                            let device_id = device.map(|d| d.id).unwrap_or(String::from("N/A"));
                            (device_id, device_config.clone())
                        })
                        .collect(),
                )
            })
            .collect();

        let scene_groups = scene.groups.clone().unwrap_or(HashMap::new());

        // merges in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = self.groups_manager.find_group_device_links(&group_id);

            for GroupDeviceLink {
                integration_id,
                device_id,
                name,
            } in group_devices
            {
                let device =
                    find_device(devices, &integration_id, device_id.as_ref(), name.as_ref());

                match device {
                    Some(device) => {
                        let empty_devices_integrations = HashMap::new();
                        let mut scene_devices_integrations = scene_devices
                            .get(&integration_id)
                            .unwrap_or(&empty_devices_integrations)
                            .to_owned();

                        // only insert device config if it did not exist yet
                        if !scene_devices_integrations.contains_key(&device.id) {
                            scene_devices_integrations
                                .insert(device.id, scene_device_config.clone());
                        }
                        scene_devices.insert(integration_id, scene_devices_integrations.clone());
                    }
                    None => {}
                }
            }
        }

        Some(scene_devices)
    }

    pub fn find_scene_device_state(
        &self,
        device: &Device,
        devices: &DevicesState,
    ) -> Option<DeviceState> {
        let scene_id = &device.scene.as_ref()?.scene_id;

        let scene_devices = self.find_scene_devices_config(devices, scene_id)?;
        let scene_device = scene_devices.get(&device.integration_id)?.get(&device.id)?;

        match scene_device {
            SceneDeviceConfig::SceneDeviceLink(link) => {
                // Use state from another device

                // Try finding device by integration_id, device_id, name
                let device = find_device(
                    devices,
                    &link.integration_id,
                    link.device_id.as_ref(),
                    link.name.as_ref(),
                )?;

                let state = device.state.clone();
                Some(state)
            }

            SceneDeviceConfig::SceneLink(link) => {
                // Use state from another scene
                let device = Device {
                    scene: Some(DeviceSceneState {
                        scene_id: link.scene_id.clone(),
                        ..device.scene.clone()?
                    }),
                    ..device.clone()
                };
                self.find_scene_device_state(&device, devices)
            }

            SceneDeviceConfig::SceneDeviceState(scene_device) => Some(DeviceState::Light(Light {
                // Use state from scene_device
                brightness: scene_device.brightness,
                color: scene_device.color.clone().map(color_config_as_device_color),
                power: scene_device.power,
            })),
        }
    }
}
