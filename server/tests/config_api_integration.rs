mod common;

use common::{TestServer, TestServerConfig};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::thread;
use std::time::{Duration, Instant};

const RELOAD_FIXTURE_TOML: &str = r#"
[integrations.reload_dummy]
plugin = "dummy"

[integrations.reload_dummy.devices.light1]
name = "Reload Light"

[integrations.reload_dummy.devices.sensor1]
name = "Reload Sensor"
init_state = { Sensor = { value = false } }
"#;

const ROLLOUT_FIXTURE_TOML: &str = r#"
[integrations.rollout_dummy]
plugin = "dummy"

[integrations.rollout_dummy.devices.light1]
name = "Rollout Light 1"
init_state = { Controllable = { state = { power = false } } }

[integrations.rollout_dummy.devices.light2]
name = "Rollout Light 2"
init_state = { Controllable = { state = { power = false } } }

[integrations.rollout_dummy.devices.sensor1]
name = "Rollout Sensor"
init_state = { Sensor = { value = false } }

[scenes.rollout_off]
name = "Rollout Off"

    [scenes.rollout_off.devices.rollout_dummy]
    "Rollout Light 1" = { power = false }
    "Rollout Light 2" = { power = false }

[scenes.rollout_on]
name = "Rollout On"

    [scenes.rollout_on.devices.rollout_dummy]
    "Rollout Light 1" = { power = true }
    "Rollout Light 2" = { power = true }
"#;

fn start_reload_test_server() -> TestServer {
    TestServer::with_config(TestServerConfig {
        extra_config: Some(RELOAD_FIXTURE_TOML.to_string()),
        ..Default::default()
    })
    .expect("Failed to start reload test server")
}

fn start_rollout_test_server() -> TestServer {
    TestServer::with_config(TestServerConfig {
        extra_config: Some(ROLLOUT_FIXTURE_TOML.to_string()),
        ..Default::default()
    })
    .expect("Failed to start rollout test server")
}

fn get_json(base_url: &str, path: &str) -> Value {
    reqwest::blocking::get(format!("{base_url}{path}"))
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"))
        .json()
        .unwrap_or_else(|e| panic!("GET {path} response parse failed: {e}"))
}

fn get(base_url: &str, path: &str) -> Response {
    reqwest::blocking::get(format!("{base_url}{path}"))
        .unwrap_or_else(|e| panic!("GET {path} failed: {e}"))
}

fn head(base_url: &str, path: &str) -> Response {
    Client::new()
        .head(format!("{base_url}{path}"))
        .send()
        .unwrap_or_else(|e| panic!("HEAD {path} failed: {e}"))
}

fn post_json(base_url: &str, path: &str, body: &Value) -> Response {
    Client::new()
        .post(format!("{base_url}{path}"))
        .json(body)
        .send()
        .unwrap_or_else(|e| panic!("POST {path} failed: {e}"))
}

fn put_json(base_url: &str, path: &str, body: &Value) -> Response {
    Client::new()
        .put(format!("{base_url}{path}"))
        .json(body)
        .send()
        .unwrap_or_else(|e| panic!("PUT {path} failed: {e}"))
}

fn delete(base_url: &str, path: &str) -> Response {
    Client::new()
        .delete(format!("{base_url}{path}"))
        .send()
        .unwrap_or_else(|e| panic!("DELETE {path} failed: {e}"))
}

fn device_by_name<'a>(devices: &'a Value, name: &str) -> Option<&'a Value> {
    devices["devices"].as_array().and_then(|devices| {
        devices
            .iter()
            .find(|device| device["name"].as_str() == Some(name))
    })
}

fn device_power(devices: &Value, name: &str) -> Option<bool> {
    device_by_name(devices, name)
        .and_then(|device| device["data"]["Controllable"]["state"]["power"].as_bool())
}

fn wait_for(description: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);

    loop {
        if condition() {
            return;
        }

        if Instant::now() >= deadline {
            panic!("Timed out waiting for {description}");
        }

        thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn config_export_import_roundtrip_preserves_config() {
    let server = TestServer::new().expect("Failed to start test server");

    let import_payload = json!({
        "version": 1,
        "core": {
            "warmup_time_seconds": 7
        },
        "integrations": [
            {
                "id": "dummy",
                "plugin": "dummy",
                "enabled": true,
                "config": {
                    "devices": {
                        "light1": {
                            "name": "Light 1"
                        },
                        "sensor1": {
                            "name": "Sensor 1",
                            "init_state": {
                                "Sensor": {
                                    "value": false
                                }
                            }
                        }
                    }
                }
            }
        ],
        "groups": [
            {
                "id": "main",
                "name": "Main",
                "hidden": false,
                "devices": [
                    {
                        "integration_id": "dummy",
                        "device_name": "Light 1",
                        "device_id": "light1"
                    }
                ],
                "linked_groups": []
            }
        ],
        "scenes": [
            {
                "id": "main_on",
                "name": "Main On",
                "hidden": false,
                "script": null,
                "device_states": {
                    "dummy/light1": {
                        "power": true
                    }
                },
                "group_states": {}
            }
        ],
        "routines": [
            {
                "id": "sensor_main_on",
                "name": "Sensor Main On",
                "enabled": true,
                "rules": [
                    {
                        "integration_id": "dummy",
                        "device_id": "sensor1",
                        "state": {
                            "value": true
                        },
                        "trigger_mode": "pulse"
                    }
                ],
                "actions": [
                    {
                        "action": "ActivateScene",
                        "scene_id": "main_on",
                        "rollout": "spatial",
                        "rollout_source_device_key": "dummy/sensor1",
                        "rollout_duration_ms": 900
                    }
                ]
            }
        ],
        "floorplan": {
            "image_data": null,
            "image_mime_type": null,
            "width": null,
            "height": null
        },
        "floorplans": [
            {
                "id": "default",
                "name": "Main floorplan",
                "image_data": null,
                "image_mime_type": null,
                "width": null,
                "height": null,
                "grid_data": null
            },
            {
                "id": "upstairs",
                "name": "Upstairs",
                "image_data": null,
                "image_mime_type": null,
                "width": null,
                "height": null,
                "grid_data": "{\"width\":10,\"height\":6,\"tileSize\":24,\"tiles\":[[\"floor\"]],\"devices\":[],\"groups\":{}}"
            }
        ],
        "device_positions": [
            {
                "device_key": "dummy/light1",
                "x": 12.5,
                "y": 8.0,
                "scale": 1.25,
                "rotation": 0.5
            }
        ],
        "device_display_overrides": [],
        "device_sensor_configs": [],
        "dashboard_layouts": [
            {
                "id": 1,
                "name": "Default",
                "is_default": true
            }
        ],
        "dashboard_widgets": []
    });

    let response = post_json(&server.base_url, "/api/v1/config/import", &import_payload);
    assert_eq!(response.status(), StatusCode::OK);

    let import_result: Value = response
        .json()
        .expect("Import response should be valid JSON");
    assert_eq!(import_result["success"], true);

    let export_result = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(export_result["success"], true);
    assert_eq!(export_result["data"], import_payload);
}

#[test]
fn activate_scene_spatial_rollout_updates_near_devices_before_far_devices() {
    let server = start_rollout_test_server();

    for (device_key, x) in [
        ("rollout_dummy/sensor1", 0.0),
        ("rollout_dummy/light1", 1.0),
        ("rollout_dummy/light2", 3.0),
    ] {
        let response = put_json(
            &server.base_url,
            &format!(
                "/api/v1/config/floorplan/devices/{}",
                device_key.replace('/', "%2F")
            ),
            &json!({
                "device_key": device_key,
                "x": x,
                "y": 0.0,
                "scale": 1.0,
                "rotation": 0.0
            }),
        );
        assert_eq!(response.status(), StatusCode::OK);
    }

    let trigger_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "rollout_on",
            "rollout": "spatial",
            "rollout_source_device_key": "rollout_dummy/sensor1",
            "rollout_duration_ms": 900
        }),
    );
    assert_eq!(trigger_response.status(), StatusCode::OK);

    thread::sleep(Duration::from_millis(100));
    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert_eq!(device_power(&devices, "Rollout Light 1"), Some(false));
    assert_eq!(device_power(&devices, "Rollout Light 2"), Some(false));

    wait_for("near rollout target to update first", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Rollout Light 1") == Some(true)
            && device_power(&devices, "Rollout Light 2") == Some(false)
    });

    wait_for("far rollout target to update after the near target", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Rollout Light 1") == Some(true)
            && device_power(&devices, "Rollout Light 2") == Some(true)
    });
}

#[test]
fn cycle_scenes_spatial_rollout_reuses_rollout_behavior() {
    let server = start_rollout_test_server();

    for (device_key, x) in [
        ("rollout_dummy/sensor1", 0.0),
        ("rollout_dummy/light1", 1.0),
        ("rollout_dummy/light2", 3.0),
    ] {
        let response = put_json(
            &server.base_url,
            &format!(
                "/api/v1/config/floorplan/devices/{}",
                device_key.replace('/', "%2F")
            ),
            &json!({
                "device_key": device_key,
                "x": x,
                "y": 0.0,
                "scale": 1.0,
                "rotation": 0.0
            }),
        );
        assert_eq!(response.status(), StatusCode::OK);
    }

    let off_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "rollout_off"
        }),
    );
    assert_eq!(off_response.status(), StatusCode::OK);

    wait_for("rollout fixture lights to be off", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Rollout Light 1") == Some(false)
            && device_power(&devices, "Rollout Light 2") == Some(false)
    });

    let cycle_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "CycleScenes",
            "scenes": [
                { "scene_id": "rollout_off" },
                { "scene_id": "rollout_on" }
            ],
            "rollout": "spatial",
            "rollout_source_device_key": "rollout_dummy/sensor1",
            "rollout_duration_ms": 900
        }),
    );
    assert_eq!(cycle_response.status(), StatusCode::OK);

    thread::sleep(Duration::from_millis(100));
    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert_eq!(device_power(&devices, "Rollout Light 1"), Some(false));
    assert_eq!(device_power(&devices, "Rollout Light 2"), Some(false));

    wait_for("cycle scenes near rollout target to update first", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Rollout Light 1") == Some(true)
            && device_power(&devices, "Rollout Light 2") == Some(false)
    });

    wait_for("cycle scenes far rollout target to update last", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Rollout Light 1") == Some(true)
            && device_power(&devices, "Rollout Light 2") == Some(true)
    });
}

#[test]
fn config_api_device_display_name_overrides_roundtrip() {
    let server = TestServer::new().expect("Failed to start test server");

    let upsert_response = put_json(
        &server.base_url,
        "/api/v1/config/device-display-names/dummy%2Flight1",
        &json!({
            "device_key": "ignored/by/route",
            "display_name": "Kitchen ceiling"
        }),
    );
    assert_eq!(upsert_response.status(), StatusCode::OK);

    let list_result = get_json(&server.base_url, "/api/v1/config/device-display-names");
    assert_eq!(list_result["success"], true);
    assert_eq!(
        list_result["data"],
        json!([
            {
                "device_key": "dummy/light1",
                "display_name": "Kitchen ceiling"
            }
        ]),
    );

    let delete_response = delete(
        &server.base_url,
        "/api/v1/config/device-display-names/dummy%2Flight1",
    );
    assert_eq!(delete_response.status(), StatusCode::OK);

    let final_list = get_json(&server.base_url, "/api/v1/config/device-display-names");
    assert_eq!(final_list["success"], true);
    assert_eq!(final_list["data"], json!([]));
}

#[test]
fn config_api_device_sensor_configs_roundtrip() {
    let server = TestServer::new().expect("Failed to start test server");

    let upsert_response = put_json(
        &server.base_url,
        "/api/v1/config/device-sensor-configs/zigbee2mqtt%2FEntryway%20switch",
        &json!({
            "device_ref": "ignored/by/route",
            "interaction_kind": "hue_dimmer",
            "config": {
                "on_value": "on_press",
                "up_value": "up_press",
                "down_value": "down_press",
                "off_value": "off_press"
            }
        }),
    );
    assert_eq!(upsert_response.status(), StatusCode::OK);

    let list_result = get_json(&server.base_url, "/api/v1/config/device-sensor-configs");
    assert_eq!(list_result["success"], true);
    assert_eq!(
        list_result["data"],
        json!([
            {
                "device_ref": "zigbee2mqtt/Entryway switch",
                "interaction_kind": "hue_dimmer",
                "config": {
                    "on_value": "on_press",
                    "up_value": "up_press",
                    "down_value": "down_press",
                    "off_value": "off_press"
                }
            }
        ]),
    );

    let delete_response = delete(
        &server.base_url,
        "/api/v1/config/device-sensor-configs/zigbee2mqtt%2FEntryway%20switch",
    );
    assert_eq!(delete_response.status(), StatusCode::OK);

    let final_list = get_json(&server.base_url, "/api/v1/config/device-sensor-configs");
    assert_eq!(final_list["success"], true);
    assert_eq!(final_list["data"], json!([]));
}

#[test]
fn config_api_logs_returns_buffered_server_logs() {
    let server = TestServer::new().expect("Failed to start test server");

    let result = get_json(&server.base_url, "/api/v1/config/logs");
    assert_eq!(result["success"], true);

    let entries = result["data"]
        .as_array()
        .expect("Logs endpoint should return an array");
    assert!(
        entries.iter().any(|entry| {
            entry["message"]
                .as_str()
                .map(|message| message.contains("Starting API server on port"))
                .unwrap_or(false)
        }),
        "Expected startup log entry to be present in buffered logs",
    );
}

#[test]
fn config_api_multiple_floorplans_store_independent_grids() {
    let server = TestServer::new().expect("Failed to start test server");

    let initial_floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(initial_floorplans["success"], true);
    assert!(initial_floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| floorplan["id"] == "default"));

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &json!({
            "id": "upstairs",
            "name": "Upstairs"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    let save_default_grid = post_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid",
        &json!({
            "grid": "{\"label\":\"default-grid\"}"
        }),
    );
    assert_eq!(save_default_grid.status(), StatusCode::OK);

    let save_upstairs_grid = post_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid?id=upstairs",
        &json!({
            "grid": "{\"label\":\"upstairs-grid\"}"
        }),
    );
    assert_eq!(save_upstairs_grid.status(), StatusCode::OK);

    let default_grid = get_json(&server.base_url, "/api/v1/config/floorplan/grid");
    assert_eq!(default_grid["success"], true);
    assert_eq!(default_grid["data"], json!("{\"label\":\"default-grid\"}"));

    let upstairs_grid = get_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid?id=upstairs",
    );
    assert_eq!(upstairs_grid["success"], true);
    assert_eq!(
        upstairs_grid["data"],
        json!("{\"label\":\"upstairs-grid\"}")
    );

    let rename_response = put_json(
        &server.base_url,
        "/api/v1/config/floorplans/upstairs",
        &json!({
            "id": "ignored",
            "name": "Upper Floor"
        }),
    );
    assert_eq!(rename_response.status(), StatusCode::OK);

    let updated_floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(updated_floorplans["success"], true);
    assert!(updated_floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| { floorplan["id"] == "upstairs" && floorplan["name"] == "Upper Floor" }));

    let delete_response = delete(&server.base_url, "/api/v1/config/floorplans/upstairs");
    assert_eq!(delete_response.status(), StatusCode::OK);

    let deleted_grid = get_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid?id=upstairs",
    );
    assert_eq!(deleted_grid["success"], true);
    assert_eq!(deleted_grid["data"], Value::Null);
}

#[test]
fn config_api_delete_floorplan_image_preserves_grid() {
    let server = TestServer::new().expect("Failed to start test server");

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &json!({
            "id": "upstairs",
            "name": "Upstairs"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    let save_grid = post_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid?id=upstairs",
        &json!({
            "grid": "{\"label\":\"upstairs-grid\"}"
        }),
    );
    assert_eq!(save_grid.status(), StatusCode::OK);

    let upload_response = Client::new()
        .post(format!(
            "{}/api/v1/config/floorplan?id=upstairs",
            server.base_url
        ))
        .header("Content-Type", "image/png")
        .body(vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
        .send()
        .expect("POST floorplan image failed");
    assert_eq!(upload_response.status(), StatusCode::OK);

    let existing_image = get(
        &server.base_url,
        "/api/v1/config/floorplan/image?id=upstairs",
    );
    assert_eq!(existing_image.status(), StatusCode::OK);
    assert_eq!(
        existing_image
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("image/png"),
    );

    let existing_image_head = head(
        &server.base_url,
        "/api/v1/config/floorplan/image?id=upstairs",
    );
    assert_eq!(existing_image_head.status(), StatusCode::OK);
    assert_eq!(
        existing_image_head
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("image/png"),
    );

    let delete_response = delete(
        &server.base_url,
        "/api/v1/config/floorplan/image?id=upstairs",
    );
    assert_eq!(delete_response.status(), StatusCode::OK);

    let deleted_image = get(
        &server.base_url,
        "/api/v1/config/floorplan/image?id=upstairs",
    );
    assert_eq!(deleted_image.status(), StatusCode::NOT_FOUND);

    let deleted_image_head = head(
        &server.base_url,
        "/api/v1/config/floorplan/image?id=upstairs",
    );
    assert_eq!(deleted_image_head.status(), StatusCode::NOT_FOUND);

    let upstairs_grid = get_json(
        &server.base_url,
        "/api/v1/config/floorplan/grid?id=upstairs",
    );
    assert_eq!(upstairs_grid["success"], true);
    assert_eq!(
        upstairs_grid["data"],
        json!("{\"label\":\"upstairs-grid\"}")
    );
}

#[test]
fn config_api_hot_reloads_integrations_without_restart() {
    let server = TestServer::new().expect("Failed to start test server");

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/integrations",
        &json!({
            "id": "api_reload_dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {
                    "light1": {
                        "name": "API Reload Light"
                    }
                }
            }
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    wait_for("hot-reloaded integration device to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "API Reload Light").is_some()
    });

    let delete_response = delete(
        &server.base_url,
        "/api/v1/config/integrations/api_reload_dummy",
    );
    assert_eq!(delete_response.status(), StatusCode::OK);

    wait_for("hot-reloaded integration device to disappear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "API Reload Light").is_none()
    });
}

#[test]
fn config_api_hot_reloads_groups_and_scenes_for_runtime_actions() {
    let server = start_reload_test_server();

    wait_for("seeded reload fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Light").is_some()
    });

    let initial_devices = get_json(&server.base_url, "/api/v1/devices");
    assert_eq!(device_power(&initial_devices, "Reload Light"), Some(false));

    let create_group_response = post_json(
        &server.base_url,
        "/api/v1/config/groups",
        &json!({
            "id": "reading_nook",
            "name": "Reading Nook",
            "hidden": false,
            "devices": [
                {
                    "integration_id": "reload_dummy",
                    "device_name": "Reload Light",
                    "device_id": "light1"
                }
            ],
            "linked_groups": []
        }),
    );
    assert_eq!(create_group_response.status(), StatusCode::CREATED);

    let create_scene_response = post_json(
        &server.base_url,
        "/api/v1/config/scenes",
        &json!({
            "id": "reading_on",
            "name": "Reading On",
            "hidden": false,
            "script": null,
            "device_states": {},
            "group_states": {
                "reading_nook": {
                    "power": true
                }
            }
        }),
    );
    assert_eq!(create_scene_response.status(), StatusCode::CREATED);

    let trigger_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "reading_on"
        }),
    );
    assert_eq!(trigger_response.status(), StatusCode::OK);

    wait_for("group-backed scene activation to update live state", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Reload Light") == Some(true)
    });
}

#[test]
fn config_api_hot_reloads_routines_for_sensor_triggers() {
    let server = start_reload_test_server();

    wait_for("seeded reload fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Light").is_some()
            && device_by_name(&devices, "Reload Sensor").is_some()
    });

    let create_scene_response = post_json(
        &server.base_url,
        "/api/v1/config/scenes",
        &json!({
            "id": "sensor_scene",
            "name": "Sensor Scene",
            "hidden": false,
            "script": null,
            "device_states": {
                "reload_dummy/light1": {
                    "power": true
                }
            },
            "group_states": {}
        }),
    );
    assert_eq!(create_scene_response.status(), StatusCode::CREATED);

    let create_routine_response = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "sensor_turns_light_on",
            "name": "Sensor Turns Light On",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "reload_dummy",
                    "device_id": "sensor1",
                    "state": {
                        "value": true
                    },
                    "trigger_mode": "pulse"
                }
            ],
            "actions": [
                {
                    "action": "ActivateScene",
                    "scene_id": "sensor_scene"
                }
            ]
        }),
    );
    assert_eq!(create_routine_response.status(), StatusCode::CREATED);

    let sensor_update_response = put_json(
        &server.base_url,
        "/api/v1/devices/sensor1",
        &json!({
            "id": "sensor1",
            "name": "Reload Sensor",
            "integration_id": "reload_dummy",
            "data": {
                "Sensor": {
                    "value": true
                }
            }
        }),
    );
    assert_eq!(sensor_update_response.status(), StatusCode::OK);

    wait_for("hot-reloaded routine to react to sensor updates", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Reload Light") == Some(true)
    });
}
