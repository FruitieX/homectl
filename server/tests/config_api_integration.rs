mod common;

use common::{TestServer, TestServerConfig};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::thread;
use std::time::{Duration, Instant};

fn blank_backup_config() -> Value {
    json!({
        "version": 1,
        "core": { "warmup_time_seconds": 0 },
        "integrations": [],
        "groups": [],
        "scenes": [],
        "routines": [],
        "floorplan": null,
        "floorplans": [],
        "device_positions": [],
        "group_positions": [],
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
    })
}

fn reload_fixture_backup_config() -> Value {
    let mut config = blank_backup_config();
    config["integrations"] = json!([
        {
            "id": "reload_dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {
                    "light1": {
                        "name": "Reload Light"
                    },
                    "sensor1": {
                        "name": "Reload Sensor",
                        "init_state": {
                            "Sensor": {
                                "value": false
                            }
                        }
                    }
                }
            }
        }
    ]);
    config
}

fn rollout_fixture_backup_config() -> Value {
    let mut config = blank_backup_config();
    config["integrations"] = json!([
        {
            "id": "rollout_dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {
                    "light1": {
                        "name": "Rollout Light 1",
                        "init_state": {
                            "Controllable": {
                                "state": {
                                    "power": false
                                }
                            }
                        }
                    },
                    "light2": {
                        "name": "Rollout Light 2",
                        "init_state": {
                            "Controllable": {
                                "state": {
                                    "power": false
                                }
                            }
                        }
                    },
                    "sensor1": {
                        "name": "Rollout Sensor",
                        "init_state": {
                            "Sensor": {
                                "value": false
                            }
                        }
                    }
                }
            }
        }
    ]);
    config["scenes"] = json!([
        {
            "id": "rollout_off",
            "name": "Rollout Off",
            "hidden": false,
            "script": null,
            "device_states": {
                "rollout_dummy/light1": { "power": false },
                "rollout_dummy/light2": { "power": false }
            },
            "group_states": {}
        },
        {
            "id": "rollout_on",
            "name": "Rollout On",
            "hidden": false,
            "script": null,
            "device_states": {
                "rollout_dummy/light1": { "power": true },
                "rollout_dummy/light2": { "power": true }
            },
            "group_states": {}
        }
    ]);
    config
}

fn script_scene_fixture_backup_config() -> Value {
    let mut config = blank_backup_config();
    config["integrations"] = json!([
        {
            "id": "script_dummy",
            "plugin": "dummy",
            "enabled": true,
            "config": {
                "devices": {
                    "light1": {
                        "name": "Script Target",
                        "init_state": {
                            "Controllable": {
                                "state": {
                                    "power": false
                                }
                            }
                        }
                    },
                    "light2": {
                        "name": "Script Driver",
                        "init_state": {
                            "Controllable": {
                                "state": {
                                    "power": false
                                }
                            }
                        }
                    }
                }
            }
        }
    ]);
    config
}

fn start_reload_test_server() -> TestServer {
    TestServer::with_config(TestServerConfig {
        config_content: Some(reload_fixture_backup_config().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start reload test server")
}

fn start_rollout_test_server() -> TestServer {
    TestServer::with_config(TestServerConfig {
        config_content: Some(rollout_fixture_backup_config().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start rollout test server")
}

fn start_script_scene_test_server() -> TestServer {
    TestServer::with_config(TestServerConfig {
        config_content: Some(script_scene_fixture_backup_config().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start scene script test server")
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

fn post_text(base_url: &str, path: &str, body: &str) -> Response {
    Client::new()
        .post(format!("{base_url}{path}"))
        .header("Content-Type", "text/plain")
        .body(body.to_string())
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

fn sample_config_export() -> Value {
    json!({
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
        "group_positions": [],
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
    })
}

#[test]
fn config_export_import_roundtrip_preserves_config() {
    let server = TestServer::new().expect("Failed to start test server");
    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], false);
    assert_eq!(runtime_status["data"]["memory_only_mode"], true);

    let import_payload = sample_config_export();

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
fn config_api_starts_from_json_backup_without_database() {
    let backup_config = sample_config_export();
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(backup_config.to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start no-database test server");

    wait_for("JSON backup integration device to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Light 1").is_some()
    });

    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], false);
    assert_eq!(runtime_status["data"]["memory_only_mode"], true);

    let export_result = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(export_result["success"], true);
    assert_eq!(export_result["data"], backup_config);

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &json!({
            "id": "memory-only",
            "name": "Memory Only"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    let floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(floorplans["success"], true);
    assert!(floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "memory-only" && floorplan["name"] == "Memory Only"
        }));

    let export_after_mutation = get_json(&server.base_url, "/api/v1/config/export");
    assert!(export_after_mutation["data"]["floorplans"]
        .as_array()
        .expect("exported floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "memory-only" && floorplan["name"] == "Memory Only"
        }));
}

#[test]
fn activate_scene_spatial_rollout_updates_near_devices_before_far_devices() {
    let server = start_rollout_test_server();

    wait_for("rollout fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Rollout Light 1").is_some()
            && device_by_name(&devices, "Rollout Light 2").is_some()
            && device_by_name(&devices, "Rollout Sensor").is_some()
    });

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

    wait_for("rollout fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Rollout Light 1").is_some()
            && device_by_name(&devices, "Rollout Light 2").is_some()
            && device_by_name(&devices, "Rollout Sensor").is_some()
    });

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
    let server = start_reload_test_server();

    wait_for("sensor fixture device to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Sensor").is_some()
    });

    let upsert_response = put_json(
        &server.base_url,
        "/api/v1/config/device-sensor-configs/reload_dummy%2Fsensor1",
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
                "device_ref": "reload_dummy/sensor1",
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
        "/api/v1/config/device-sensor-configs/reload_dummy%2Fsensor1",
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
fn migration_preview_reports_validation_errors_without_blocking_import() {
    let server = start_reload_test_server();

    wait_for("seeded reload fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Light").is_some()
            && device_by_name(&devices, "Reload Sensor").is_some()
    });

    let response = post_text(
        &server.base_url,
        "/api/v1/config/migrate/preview",
        r#"
[integrations.reload_dummy]
plugin = "dummy"

[groups.kitchen]
name = "Kitchen"
devices = [
    { integration_id = "reload_dummy", name = "Missing group light" }
]

[scenes.evening]
name = "Evening"

    [scenes.evening.devices.reload_dummy]
    "Missing scene light" = { integration_id = "reload_dummy", name = "Missing linked light", brightness = 0.5 }

[routines.motion]
name = "Motion"
rules = [
    { integration_id = "reload_dummy", name = "Missing routine sensor", state = { value = true }, trigger_mode = "pulse" }
]
"#,
    );

    assert_eq!(response.status(), StatusCode::OK);

    let result: Value = response
        .json()
        .expect("preview response should be valid JSON");

    let warnings = result["data"]["validation_errors"]
        .as_array()
        .expect("preview warnings should be an array");
    let preview = &result["data"]["preview"];

    assert_eq!(result["success"], Value::Bool(true));
    assert_eq!(warnings.len(), 3);
    assert!(warnings.iter().any(|warning| warning
        .as_str()
        .is_some_and(|warning| warning.contains("group 'kitchen' device 'Missing group light'"))));
    assert!(warnings.iter().any(|warning| warning.as_str().is_some_and(|warning| warning.contains("scene 'evening' device 'reload_dummy/Missing scene light': could not resolve device name reload_dummy/Missing linked light"))));
    assert!(warnings.iter().any(|warning| warning.as_str().is_some_and(|warning| warning.contains("routine 'motion' rules[0]: could not resolve device name reload_dummy/Missing routine sensor"))));
    assert_eq!(
        preview["groups"][0]["devices"].as_array().map(Vec::len),
        Some(0)
    );
    assert_eq!(
        preview["scenes"][0]["device_states"]
            .as_object()
            .map(|states| states.len()),
        Some(0)
    );
    assert_eq!(
        preview["routines"][0]["rules"].as_array().map(Vec::len),
        Some(0)
    );
}

#[test]
fn migration_preview_allows_integrations_only_before_device_discovery() {
    let server = start_reload_test_server();

    let response = post_text(
        &server.base_url,
        "/api/v1/config/migrate/preview?core=false&integrations=true&groups=false&scenes=false&routines=false",
        r#"
[integrations.reload_dummy]
plugin = "dummy"

[groups.kitchen]
name = "Kitchen"
devices = [
    { integration_id = "reload_dummy", name = "Missing group light" }
]

[scenes.evening]
name = "Evening"

    [scenes.evening.devices.reload_dummy]
    "Missing scene light" = { integration_id = "reload_dummy", name = "Missing linked light", brightness = 0.5 }

[routines.motion]
name = "Motion"
rules = [
    { integration_id = "reload_dummy", name = "Missing routine sensor", state = { value = true }, trigger_mode = "pulse" }
]
"#,
    );

    assert_eq!(response.status(), StatusCode::OK);

    let result: Value = response
        .json()
        .expect("preview response should be valid JSON");

    assert_eq!(result["success"], Value::Bool(true));
    assert_eq!(
        result["data"]["validation_errors"].as_array().map(Vec::len),
        Some(0)
    );
    assert_eq!(
        result["data"]["preview"]["integrations"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(
        result["data"]["preview"]["groups"].as_array().map(Vec::len),
        Some(0)
    );
    assert_eq!(
        result["data"]["preview"]["scenes"].as_array().map(Vec::len),
        Some(0)
    );
    assert_eq!(
        result["data"]["preview"]["routines"]
            .as_array()
            .map(Vec::len),
        Some(0)
    );
}

#[test]
fn migration_apply_allows_preview_with_warnings_by_dropping_invalid_entries() {
    let server = start_reload_test_server();

    wait_for("seeded reload fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Light").is_some()
            && device_by_name(&devices, "Reload Sensor").is_some()
    });

    let preview_response = post_text(
        &server.base_url,
        "/api/v1/config/migrate/preview",
        r#"
[integrations.reload_dummy]
plugin = "dummy"

[groups.kitchen]
name = "Kitchen"
devices = [
    { integration_id = "reload_dummy", name = "Missing group light" }
]

[scenes.evening]
name = "Evening"

    [scenes.evening.devices.reload_dummy]
    "Missing scene light" = { integration_id = "reload_dummy", name = "Missing linked light", brightness = 0.5 }

[routines.motion]
name = "Motion"
rules = [
    { integration_id = "reload_dummy", name = "Missing routine sensor", state = { value = true }, trigger_mode = "pulse" }
]
"#,
    );

    assert_eq!(preview_response.status(), StatusCode::OK);

    let preview_result: Value = preview_response
        .json()
        .expect("preview response should be valid JSON");

    assert_eq!(
        preview_result["data"]["validation_errors"]
            .as_array()
            .map(Vec::len),
        Some(3)
    );

    let apply_response = post_json(
        &server.base_url,
        "/api/v1/config/migrate/apply",
        &json!({
            "selection": {
                "core": true,
                "integrations": true,
                "groups": true,
                "scenes": true,
                "routines": true
            },
            "preview": preview_result["data"]["preview"].clone()
        }),
    );

    assert_eq!(apply_response.status(), StatusCode::OK);

    let export = get_json(&server.base_url, "/api/v1/config/export");
    let groups = export["data"]["groups"]
        .as_array()
        .expect("export should include groups array");
    let scenes = export["data"]["scenes"]
        .as_array()
        .expect("export should include scenes array");
    let routines = export["data"]["routines"]
        .as_array()
        .expect("export should include routines array");

    let kitchen = groups
        .iter()
        .find(|group| group["id"] == "kitchen")
        .expect("kitchen group should be imported");
    let evening = scenes
        .iter()
        .find(|scene| scene["id"] == "evening")
        .expect("evening scene should be imported");
    let motion = routines
        .iter()
        .find(|routine| routine["id"] == "motion")
        .expect("motion routine should be imported");

    assert_eq!(kitchen["devices"].as_array().map(Vec::len), Some(0));
    assert_eq!(
        evening["device_states"]
            .as_object()
            .map(|states| states.len()),
        Some(0)
    );
    assert_eq!(motion["rules"].as_array().map(Vec::len), Some(0));
}

#[test]
fn migration_apply_preserves_existing_integrations_when_importing_later_sections() {
    let server = start_reload_test_server();

    wait_for("seeded reload fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Reload Light").is_some()
            && device_by_name(&devices, "Reload Sensor").is_some()
    });

    let response = post_json(
        &server.base_url,
        "/api/v1/config/migrate/apply",
        &json!({
            "selection": {
                "core": false,
                "integrations": false,
                "groups": true,
                "scenes": false,
                "routines": false
            },
            "preview": {
                "core": { "warmup_time_seconds": 9 },
                "integrations": [],
                "groups": [
                    {
                        "id": "reload_group",
                        "name": "Reload Group",
                        "hidden": false,
                        "devices": [
                            {
                                "integration_id": "reload_dummy",
                                "device_id": "light1"
                            }
                        ],
                        "linked_groups": []
                    }
                ],
                "scenes": [],
                "routines": []
            }
        }),
    );

    assert_eq!(response.status(), StatusCode::OK);

    let export = get_json(&server.base_url, "/api/v1/config/export");
    let integrations = export["data"]["integrations"]
        .as_array()
        .expect("export should include integrations array");
    let groups = export["data"]["groups"]
        .as_array()
        .expect("export should include groups array");

    assert!(integrations
        .iter()
        .any(|integration| integration["id"] == "reload_dummy"));
    assert!(groups.iter().any(|group| group["id"] == "reload_group"));

    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert!(device_by_name(&devices, "Reload Light").is_some());
}

#[test]
fn config_api_executes_scene_scripts_against_live_device_state() {
    let server = start_script_scene_test_server();

    wait_for("script fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Script Target").is_some()
            && device_by_name(&devices, "Script Driver").is_some()
    });

    let create_scene_response = post_json(
        &server.base_url,
        "/api/v1/config/scenes",
        &json!({
            "id": "scripted_scene",
            "name": "Scripted Scene",
            "hidden": false,
            "script": "defineSceneScript(() => devices['script_dummy/light2']?.data?.Controllable?.state?.power ? { 'script_dummy/light1': deviceState({ power: false }) } : { 'script_dummy/light1': deviceState({ power: true, brightness: 0.6 }) })",
            "device_states": {},
            "group_states": {}
        }),
    );
    assert_eq!(create_scene_response.status(), StatusCode::CREATED);

    let first_activation = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "scripted_scene"
        }),
    );
    assert_eq!(first_activation.status(), StatusCode::OK);

    wait_for("scene script to power on the target light", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Script Target") == Some(true)
    });

    let driver_update = put_json(
        &server.base_url,
        "/api/v1/devices/light2",
        &json!({
            "id": "light2",
            "name": "Script Driver",
            "integration_id": "script_dummy",
            "data": {
                "Controllable": {
                    "state": {
                        "power": true
                    }
                }
            }
        }),
    );
    assert_eq!(driver_update.status(), StatusCode::OK);

    wait_for("driver light to update", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_power(&devices, "Script Driver") == Some(true)
    });

    let second_activation = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "scripted_scene"
        }),
    );
    assert_eq!(second_activation.status(), StatusCode::OK);

    wait_for(
        "scene script to react to the updated driver light state",
        || {
            let devices = get_json(&server.base_url, "/api/v1/devices");
            device_power(&devices, "Script Target") == Some(false)
        },
    );
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
