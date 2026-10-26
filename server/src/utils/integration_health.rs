//! Process-wide integration health notes surfaced by `/health/ready`.
//!
//! Integrations publish a small JSON status here (for example whether the
//! Zigbee2MQTT device inventory is live, cached or missing). Readiness stays
//! 200; the details only make degraded discovery visible.
use std::{collections::BTreeMap, sync::Mutex};

use once_cell::sync::Lazy;
use serde_json::Value;

static STATUS: Lazy<Mutex<BTreeMap<String, Value>>> = Lazy::new(Default::default);

pub fn set(integration_id: &str, status: Value) {
    if let Ok(mut map) = STATUS.lock() {
        map.insert(integration_id.to_owned(), status);
    }
}

pub fn clear(integration_id: &str) {
    if let Ok(mut map) = STATUS.lock() {
        map.remove(integration_id);
    }
}

pub fn snapshot() -> BTreeMap<String, Value> {
    STATUS.lock().map(|map| map.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_replace_and_clear() {
        let id = "integration-health-test";
        set(id, json!({"bridge_devices": "waiting"}));
        set(id, json!({"bridge_devices": "live"}));
        assert_eq!(snapshot()[id], json!({"bridge_devices": "live"}));
        clear(id);
        assert!(!snapshot().contains_key(id));
    }
}
