use cached::proc_macro::cached;
use evalexpr::*;
use eyre::Result;

use crate::types::device::DevicesState;

fn value_kv_pairs_deep(
    value: &serde_json::Value,
    prefix: String,
) -> Vec<(String, serde_json::Value)> {
    match value {
        serde_json::Value::Object(object) => object
            .iter()
            .flat_map(|(key, value)| {
                let key = format!("{}.{}", prefix, key);
                value_kv_pairs_deep(value, key)
            })
            .collect(),
        serde_json::Value::Array(array) => array
            .iter()
            .enumerate()
            .flat_map(|(i, value)| {
                let key = format!("{}.{}", prefix, i);
                value_kv_pairs_deep(value, key)
            })
            .collect(),
        _ => vec![(prefix, value.clone())],
    }
}

#[cached(size = 1, result = true)]
pub fn state_to_eval_context(devices: DevicesState) -> Result<HashMapContext> {
    let mut context = HashMapContext::new();

    for device in devices.0.values() {
        let root_value = device.get_value();
        let prefix = format!("{}.{}", device.integration_id, device.name)
            .to_lowercase()
            .replace(' ', "_");
        let values = value_kv_pairs_deep(&root_value, prefix);

        for (key, value) in values {
            let value = match value {
                serde_json::Value::Bool(b) => Value::Boolean(b),
                serde_json::Value::Number(n) => Value::Float(n.as_f64().ok_or_else(|| {
                    eyre!("Failed to convert number to float for rule evaluation")
                })?),
                serde_json::Value::String(s) => Value::String(s),
                serde_json::Value::Null => Value::Empty,
                serde_json::Value::Array(_) => continue,
                serde_json::Value::Object(_) => continue,
            };

            context.set_value(key, value)?;
        }
    }

    Ok(context)
}
