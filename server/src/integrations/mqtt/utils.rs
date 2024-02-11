use crate::integrations::mqtt::MqttConfig;
use crate::types::color::{Capabilities, DeviceColor};
use crate::types::{
    device::{ControllableDevice, Device, DeviceData, DeviceId, SensorDevice},
    integration::IntegrationId,
};
use color_eyre::Result;
use eyre::eyre;
use jsonptr::Assign;

pub fn mqtt_to_homectl(
    payload: &[u8],
    integration_id: IntegrationId,
    config: &MqttConfig,
) -> Result<Device> {
    let value: serde_json::Value = serde_json::from_slice(payload)?;

    let id_field = config.id_field.as_deref().unwrap_or("/id");
    let name_field = config.name_field.as_deref().unwrap_or("/name");
    let color_field = config.color_field.as_deref().unwrap_or("/color");
    let power_field = config.power_field.as_deref().unwrap_or("/power");
    let brightness_field = config.brightness_field.as_deref().unwrap_or("/brightness");
    let sensor_value_field = config
        .sensor_value_field
        .as_deref()
        .unwrap_or("/sensor_value");
    let transition_ms_field = config
        .transition_ms_field
        .as_deref()
        .unwrap_or("/transition_ms");
    let capabilities_field = config
        .capabilities_field
        .as_deref()
        .unwrap_or("/capabilities");

    let id = value
        .pointer(id_field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| eyre!("Missing '{id_field}' field in MQTT message"))?
        .to_string();

    let name = value
        .pointer(name_field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| eyre!("Missing '{name_field}' field in MQTT message"))?
        .to_string();

    let color = value
        .pointer(color_field)
        .and_then(|value| serde_json::from_value::<DeviceColor>(value.clone()).ok());

    let power = value
        .pointer(power_field)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_default();

    let brightness = value
        .pointer(brightness_field)
        .and_then(serde_json::Value::as_f64)
        .map(|value| value as f32);

    let transition_ms = value
        .pointer(transition_ms_field)
        .and_then(serde_json::Value::as_u64);

    let device_state =
        if let Some(value) = value.pointer(sensor_value_field).filter(|v| !v.is_null()) {
            DeviceData::Sensor(match value {
                serde_json::Value::Number(value) => SensorDevice::Number {
                    value: value.as_f64().unwrap(),
                },

                serde_json::Value::Bool(value) => SensorDevice::Boolean { value: *value },

                // TODO: get rid of this hack and use proper booleans
                serde_json::Value::String(value) if value == "true" => {
                    SensorDevice::Boolean { value: true }
                }
                serde_json::Value::String(value) if value == "false" => {
                    SensorDevice::Boolean { value: false }
                }

                serde_json::Value::String(value) => SensorDevice::Text {
                    value: value.clone(),
                },
                _ => {
                    return Err(eyre!(
                        "Unsupported value for sensor field '{sensor_value_field}'",
                    ))
                }
            })
        } else {
            let capabilities: Capabilities = value
                .pointer(capabilities_field)
                .and_then(|value| serde_json::from_value(value.clone()).ok())
                .unwrap_or_default();

            let controllable_device = ControllableDevice::new(
                None,
                power,
                brightness,
                color,
                transition_ms,
                capabilities,
                config.managed.clone().unwrap_or_default(),
            );

            DeviceData::Controllable(controllable_device)
        };

    let raw = value
        .pointer(config.raw_field.as_deref().unwrap_or("/raw"))
        .cloned();

    Ok(Device {
        id: DeviceId::new(&id),
        name,
        integration_id,
        data: device_state,
        raw,
    })
}

pub fn homectl_to_mqtt(device: Device, config: &MqttConfig) -> Result<serde_json::Value> {
    let mut payload = serde_json::Value::default();

    let id_field = config
        .id_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["id"]));
    let name_field = config
        .name_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["name"]));
    let color_field = config
        .color_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["color"]));
    let power_field = config
        .power_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["power"]));
    let brightness_field = config
        .brightness_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["brightness"]));
    let transition_ms_field = config
        .transition_ms_field
        .clone()
        .unwrap_or_else(|| jsonptr::Pointer::new(["transition_ms"]));

    payload.assign(&id_field, serde_json::Value::String(device.id.to_string()))?;
    payload.assign(&name_field, serde_json::Value::String(device.name))?;

    if let DeviceData::Controllable(device) = device.data {
        payload.assign(&power_field, serde_json::Value::Bool(device.state.power))?;

        if let Some(brightness) = device.state.brightness {
            payload.assign(
                &brightness_field,
                serde_json::Number::from_f64((*brightness).into())
                    .map(serde_json::Value::Number)
                    .unwrap(),
            )?;
        }

        if let Some(color) = &device.state.color {
            payload.assign(&color_field, serde_json::to_value(color)?)?;
        }

        if let Some(transition_ms) = device.state.transition_ms {
            payload.assign(
                &transition_ms_field,
                serde_json::Number::from_f64(transition_ms as f64)
                    .map(serde_json::Value::Number)
                    .unwrap(),
            )?;
        }
    };

    Ok(payload)
}

#[cfg(test)]
mod tests {
    use crate::types::{
        color::{Capabilities, ColorMode, Hs},
        device::ManageKind,
    };

    use super::*;
    use ordered_float::OrderedFloat;
    use serde_json::json;
    use std::str::FromStr;

    #[test]
    fn test_homectl_to_mqtt() {
        // Create a device and MqttConfig
        let device = Device {
            id: DeviceId::new("device1"),
            name: "Device 1".to_string(),
            integration_id: IntegrationId::from_str("mqtt").unwrap(),
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                Some(DeviceColor::Hs(Hs {
                    h: 45,
                    s: OrderedFloat(1.0),
                })),
                Some(1000),
                Capabilities::default(),
                ManageKind::Full,
            )),
            raw: None,
        };

        let config = MqttConfig {
            host: "localhost".to_string(),
            port: 1883,
            topic: "homectl/devices/{id}".to_string(),
            topic_set: "homectl/set/{id}".to_string(),
            ..Default::default()
        };

        let mqtt_json = homectl_to_mqtt(device, &config).unwrap();

        let expected = json!({
            "id": "device1",
            "name": "Device 1",
            "color": { "h": 45, "s": 1.0 },
            "power": true,
            "brightness": 0.5,
            "transition_ms": serde_json::json!(1000.0),
        });

        assert_eq!(mqtt_json, expected);
    }

    #[test]
    fn test_mqtt_to_homectl() {
        let mqtt_json = json!({
            "id": "device1",
            "name": "Device 1",
            "color": { "h": 45, "s": 1.0 },
            "power": true,
            "brightness": 0.5,
            "transition_ms": 1000,
            "capabilities": { "ct": serde_json::Value::Null, "hs": true, "rgb": false, "xy": false }
        });

        let config = MqttConfig {
            host: "localhost".to_string(),
            port: 1883,
            topic: "homectl/devices/{id}".to_string(),
            topic_set: "homectl/set/{id}".to_string(),
            managed: Some(ManageKind::Unmanaged),
            ..Default::default()
        };

        let integration_id = IntegrationId::from_str("mqtt").unwrap();
        let device = mqtt_to_homectl(
            mqtt_json.to_string().as_bytes(),
            integration_id.clone(),
            &config,
        )
        .unwrap();

        let expected = Device {
            id: DeviceId::new("device1"),
            name: "Device 1".to_string(),
            integration_id,
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                Some(DeviceColor::Hs(Hs {
                    h: 45,
                    s: OrderedFloat(1.0),
                })),
                Some(1000),
                Capabilities::singleton(ColorMode::Hs),
                ManageKind::Unmanaged,
            )),
            raw: None,
        };

        assert_eq!(device, expected);
    }

    #[tokio::test]
    async fn test_integration() {
        let mqtt_json = json!({
            "id": "device1",
            "name": "Device 1",
            "color": { "h": 45, "s": 1.0 },
            "power": true,
            "brightness": 0.5,
        });

        let config = MqttConfig {
            host: "localhost".to_string(),
            port: 1883,
            topic: "homectl/devices/{id}".to_string(),
            topic_set: "homectl/set/{id}".to_string(),
            managed: Some(ManageKind::Unmanaged),
            ..Default::default()
        };

        let integration_id = IntegrationId::from_str("mqtt").unwrap();
        let device =
            mqtt_to_homectl(mqtt_json.to_string().as_bytes(), integration_id, &config).unwrap();
        let mqtt_message_value = homectl_to_mqtt(device, &config).unwrap();

        assert_eq!(mqtt_json, mqtt_message_value);
    }
}
