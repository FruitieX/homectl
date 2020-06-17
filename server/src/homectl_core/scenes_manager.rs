use super::{
    device::{Device, DeviceSceneState, DeviceState, Light},
    devices_manager::DevicesState,
    groups_manager::GroupsManager, scene::{SceneDeviceConfig, ScenesConfig, color_config_as_lch}, group::GroupDeviceLink,
};
use std::collections::HashMap;

pub struct ScenesManager {
    config: ScenesConfig,
}

impl ScenesManager {
    pub fn new(config: ScenesConfig) -> Self {
        ScenesManager { config }
    }

    pub fn find_scene_device_state(
        &self,
        device: &Device,
        devices: &DevicesState,
        groups_manager: &GroupsManager,
    ) -> Option<DeviceState> {
        let scene_id = &device.scene.as_ref()?.scene_id;
        let scene = self.config.get(scene_id)?;

        let mut scene_devices = scene.devices.clone()?;
        let scene_groups = scene.groups.clone()?;

        // TODO: extract this part into a separate function to reduce clutter
        // merge in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = groups_manager.find_group_device_links(&group_id);

            for GroupDeviceLink {
                integration_id,
                device_id,
            } in group_devices
            {
                let empty_devices_integrations = HashMap::new();
                let mut scene_devices_integrations = scene_devices
                    .get(&integration_id)
                    .unwrap_or(&empty_devices_integrations)
                    .to_owned();
                scene_devices_integrations.insert(device_id, scene_device_config.clone());
                scene_devices.insert(integration_id, scene_devices_integrations.clone());
            }
        }

        let scene_device = scene_devices.get(&device.id)?.get(&device.integration_id)?;

        match scene_device {
            SceneDeviceConfig::SceneDeviceLink(link) => {
                // Use state from another device
                let device = devices.get(&(link.integration_id.clone(), link.device_id.clone()))?;
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
                self.find_scene_device_state(&device, devices, groups_manager)
            }

            SceneDeviceConfig::SceneDeviceState(scene_device) => Some(DeviceState::Light(Light {
                // Use state from scene_device
                brightness: scene_device.brightness,
                color: scene_device.color.clone().map(color_config_as_lch),
                power: scene_device.power,
            })),
        }
    }
}
