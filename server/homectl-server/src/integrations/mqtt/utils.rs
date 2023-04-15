use anyhow::Result;
use homectl_types::{
    device::{
        CorrelatedColorTemperature, Device, DeviceColor, DeviceId, DeviceState, Light, OnOffDevice,
        SensorKind,
    },
    integration::IntegrationId,
};

use super::MqttDevice;

pub fn mqtt_to_homectl(mqtt_device: MqttDevice, integration_id: IntegrationId) -> Result<Device> {
    let color = if let Some(color) = mqtt_device.color {
        Some(DeviceColor::Hsv(color))
    } else {
        mqtt_device
            .cct
            .map(|cct| DeviceColor::Cct(CorrelatedColorTemperature::new(cct, 2700.0..6500.0)))
    };

    let state = if let Some(value) = mqtt_device.sensor_value {
        if let Ok(value) = value.parse::<bool>() {
            DeviceState::Sensor(SensorKind::OnOffSensor { value })
        } else {
            DeviceState::Sensor(SensorKind::StringValue { value })
        }
    } else if mqtt_device.brightness.is_some() {
        DeviceState::Light(Light {
            power: mqtt_device.power.unwrap_or_default(),
            brightness: mqtt_device.brightness,
            color,
            transition_ms: None,
        })
    } else {
        DeviceState::OnOffDevice(OnOffDevice {
            power: mqtt_device.power.unwrap_or_default(),
        })
    };

    Ok(Device {
        id: DeviceId::new(&mqtt_device.id),
        name: mqtt_device.name,
        integration_id,
        scene: None,
        state,
    })
}

pub fn homectl_to_mqtt(device: Device) -> Result<MqttDevice> {
    let mqtt_device = match device.state {
        DeviceState::OnOffDevice(state) => MqttDevice {
            id: device.id.to_string(),
            name: device.name,
            power: Some(state.power),
            brightness: None,
            cct: None,
            color: None,
            transition_ms: None,
            sensor_value: None,
        },
        DeviceState::Light(state) => {
            let color = match state.color {
                Some(DeviceColor::Hsv(hsv)) => Some(hsv),
                _ => None,
            };

            let cct = match state.color {
                Some(DeviceColor::Cct(cct)) => Some(cct.get_cct()),
                _ => None,
            };

            MqttDevice {
                id: device.id.to_string(),
                name: device.name,
                power: Some(state.power),
                brightness: state.brightness,
                cct,
                color,
                transition_ms: None,
                sensor_value: None,
            }
        }
        DeviceState::MultiSourceLight(_) => unimplemented!(),
        DeviceState::Sensor(_) => unimplemented!(),
    };

    Ok(mqtt_device)
}
