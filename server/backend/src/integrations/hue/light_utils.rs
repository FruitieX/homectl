use super::bridge::BridgeLight;

use homectl_types::{
    device::{Device, DeviceColor, DeviceId, DeviceState, Light},
    integration::IntegrationId,
};
use palette::Yxy;

/// Convert BridgeLight color into Lch
pub fn to_palette(bridge_light: BridgeLight) -> Option<DeviceColor> {
    // let hue: f32 = bridge_light.state.hue? as f32;
    // let saturation: f32 = bridge_light.state.sat? as f32;
    // let lightness: f32 = bridge_light.state.bri? as f32;

    // let hsv = Hsv::new(
    //     (hue / 65536.0) * 360.0,
    //     saturation / 254.0,
    //     lightness / 254.0,
    // );
    // let device_color: DeviceColor = hsv.into();

    let (x, y) = bridge_light.state.xy?;
    let brightness: f32 = bridge_light.state.bri? as f32;
    let hsv = Yxy::new(x, y, brightness / 254.0);
    let mut device_color: DeviceColor = hsv.into();
    device_color.value = brightness / 254.0;

    Some(device_color)
}

/// Constructs Light kind from BridgeLight
pub fn to_light(bridge_light: BridgeLight) -> Light {
    let transition_ms = bridge_light
        .state
        .transitiontime
        .map(|transitiontime| (transitiontime * 100) as u64);

    Light::new_with_color(
        bridge_light.state.on,
        None,
        to_palette(bridge_light),
        transition_ms,
    )
}

/// Converts BridgeLight into Device
pub fn bridge_light_to_device(
    id: DeviceId,
    integration_id: IntegrationId,
    bridge_light: BridgeLight,
) -> Device {
    let name = bridge_light.name.clone();
    let state = DeviceState::Light(to_light(bridge_light));

    Device {
        id: DeviceId::new(&format!("lights/{}", id)),
        name,
        integration_id,
        scene: None,
        state,
    }
}
