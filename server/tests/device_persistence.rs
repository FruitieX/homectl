//! Device persistence across restarts.

mod common;

use common::{TestServer, TestServerConfig};
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn config_with_dummy_device() -> Value {
    json!({
        "version": 1,
        "core": { "warmup_time_seconds": 0 },
        "integrations": [{
            "id": "dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {
                    "lamp": {
                        "name": "Persisted lamp",
                        "init_state": {"Controllable": {
                            "scene_id": null,
                            "state_source": null,
                            "capabilities": {"brightness": true},
                            "state": {"power": true, "brightness": 0.4, "color": null, "transition": null},
                            "managed": "Full"
                        }}
                    }
                }
            }
        }],
        "groups": [],
        "scenes": [],
        "routines": [],
        "helpers": [],
        "helper_values": [],
        "sources": [],
        "floorplan": null,
        "floorplans": [],
        "group_positions": [],
        "device_display_overrides": [],
        "device_color_calibrations": [],
        "color_calibration_profiles": [],
        "color_calibration_assignments": [],
        "device_sensor_configs": [],
        "dashboard_layouts": [],
        "dashboard_widgets": [],
        "widget_settings": []
    })
}

fn get_json(base_url: &str, path: &str) -> Value {
    Client::new()
        .get(format!("{base_url}{path}"))
        .send()
        .unwrap()
        .json()
        .unwrap()
}

fn device_present(base_url: &str) -> bool {
    let devices = get_json(base_url, "/api/v1/devices");
    let devices = devices["devices"].as_array().cloned().unwrap_or_default();
    devices
        .iter()
        .any(|device| device["integration_id"] == "dummy" && device["id"] == "lamp")
}

fn wait_until(description: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !condition() {
        assert!(Instant::now() < deadline, "{description} never happened");
        thread::sleep(Duration::from_millis(100));
    }
}

/// A device row persisted for an integration that is later disabled must not be
/// restored on restart, otherwise a stale device shadows a computed-source
/// alias and keeps feeding frozen values to scene device links.
#[test]
fn disabled_integration_devices_do_not_resurrect_on_restart() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_device_persistence_{}_{}",
        std::process::id(),
        unique
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }
    std::fs::create_dir_all(&temp_dir).unwrap();

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        config_content: Some(config_with_dummy_device().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("start server");

    wait_until("dummy/lamp to appear", || device_present(&server.base_url));

    // Give the debounced writer time to persist the device row.
    thread::sleep(Duration::from_millis(1500));

    let client = Client::new();
    let integration: Value = get_json(&server.base_url, "/api/v1/config/integrations/dummy");
    let mut row = integration["data"].clone();
    row["enabled"] = json!(false);
    let response = client
        .put(format!(
            "{}/api/v1/config/integrations/dummy",
            server.base_url
        ))
        .json(&row)
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    wait_until("dummy/lamp to disappear", || {
        !device_present(&server.base_url)
    });

    // Let the asynchronous row deletion land before stopping the process.
    thread::sleep(Duration::from_millis(1000));

    let mut server = server;
    server.stop();
    drop(server);

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("restart server");

    let integrations = get_json(&server.base_url, "/api/v1/config/integrations");
    let dummy = integrations["data"]
        .as_array()
        .expect("integrations")
        .iter()
        .find(|row| row["id"] == "dummy")
        .cloned()
        .expect("dummy integration");
    assert_eq!(dummy["enabled"], json!(false));

    // Wait a few seconds to be sure the device never comes back.
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        assert!(
            !device_present(&server.base_url),
            "disabled integration device was resurrected from the database"
        );
        thread::sleep(Duration::from_millis(200));
    }

    drop(server);
    std::fs::remove_dir_all(&temp_dir).unwrap();
}
