//! Integration tests that verify the production configuration works correctly
//! in a simulated environment.
//!
//! These tests start the server in simulation mode with the actual prod-config.toml,
//! which converts MQTT integrations to dummy equivalents. Then they exercise the main
//! logic paths: scene activation, motion sensor routines, switch routines, and
//! CycleScenes.

mod common;

use common::{TestServer, TestServerConfig};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Helper: create a simulation server from prod-config.toml
fn start_prod_simulation() -> TestServer {
    let config_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("prod-config.toml");

    assert!(
        config_path.exists(),
        "prod-config.toml not found at {}",
        config_path.display()
    );

    TestServer::with_config(TestServerConfig {
        simulate_config: Some(config_path),
        ..Default::default()
    })
    .expect("Failed to start simulation server with prod config")
}

/// HTTP GET helper returning parsed JSON
fn get(base_url: &str, path: &str) -> Value {
    reqwest::blocking::get(format!("{base_url}{path}"))
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"))
        .json()
        .unwrap_or_else(|e| panic!("GET {path} response parse failed: {e}"))
}

/// HTTP PUT helper (response may be non-JSON so we ignore the body)
fn put_raw(base_url: &str, path: &str, body: &Value) -> reqwest::blocking::Response {
    reqwest::blocking::Client::new()
        .put(format!("{base_url}{path}"))
        .json(body)
        .send()
        .unwrap_or_else(|e| panic!("PUT {path} failed: {e}"))
}

/// HTTP POST helper (response may be non-JSON so we ignore the body)
fn post_raw(base_url: &str, path: &str, body: &Value) -> reqwest::blocking::Response {
    reqwest::blocking::Client::new()
        .post(format!("{base_url}{path}"))
        .json(body)
        .send()
        .unwrap_or_else(|e| panic!("POST {path} failed: {e}"))
}

/// Find a device by name from /api/v1/devices response
fn find_device<'a>(devices: &'a Value, name: &str) -> Option<&'a Value> {
    devices["devices"]
        .as_array()
        .expect("devices should be an array")
        .iter()
        .find(|d| d["name"].as_str() == Some(name))
}

/// Get device power state by name
fn device_power(devices: &Value, name: &str) -> bool {
    let device = find_device(devices, name).unwrap_or_else(|| panic!("Device '{name}' not found"));
    device["data"]["Controllable"]["state"]["power"]
        .as_bool()
        .unwrap_or_else(|| {
            panic!(
                "Device '{name}' has no controllable power state: {:?}",
                device["data"]
            )
        })
}

/// Check if a device is a sensor
fn is_sensor(device: &Value) -> bool {
    device["data"].get("Sensor").is_some()
}

/// Set a sensor device value (for triggering routines).
/// Device IDs in dummy integration are just the device name.
fn set_sensor(base_url: &str, name: &str, value: Value) {
    let encoded_name = name.replace(' ', "%20");
    let resp = put_raw(
        base_url,
        &format!("/api/v1/devices/{encoded_name}"),
        &json!({
            "id": name,
            "name": name,
            "integration_id": "zigbee2mqtt",
            "data": { "Sensor": value }
        }),
    );
    assert!(
        resp.status().is_success(),
        "Failed to set sensor '{name}': HTTP {}",
        resp.status()
    );
}

/// Trigger an action via POST /api/v1/actions/trigger
/// Actions use #[serde(tag = "action")] format
fn trigger_action(base_url: &str, action: &Value) {
    let resp = post_raw(base_url, "/api/v1/actions/trigger", action);
    assert!(
        resp.status().is_success(),
        "Failed to trigger action: HTTP {}",
        resp.status()
    );
}

/// Wait for a condition on device state, with retries
fn wait_for_device_state(
    base_url: &str,
    device_name: &str,
    check: impl Fn(&Value) -> bool,
    description: &str,
) {
    for attempt in 0..30 {
        let devices = get(base_url, "/api/v1/devices");
        if let Some(device) = find_device(&devices, device_name) {
            if check(device) {
                return;
            }
        }
        if attempt < 29 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    let devices = get(base_url, "/api/v1/devices");
    let device = find_device(&devices, device_name);
    panic!(
        "Timed out waiting for condition on '{device_name}': {description}\nFinal state: {device:#?}",
    );
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn prod_config_server_boots() {
    let server = start_prod_simulation();

    // Verify health
    let resp = reqwest::blocking::get(format!("{}/health/live", server.base_url))
        .expect("health check failed");
    assert!(resp.status().is_success(), "Server should be live");

    // Verify devices were discovered
    let devices = get(&server.base_url, "/api/v1/devices");
    let device_list = devices["devices"].as_array().expect("devices array");
    assert!(
        device_list.len() > 30,
        "Expected 30+ devices from prod config, got {}",
        device_list.len()
    );

    // Verify we have both controllable and sensor devices
    let sensor_count = device_list.iter().filter(|d| is_sensor(d)).count();
    let controllable_count = device_list.iter().filter(|d| !is_sensor(d)).count();
    assert!(
        sensor_count > 0,
        "Expected some sensor devices, got {sensor_count}"
    );
    assert!(
        controllable_count > 20,
        "Expected 20+ controllable devices, got {controllable_count}"
    );
}

#[test]
fn prod_config_has_expected_config() {
    let server = start_prod_simulation();

    // Verify groups loaded
    let groups = get(&server.base_url, "/api/v1/config/groups");
    let group_list = groups["data"].as_array().expect("groups array");
    let group_ids: Vec<&str> = group_list
        .iter()
        .map(|g| g["id"].as_str().unwrap())
        .collect();

    for expected in &[
        "kitchen",
        "living_room",
        "bedroom",
        "office",
        "downstairs",
        "upstairs",
        "all",
        "outdoor",
    ] {
        assert!(
            group_ids.contains(expected),
            "Missing expected group '{expected}'. Found: {group_ids:?}"
        );
    }

    // Verify scenes loaded
    let scenes = get(&server.base_url, "/api/v1/config/scenes");
    let scene_list = scenes["data"].as_array().expect("scenes array");
    let scene_ids: Vec<&str> = scene_list
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();

    for expected in &["normal", "dark", "night", "bright", "leave"] {
        assert!(
            scene_ids.contains(expected),
            "Missing expected scene '{expected}'. Found: {scene_ids:?}"
        );
    }

    // Verify routines loaded
    let routines = get(&server.base_url, "/api/v1/config/routines");
    let routine_list = routines["data"].as_array().expect("routines array");
    let routine_ids: Vec<&str> = routine_list
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();

    for expected in &[
        "arrive_home",
        "leave_home",
        "entryway",
        "staircase_upstairs",
        "activate_nightlight",
    ] {
        assert!(
            routine_ids.contains(expected),
            "Missing expected routine '{expected}'. Found: {routine_ids:?}"
        );
    }

    // Verify integrations are all dummy (MQTT converted)
    let integrations = get(&server.base_url, "/api/v1/config/integrations");
    let int_list = integrations["data"].as_array().expect("integrations array");
    for integration in int_list {
        let plugin = integration["plugin"].as_str().unwrap();
        assert_ne!(
            plugin, "mqtt",
            "MQTT integration '{}' should have been converted to dummy",
            integration["id"]
        );
    }
}

#[test]
fn prod_config_scene_activation() {
    let server = start_prod_simulation();

    // All devices should start OFF
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Kitchen lightstrip lower"),
        "Kitchen should start OFF"
    );

    // Activate "normal" scene for downstairs
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "normal",
            "group_keys": ["downstairs"]
        }),
    );

    // Downstairs lights should turn on
    wait_for_device_state(
        &server.base_url,
        "Kitchen lightstrip lower",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "should be ON after normal scene",
    );

    // Now activate "leave" scene for all
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "leave"
        }),
    );

    // All lights should turn off
    wait_for_device_state(
        &server.base_url,
        "Kitchen lightstrip lower",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(false),
        "should be OFF after leave scene",
    );
}

#[test]
fn prod_config_night_scene() {
    let server = start_prod_simulation();

    // First activate normal to turn things on
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "normal"
        }),
    );

    wait_for_device_state(
        &server.base_url,
        "Kitchen lightstrip lower",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "should be ON after normal",
    );

    // Now activate night scene
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "night"
        }),
    );

    // Kitchen (downstairs) should be OFF in night mode
    wait_for_device_state(
        &server.base_url,
        "Kitchen lightstrip lower",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(false),
        "kitchen should be OFF in night mode",
    );

    // Staircase lamp should stay ON (it's in the night scene)
    wait_for_device_state(
        &server.base_url,
        "Staircase lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "staircase lamp should be ON in night mode",
    );
}

#[test]
fn prod_config_arrive_home_routine() {
    let server = start_prod_simulation();

    // Verify downstairs starts OFF
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Living room lamp"),
        "Living room should start OFF"
    );

    // Simulate: Entryway switch "on_press" (triggers arrive_home routine)
    // SensorDevice is #[serde(untagged)], so {"value": "on_press"} maps to Text variant
    set_sensor(
        &server.base_url,
        "Entryway switch",
        json!({ "value": "on_press" }),
    );

    // arrive_home activates "normal" scene for downstairs
    wait_for_device_state(
        &server.base_url,
        "Living room lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "living room should turn ON from arrive_home routine",
    );

    // Upstairs should remain OFF (routine only targets downstairs)
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Bedroom lamp"),
        "Bedroom should remain OFF (arrive_home only targets downstairs)"
    );
}

#[test]
fn prod_config_leave_home_routine() {
    let server = start_prod_simulation();

    // First turn on some lights
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "normal"
        }),
    );

    wait_for_device_state(
        &server.base_url,
        "Living room lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "should be ON after normal",
    );

    // Simulate: Entryway switch "off_press" (triggers leave_home routine)
    set_sensor(
        &server.base_url,
        "Entryway switch",
        json!({ "value": "off_press" }),
    );

    // leave_home activates "leave" scene -> all lights off
    wait_for_device_state(
        &server.base_url,
        "Living room lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(false),
        "living room should turn OFF from leave_home routine",
    );
}

#[test]
fn prod_config_nightlight_cycle() {
    let server = start_prod_simulation();

    // Set up: activate normal for upstairs so CycleScenes has a baseline
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "normal",
            "group_keys": ["upstairs"]
        }),
    );

    wait_for_device_state(
        &server.base_url,
        "Bedroom lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "bedroom should be ON after normal",
    );

    // Simulate: Bedroom switch "off_press" -> activate_nightlight routine
    // This cycles: dark(upstairs) -> night
    set_sensor(
        &server.base_url,
        "Bedroom switch",
        json!({ "value": "off_press" }),
    );

    // Should transition to dark for upstairs (first in cycle, nowrap=true)
    wait_for_device_state(
        &server.base_url,
        "Bedroom lamp",
        |d| {
            let power = d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true);
            let brightness = d["data"]["Controllable"]["state"]["brightness"]
                .as_f64()
                .unwrap_or(1.0);
            // Dark scene should have reduced brightness
            power && brightness < 0.5
        },
        "bedroom should be in dark scene (dimmer) after nightlight cycle",
    );
}

#[test]
fn prod_config_staircase_motion_upstairs() {
    let server = start_prod_simulation();

    // Ensure staircase starts OFF
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Staircase lamp"),
        "Staircase should start OFF"
    );

    // Trigger staircase motion sensor (Boolean sensor with value=true)
    set_sensor(
        &server.base_url,
        "Staircase motion sensor",
        json!({ "value": true }),
    );

    // staircase_upstairs routine:
    //   rules: motion=true, upstairs power=false, kids_room power=false
    //   action: normal scene for upstairs + kids_room_normal
    wait_for_device_state(
        &server.base_url,
        "Staircase lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "staircase should turn ON from motion sensor",
    );

    // Kids room should also turn on (kids_room_normal scene)
    wait_for_device_state(
        &server.base_url,
        "Kids room lamp",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "kids room should turn ON from motion sensor",
    );

    // Downstairs should remain OFF (motion only targets upstairs)
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Kitchen lightstrip lower"),
        "Kitchen should remain OFF (motion only targets upstairs)"
    );
}

#[test]
fn prod_config_group_scoped_activation() {
    let server = start_prod_simulation();

    // Activate bright scene only for kitchen group
    trigger_action(
        &server.base_url,
        &json!({
            "action": "ActivateScene",
            "scene_id": "bright",
            "group_keys": ["kitchen"]
        }),
    );

    wait_for_device_state(
        &server.base_url,
        "Kitchen lightstrip lower",
        |d| d["data"]["Controllable"]["state"]["power"].as_bool() == Some(true),
        "kitchen should be ON",
    );

    // Other groups should remain OFF
    let devices = get(&server.base_url, "/api/v1/devices");
    assert!(
        !device_power(&devices, "Living room lamp"),
        "Living room should remain OFF when only kitchen group activated"
    );
    assert!(
        !device_power(&devices, "Bedroom lamp"),
        "Bedroom should remain OFF when only kitchen group activated"
    );
}
