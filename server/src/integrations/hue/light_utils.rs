use super::bridge::{BridgeLight, ColorMode};

use crate::types::{
    device::{CorrelatedColorTemperature, Device, DeviceColor, DeviceId, DeviceState, Light},
    integration::IntegrationId,
};
use palette::{FromColor, Hsv, Yxy};

pub fn to_light(bridge_light: BridgeLight) -> Light {
    let power = bridge_light.state.on;
    let xy = bridge_light.state.xy;
    let ct = bridge_light.state.ct.map(|ct| 1_000_000.0 / ct as f32);
    let hue = bridge_light.state.hue.map(|hue| hue as f32 / 65535.0);
    let sat = bridge_light.state.sat.map(|sat| sat as f32 / 254.0);
    let brightness = bridge_light.state.bri.map(|bri| bri as f32 / 254.0);
    let transition_ms = bridge_light
        .state
        .transitiontime
        .map(|transitiontime| (transitiontime * 100) as u64);

    let color = match bridge_light.state.colormode {
        Some(ColorMode::Ct) => (move || {
            let ct = ct?;
            let cct = CorrelatedColorTemperature::new(ct, 2000.0..6500.0);
            Some(DeviceColor::Cct(cct))
        })(),
        Some(ColorMode::Xy) => (move || {
            let (x, y) = xy?;
            let yxy = Yxy::new(x, y, 1.0);
            let mut device_color: Hsv = Hsv::from_color(yxy);
            device_color.value = 1.0;
            Some(DeviceColor::Hsv(device_color))
        })(),
        Some(ColorMode::Hs) => (move || {
            let hue = hue?;
            let sat = sat?;

            let device_color = Hsv::new(hue, sat, 1.0);
            Some(DeviceColor::Hsv(device_color))
        })(),
        None => None,
    };

    Light {
        power,
        brightness,
        color,
        transition_ms,
    }
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
