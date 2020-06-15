use super::{
    config::{color_config_as_lch, SceneDeviceConfig, ScenesConfig},
    device::{Device, DeviceSceneState, DeviceState, Light},
    devices_manager::DevicesState,
};

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
    ) -> Option<DeviceState> {
        let scene_id = &device.scene.as_ref()?.scene_id;
        let scene = self.config.get(scene_id)?;
        let scene_devices = scene.devices.clone()?;
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
                self.find_scene_device_state(&device, devices)
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
