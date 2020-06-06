use super::{
    bridge::{BridgeLight, BridgeSensor},
    utils::{cmp_button_id, DimmerSwitchButtonId},
};

use crate::homectl_core::device::{Light, SensorKind};
use palette::{Hsl, IntoColor, Lch};

pub fn to_palette(bridge_light: BridgeLight) -> Option<Lch> {
    let hue: f32 = bridge_light.state.hue? as f32;
    let saturation: f32 = bridge_light.state.sat? as f32;
    let lightness: f32 = bridge_light.state.bri? as f32;

    let hsl = Hsl::new(
        (hue / 65536.0) * 360.0,
        saturation / 254.0,
        lightness / 254.0,
    );
    let lch: Lch = hsl.into_lch();

    Some(lch)
}

pub fn to_light(bridge_light: BridgeLight) -> Light {
    Light {
        power: bridge_light.state.on,
        brightness: None,
        color: to_palette(bridge_light.clone()),
    }
}

pub fn to_sensor(bridge_sensor: BridgeSensor) -> SensorKind {
    match bridge_sensor {
        BridgeSensor::ZLLPresence { name, state } => SensorKind::OnOffSensor {
            value: state.presence,
        },
        BridgeSensor::ZLLSwitch { name, state } => SensorKind::DimmerSwitch {
            on: false,
            up: false,
            down: false,
            off: false,
        },
        _ => SensorKind::Unknown,
    }
}
