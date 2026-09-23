//! Bounded, persisted values that help authors choose condition thresholds.
use crate::types::device::{Device, DeviceData};
use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::mpsc;

type ChangeBatch = (String, Vec<(String, Value)>, i64);
static WRITER: OnceLock<mpsc::UnboundedSender<ChangeBatch>> = OnceLock::new();

fn writer() -> &'static mpsc::UnboundedSender<ChangeBatch> {
    WRITER.get_or_init(|| {
        let (tx, mut rx) = mpsc::unbounded_channel::<ChangeBatch>();
        tokio::spawn(async move {
            while let Some((key, fields, at)) = rx.recv().await {
                let mut warned = false;
                for (path, value) in fields {
                    if let Err(error) =
                        crate::db::config_queries::db_record_value_change(&key, &path, &value, at)
                            .await
                    {
                        if !warned {
                            log::warn!("Could not store value history for {key}: {error}");
                            warned = true;
                        }
                    }
                }
            }
        });
        tx
    })
}

fn flatten(value: &Value, prefix: &str, fields: &mut Vec<(String, Value)>, depth: usize) {
    if depth > 4 {
        return;
    }
    if let Value::Object(map) = value {
        for (key, child) in map {
            let path = format!("{prefix}/{}", key.replace('~', "~0").replace('/', "~1"));
            if child.is_object() {
                flatten(child, &path, fields, depth + 1);
            } else if !child.is_array() && !child.is_null() {
                fields.push((path, child.clone()));
            }
        }
    }
}

pub fn observe_device(device: &Device) {
    if crate::db::get_db_connection().is_err() {
        return;
    }
    let fields = fields_for_device(device);
    if fields.is_empty() {
        return;
    }
    let key = device.get_device_key().to_string();
    let _ = writer().send((key, fields, chrono::Utc::now().timestamp_millis()));
}

pub fn fields_for_device(device: &Device) -> Vec<(String, Value)> {
    let mut fields = Vec::new();
    match &device.data {
        DeviceData::Sensor(sensor) => {
            if let Ok(value) = serde_json::to_value(sensor) {
                let value = value.get("value").cloned().unwrap_or(value);
                fields.push(("/value".into(), value.clone()));
                fields.push(("/observed/value".into(), value.clone()));
                if value.is_object() {
                    flatten(&value, "/value", &mut fields, 0);
                    flatten(&value, "", &mut fields, 0);
                }
            }
        }
        DeviceData::Controllable(data) => {
            if let Ok(value) = serde_json::to_value(&data.state) {
                for field in ["power", "brightness", "color"] {
                    if let Some(found) = value.get(field).filter(|found| !found.is_null()) {
                        fields.push((format!("/{field}"), found.clone()));
                    }
                }
            }
            if let Some(report) = &data.last_report {
                if let Ok(value) = serde_json::to_value(&report.state) {
                    for field in ["power", "brightness", "color", "transition"] {
                        if let Some(found) = value.get(field).filter(|found| !found.is_null()) {
                            fields.push((format!("/observed/{field}"), found.clone()));
                        }
                    }
                }
                fields.push((
                    "/last_report/received_at_ms".into(),
                    Value::from(report.received_at_ms),
                ));
                fields.push(("/last_report/retained".into(), Value::Bool(report.retained)));
                fields.push((
                    "/last_report/matches_requested".into(),
                    Value::Bool(report.matches_requested),
                ));
            }
            if let Some(availability) = &data.availability {
                fields.push((
                    "/availability/online".into(),
                    Value::Bool(availability.online),
                ));
                fields.push((
                    "/availability/observed_at_ms".into(),
                    Value::from(availability.observed_at_ms),
                ));
            }
            if let Some(scene_id) = &data.scene_id {
                fields.push(("/scene_id".into(), Value::String(scene_id.to_string())));
            }
        }
    }
    fields
}

pub fn observe_helper(id: &str, value: &Value) {
    if crate::db::get_db_connection().is_err() {
        return;
    }
    let _ = writer().send((
        format!("helper/{id}"),
        vec![("/value".into(), value.clone())],
        chrono::Utc::now().timestamp_millis(),
    ));
}
