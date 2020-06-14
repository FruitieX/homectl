use super::{
    config::{color_config_as_lch, ScenesConfig},
    device::{Device, DeviceState, Light},
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
        let scene_device = scene.devices.get(&device.id)?;
        let state = DeviceState::Light(Light {
            brightness: scene_device.brightness,
            color: scene_device.color.clone().map(color_config_as_lch),
            power: scene_device.power,
        });

        Some(state)
    }
}
