use crate::integrations::mqtt::MqttConfig;
use anyhow::Result;
use homectl_types::{
    device::{
        CorrelatedColorTemperature, Device, DeviceColor, DeviceId, DeviceState, Light, OnOffDevice,
        SensorKind,
    },
    integration::IntegrationId,
};
use json_value_merge::Merge;
use palette::Hsv;

pub fn mqtt_to_homectl(
    payload: &[u8],
    integration_id: IntegrationId,
    config: &MqttConfig,
) -> Result<Device> {
    let value: serde_json::Value = serde_json::from_slice(payload)?;

    let id_field = config.id_field.as_deref().unwrap_or("/id");
    let name_field = config.name_field.as_deref().unwrap_or("/name");
    let color_field = config.color_field.as_deref().unwrap_or("/color");
    let cct_field = config.cct_field.as_deref().unwrap_or("/cct");
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

    let id = value
        .pointer(id_field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing '{}' field in MQTT message", id_field))?
        .to_string();

    let name = value
        .pointer(name_field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing '{}' field in MQTT message", name_field))?
        .to_string();

    let color = value
        .pointer(color_field)
        .and_then(serde_json::Value::as_array)
        .and_then(|array| {
            if array.len() == 3 {
                Some((
                    array[0].as_f64().unwrap(),
                    array[1].as_f64().unwrap(),
                    array[2].as_f64().unwrap(),
                ))
            } else {
                None
            }
        })
        .map(|(h, s, v)| DeviceColor::Hsv(Hsv::from((h as f32, s as f32, v as f32))))
        .or_else(|| {
            value
                .pointer(cct_field)
                .and_then(serde_json::Value::as_f64)
                .map(|value| {
                    DeviceColor::Cct(CorrelatedColorTemperature::new(
                        value as f32,
                        2700.0..6500.0,
                    ))
                })
        });

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

    let device_state = if value
        .pointer(sensor_value_field)
        .filter(|v| !v.is_null())
        .is_some()
    {
        if let Ok(value) = value
            .pointer(sensor_value_field)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .parse::<bool>()
        {
            DeviceState::Sensor(SensorKind::OnOffSensor { value })
        } else {
            DeviceState::Sensor(SensorKind::StringValue {
                value: value
                    .pointer(sensor_value_field)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
        }
    } else if brightness.is_some() {
        DeviceState::Light(Light {
            power,
            brightness,
            color,
            transition_ms,
        })
    } else {
        DeviceState::OnOffDevice(OnOffDevice { power })
    };

    Ok(Device {
        id: DeviceId::new(&id),
        name,
        integration_id,
        scene: None,
        state: device_state,
    })
}

pub fn homectl_to_mqtt(device: Device, config: &MqttConfig) -> Result<serde_json::Value> {
    let mut payload = serde_json::Value::default();

    let id_field = config.id_field.as_deref().unwrap_or("/id");
    let name_field = config.name_field.as_deref().unwrap_or("/name");
    let color_field = config.color_field.as_deref().unwrap_or("/color");
    let cct_field = config.cct_field.as_deref().unwrap_or("/cct");
    let power_field = config.power_field.as_deref().unwrap_or("/power");
    let brightness_field = config.brightness_field.as_deref().unwrap_or("/brightness");
    let transition_ms_field = config
        .transition_ms_field
        .as_deref()
        .unwrap_or("/transition_ms");

    payload.merge_in(id_field, serde_json::Value::String(device.id.to_string()))?;
    payload.merge_in(name_field, serde_json::Value::String(device.name))?;

    match device.state {
        DeviceState::OnOffDevice(on_off_device) => {
            payload.merge_in(power_field, serde_json::Value::Bool(on_off_device.power))?;
        }
        DeviceState::Light(light) => {
            payload.merge_in(power_field, serde_json::Value::Bool(light.power))?;

            if let Some(brightness) = light.brightness {
                payload.merge_in(
                    brightness_field,
                    serde_json::Number::from_f64(brightness.into())
                        .map(serde_json::Value::Number)
                        .unwrap(),
                )?;
            }

            if let Some(DeviceColor::Hsv(hsv)) = light.color {
                let (h, s, v) = (hsv.hue.to_degrees(), hsv.saturation, hsv.value);
                payload.merge_in(color_field, serde_json::json!([h, s, v]))?;
            }

            if let Some(DeviceColor::Cct(cct)) = light.color {
                payload.merge_in(
                    cct_field,
                    serde_json::Number::from_f64(cct.get_cct().into())
                        .map(serde_json::Value::Number)
                        .unwrap(),
                )?;
            }

            if let Some(transition_ms) = light.transition_ms {
                payload.merge_in(
                    transition_ms_field,
                    serde_json::Number::from_f64(transition_ms as f64)
                        .map(serde_json::Value::Number)
                        .unwrap(),
                )?;
            }
        }
        DeviceState::MultiSourceLight(_) => unimplemented!(),
        DeviceState::Sensor(_) => unimplemented!(),
    };

    Ok(payload)
}
