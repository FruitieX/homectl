use homectl_types::{
    device::{Device, DeviceId, DeviceSceneState, DeviceState, DevicesState, Light},
    group::GroupDeviceLink,
    scene::{
        color_config_as_device_color, SceneConfig, SceneDeviceConfig, SceneDevicesConfig, SceneId,
        ScenesConfig,
    },
};

use super::{devices::find_device, groups::Groups};
use std::collections::HashMap;

#[derive(Clone)]
pub struct Scenes {
    config: ScenesConfig,
    groups: Groups,
}

impl Scenes {
    pub fn new(config: ScenesConfig, groups: Groups) -> Self {
        Scenes { config, groups }
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

        let scene_devices_search_config = scene.devices.clone().unwrap_or_default();

        // replace device names by device_ids in device_configs
        let mut scene_devices_config: SceneDevicesConfig = scene_devices_search_config
            .iter()
            .map(|(integration_id, device_configs)| {
                (
                    integration_id.clone(),
                    device_configs
                        .iter()
                        .map(|(device_name, device_config)| {
                            let device =
                                find_device(devices, &integration_id, None, Some(device_name));

                            let device_id = device.map(|d| d.id).unwrap_or_else(|| {
                                println!(
                                    "Could not find device_id for {} device with name {}",
                                    integration_id, device_name
                                );
                                DeviceId::new("N/A")
                            });
                            (device_id, device_config.clone())
                        })
                        .collect(),
                )
            })
            .collect();

        let scene_groups = scene.groups.clone().unwrap_or_default();

        // merges in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = { self.groups.find_group_device_links(&group_id) };

            for GroupDeviceLink {
                integration_id,
                device_id,
                name,
            } in group_devices
            {
                let device =
                    find_device(devices, &integration_id, device_id.as_ref(), name.as_ref());

                if let Some(device) = device {
                    let empty_devices_integrations = HashMap::new();
                    let mut scene_devices_integrations = scene_devices_config
                        .get(&integration_id)
                        .unwrap_or(&empty_devices_integrations)
                        .to_owned();

                    // only insert device config if it did not exist yet
                    scene_devices_integrations
                        .entry(device.id)
                        .or_insert_with(|| scene_device_config.clone());
                    scene_devices_config.insert(integration_id, scene_devices_integrations.clone());
                }
            }
        }

        Some(scene_devices_config)
    }

    pub fn find_scene_device_state(
        &self,
        device: &Device,
        devices: &DevicesState,
        ignore_transition: bool,
    ) -> Option<DeviceState> {
        let scene_id = &device.scene.as_ref()?.scene_id;

        let scene_devices = self.find_scene_devices_config(devices, scene_id)?;
        let integration_devices = scene_devices.get(&device.integration_id)?;
        let scene_device = integration_devices.get(&device.id)?;

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

                let state = device.state;

                // Brightness override
                let state = match state {
                    DeviceState::Light(mut state) => {
                        state.brightness = link.brightness.or(state.brightness);
                        DeviceState::Light(state)
                    }
                    DeviceState::MultiSourceLight(mut state) => {
                        state.brightness = link.brightness.or(state.brightness);
                        DeviceState::MultiSourceLight(state)
                    }
                    DeviceState::OnOffDevice(state) => DeviceState::OnOffDevice(state),
                    DeviceState::Sensor(state) => DeviceState::Sensor(state),
                };

                // Ignore device's transition_ms value
                let state = match (ignore_transition, state.clone()) {
                    (true, DeviceState::Light(mut state)) => {
                        state.transition_ms = None;
                        DeviceState::Light(state)
                    }
                    _ => state,
                };

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
                self.find_scene_device_state(&device, devices, ignore_transition)
            }

            SceneDeviceConfig::SceneDeviceState(scene_device) => Some(DeviceState::Light(Light {
                // Use state from scene_device
                brightness: scene_device.brightness,
                color: scene_device.color.clone().map(color_config_as_device_color),
                power: scene_device.power,
                transition_ms: scene_device.transition_ms,
            })),
        }
    }
}
