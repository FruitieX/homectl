mod common;

use common::{TestServer, TestServerConfig};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn blank_backup_config() -> Value {
    json!({
        "version": 1,
        "core": { "warmup_time_seconds": 0 },
        "integrations": [],
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
        "dashboard_layouts": [
            {
                "id": 1,
                "name": "Default",
                "is_default": true
            }
        ],
        "dashboard_widgets": [],
        "widget_settings": []
    })
}

#[test]
fn color_calibration_crud_validation_and_export_import() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let url = format!(
        "{}/api/v1/config/device-color-calibrations/mqtt%2Flamp",
        server.base_url
    );
    let row = json!({"device_key":"ignored", "points":[
        {"reference":{"u":0.20,"v":0.47},"output":{"u":0.21,"v":0.48}},
        {"reference":{"u":0.30,"v":0.52},"output":{"u":0.29,"v":0.51}}
    ]});
    let saved: Value = client
        .put(&url)
        .json(&row)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(saved["data"]["device_key"], "mqtt/lamp");
    let export_url = format!("{}/api/v1/config/export", server.base_url);
    let exported: Value = client.get(&export_url).send().unwrap().json().unwrap();
    assert_eq!(
        exported["data"]["device_color_calibrations"][0],
        saved["data"]
    );
    let mut invalid = row.clone();
    invalid["points"][0]["output"]["u"] = json!(-0.1);
    assert_eq!(
        client.put(&url).json(&invalid).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );
    client
        .delete(&url)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let list_url = format!(
        "{}/api/v1/config/device-color-calibrations",
        server.base_url
    );
    let cleared: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(cleared["data"], json!([]));
    client
        .post(format!("{}/api/v1/config/import", server.base_url))
        .json(&exported["data"])
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let restored: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(
        restored["data"],
        exported["data"]["device_color_calibrations"]
    );
    let mut invalid_import = exported["data"].clone();
    invalid_import["device_color_calibrations"][0]["points"][0]["output"]["u"] = json!(-0.1);
    assert_eq!(
        client
            .post(format!("{}/api/v1/config/import", server.base_url))
            .json(&invalid_import)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let after: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(after["data"], restored["data"]);
}

#[test]
fn source_crud_validation_and_export_import() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let url = format!("{}/api/v1/config/sources/circadian", server.base_url);
    let source = json!({
        "id": "circadian",
        "name": "Circadian",
        "enabled": true,
        "revision": 0,
        "timezone": "Europe/Helsinki",
        "refresh_interval_ms": 60000,
        "aliases": ["circadian/color"],
        "compute": {
            "kind": "circadian_compat",
            "preset_version": 1,
            "params": {
                "day_fade_start": "06:00",
                "day_fade_duration_hours": 2,
                "day_color": {"ct": 3000},
                "day_brightness": 0.8,
                "night_fade_start": "20:00",
                "night_fade_duration_hours": 2,
                "night_color": {"ct": 2000},
                "night_brightness": 0.2
            }
        }
    });

    let saved: Value = client
        .put(&url)
        .json(&source)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(saved["data"]["id"], "circadian");
    assert_eq!(saved["data"]["revision"], 1);

    let saved_again: Value = client
        .put(&url)
        .json(&source)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(saved_again["data"]["revision"], 2);

    let list_url = format!("{}/api/v1/config/sources", server.base_url);
    let listed: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(listed["data"].as_array().unwrap().len(), 1);
    assert_eq!(listed["data"][0]["revision"], 2);

    let mut unsupported_preset = source.clone();
    unsupported_preset["compute"]["preset_version"] = json!(99);
    assert_eq!(
        client
            .put(&url)
            .json(&unsupported_preset)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );

    let mut overlapping = source.clone();
    overlapping["compute"]["params"]["day_fade_duration_hours"] = json!(16);
    assert_eq!(
        client.put(&url).json(&overlapping).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let mut unknown_zone = source.clone();
    unknown_zone["timezone"] = json!("Mars/Olympus");
    assert_eq!(
        client
            .put(&url)
            .json(&unknown_zone)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );

    let mut mismatched_id = source.clone();
    mismatched_id["id"] = json!("other");
    assert_eq!(
        client
            .put(&url)
            .json(&mismatched_id)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );

    let export_url = format!("{}/api/v1/config/export", server.base_url);
    let exported: Value = client.get(&export_url).send().unwrap().json().unwrap();
    assert_eq!(exported["data"]["sources"][0]["id"], "circadian");
    assert_eq!(exported["data"]["sources"][0]["revision"], 2);

    client
        .delete(&url)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let cleared: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(cleared["data"], json!([]));

    client
        .post(format!("{}/api/v1/config/import", server.base_url))
        .json(&exported["data"])
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let restored: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(restored["data"][0]["id"], "circadian");
    assert_eq!(restored["data"][0]["revision"], 2);
}

/// P12: the stateless source preview samples one local day through the
/// runtime evaluation path, reports validation errors like saving, and
/// persists nothing.
#[test]
fn source_preview_is_stateless_and_validates_the_draft() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let url = format!("{}/api/v1/config/source-preview", server.base_url);
    let request = json!({
        "timezone": "Europe/Helsinki",
        "compute": {
            "kind": "circadian_compat",
            "preset_version": 1,
            "params": {
                "day_fade_start": "06:00",
                "day_fade_duration_hours": 2,
                "day_color": {"ct": 3000},
                "day_brightness": 0.8,
                "night_fade_start": "20:00",
                "night_fade_duration_hours": 2,
                "night_color": {"ct": 2000},
                "night_brightness": 0.2
            }
        },
        "samples": 24
    });

    let preview: Value = client
        .post(&url)
        .json(&request)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    let samples = preview["data"]["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 24);
    assert_eq!(preview["data"]["timezone"], "Europe/Helsinki");
    assert_eq!(preview["data"]["step_ms"], 3_600_000);
    assert_eq!(samples[0]["local_time"], "00:00");
    assert_eq!(samples[0]["profile"]["brightness"], 0.2);
    assert_eq!(samples[12]["local_time"], "12:00");
    assert_eq!(samples[12]["profile"]["brightness"], 0.8);

    let list_url = format!("{}/api/v1/config/sources", server.base_url);
    let listed: Value = client.get(&list_url).send().unwrap().json().unwrap();
    assert_eq!(listed["data"], json!([]));

    let mut unknown_zone = request.clone();
    unknown_zone["timezone"] = json!("Mars/Olympus");
    assert_eq!(
        client
            .post(&url)
            .json(&unknown_zone)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );

    let mut too_few = request.clone();
    too_few["samples"] = json!(4);
    assert_eq!(
        client.post(&url).json(&too_few).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let script = json!({
        "timezone": "Europe/Helsinki",
        "compute": {
            "kind": "script",
            "source_body": "return { brightness: 0.5 };",
            "params": null
        }
    });
    let preview: Value = client
        .post(&url)
        .json(&script)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert!(preview["data"]["unsupported_reason"].is_string());
    assert_eq!(preview["data"]["samples"], json!([]));
}

fn find_device(
    server: &TestServer,
    client: &Client,
    integration_id: &str,
    device_id: &str,
) -> Option<Value> {
    let response: Value = client
        .get(format!("{}/api/v1/devices", server.base_url))
        .send()
        .unwrap()
        .json()
        .unwrap();
    response["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|device| device["integration_id"] == integration_id && device["id"] == device_id)
        .cloned()
}

/// P11: a computed source publishes exactly one read-only synthetic sensor
/// under `computed/<id>`; the legacy alias is not a second entity, and
/// deleting the source removes the device.
#[test]
fn source_refresh_publishes_read_only_synthetic_device() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let url = format!("{}/api/v1/config/sources/circadian", server.base_url);
    let source = json!({
        "id": "circadian",
        "name": "Circadian",
        "enabled": false,
        "revision": 0,
        "timezone": "Europe/Helsinki",
        "refresh_interval_ms": 60000,
        "aliases": ["circadian/color"],
        "compute": {
            "kind": "circadian_compat",
            "preset_version": 1,
            "params": {
                "day_fade_start": "06:00",
                "day_fade_duration_hours": 2,
                "day_color": {"ct": 3000},
                "day_brightness": 0.8,
                "night_fade_start": "20:00",
                "night_fade_duration_hours": 2,
                "night_color": {"ct": 2000},
                "night_brightness": 0.2
            }
        }
    });

    // Disabled sources never compute and never publish.
    client
        .put(&url)
        .json(&source)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(find_device(&server, &client, "computed", "circadian").is_none());

    // Enabling computes immediately (a new revision is always due).
    let mut enabled = source.clone();
    enabled["enabled"] = json!(true);
    client
        .put(&url)
        .json(&enabled)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();

    let device = find_device(&server, &client, "computed", "circadian").expect("published");
    assert_eq!(device["name"], "Circadian");
    assert!(device["data"]["Sensor"]["power"].as_bool().unwrap());
    assert!(device["data"]["Sensor"]["brightness"].is_number());
    assert!(
        find_device(&server, &client, "circadian", "color").is_none(),
        "the alias must not appear as a duplicate entity"
    );

    // D08: integration reloads never remove computed owners.
    let integrations_url = format!("{}/api/v1/config/integrations", server.base_url);
    client
        .post(&integrations_url)
        .json(&json!({
            "id": "dummy",
            "plugin": "dummy",
            "config": { "devices": {} },
            "enabled": true
        }))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(find_device(&server, &client, "computed", "circadian").is_some());
    client
        .delete(format!(
            "{}/api/v1/config/integrations/dummy",
            server.base_url
        ))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(find_device(&server, &client, "computed", "circadian").is_some());

    // Deleting the source removes the synthetic device.
    client
        .delete(&url)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(find_device(&server, &client, "computed", "circadian").is_none());
}

fn wait_for_device(
    server: &TestServer,
    client: &Client,
    integration_id: &str,
    device_id: &str,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(device) = find_device(server, client, integration_id, device_id) {
            return device;
        }
        assert!(
            Instant::now() < deadline,
            "device {integration_id}/{device_id} never appeared"
        );
        thread::sleep(Duration::from_millis(100));
    }
}

/// P11/D10: shipped presets are listed with their forkable body, script
/// definitions pin a preset version or carry an inline body (never both), and
/// a fork is a normal DB-backed definition.
#[test]
fn script_source_validation_pins_presets_and_accepts_forks() {
    let server = TestServer::new().unwrap();
    let client = Client::new();

    let presets_url = format!("{}/api/v1/config/source-presets", server.base_url);
    let presets: Value = client.get(&presets_url).send().unwrap().json().unwrap();
    let circadian = presets["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|preset| preset["id"] == "circadian" && preset["version"] == 1)
        .expect("the circadian preset is listed")
        .clone();
    let preset_body = circadian["source_body"].as_str().unwrap().to_string();
    assert!(preset_body.contains("api.color.mix"));
    assert!(circadian["default_params"]["day_fade_start"].is_string());

    let url = format!("{}/api/v1/config/sources/scripted", server.base_url);
    let params = circadian["default_params"].clone();
    let scripted = |compute: Value| {
        json!({
            "id": "scripted",
            "name": "Scripted",
            "enabled": false,
            "revision": 0,
            "timezone": "UTC",
            "refresh_interval_ms": 60000,
            "aliases": [],
            "compute": compute
        })
    };

    let pinned = scripted(json!({
        "kind": "script",
        "preset": { "id": "circadian", "version": 1 },
        "params": params
    }));
    let saved: Value = client
        .put(&url)
        .json(&pinned)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(saved["data"]["revision"], 1);

    let unknown = scripted(json!({
        "kind": "script",
        "preset": { "id": "circadian", "version": 99 },
        "params": params
    }));
    assert_eq!(
        client.put(&url).json(&unknown).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let both = scripted(json!({
        "kind": "script",
        "preset": { "id": "circadian", "version": 1 },
        "source_body": "return { value: {} };",
        "params": params
    }));
    assert_eq!(
        client.put(&url).json(&both).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let neither = scripted(json!({ "kind": "script", "params": params }));
    assert_eq!(
        client.put(&url).json(&neither).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let mut mixed = pinned.clone();
    mixed["compute"]["params"]["night_color"] = json!({ "h": 200, "s": 0.5 });
    assert_eq!(
        client.put(&url).json(&mixed).send().unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    // A fork copies the shipped body into a DB-backed definition and drops
    // the pin; the shipped asset is never mutated.
    let fork = scripted(json!({
        "kind": "script",
        "source_body": preset_body,
        "params": params
    }));
    let saved: Value = client
        .put(&url)
        .json(&fork)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(saved["data"]["revision"], 2);
    assert!(saved["data"]["compute"]["preset"].is_null());

    let presets_after: Value = client.get(&presets_url).send().unwrap().json().unwrap();
    assert_eq!(presets_after["data"], presets["data"]);
}

/// P11: a scripted source computes through the supervised worker and
/// publishes the same read-only synthetic device; a broken body reports stale
/// without inventing an output.
#[test]
fn script_source_publishes_after_worker_computation() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let url = format!("{}/api/v1/config/sources/scripted", server.base_url);

    let source = json!({
        "id": "scripted",
        "name": "Scripted",
        "enabled": true,
        "revision": 0,
        "timezone": "UTC",
        "refresh_interval_ms": 1000,
        "aliases": [],
        "compute": {
            "kind": "script",
            "source_body": "return { value: { color: api.color.kelvin(2700), brightness: 0.4, transition_ms: 60000 } };",
            "params": {}
        }
    });
    client
        .put(&url)
        .json(&source)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();

    let device = wait_for_device(&server, &client, "computed", "scripted");
    assert!(device["data"]["Sensor"]["power"].as_bool().unwrap());
    assert_eq!(device["data"]["Sensor"]["color"]["ct"], 2700);
    assert_eq!(device["data"]["Sensor"]["brightness"], 0.4);

    // A broken body keeps the last good value as stale and publishes nothing
    // new; the server stays healthy.
    let mut broken = source.clone();
    broken["compute"]["source_body"] = json!("throw new Error('boom');");
    client
        .put(&url)
        .json(&broken)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    thread::sleep(Duration::from_secs(3));
    let still = find_device(&server, &client, "computed", "scripted").expect("last good stays");
    assert_eq!(still["data"]["Sensor"]["color"]["ct"], 2700);
    let health: Response = client
        .get(format!("{}/health/ready", server.base_url))
        .send()
        .unwrap();
    assert!(health.status().is_success());
}

#[test]
fn calibration_profiles_assign_atomically_and_previews_preserve_runtime() {
    let mut config = blank_backup_config();
    let light = json!({"Controllable": {
        "scene_id":null, "state_source":null,
        "capabilities":{"hs":true,"brightness":true},
        "state":{"power":false,"brightness":0.5,"color":{"h":90,"s":0.3},"transition":null},
        "managed":"Full"
    }});
    config["integrations"] = json!([{"id":"dummy","plugin":"dummy","enabled":true,"config":{"devices":{
        "target":{"name":"Target","init_state":light},
        "reference":{"name":"Reference","init_state":light},
        "other":{"name":"Other","init_state":light}
    }}}]);
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(config.to_string()),
        ..Default::default()
    })
    .unwrap();
    let base = &server.base_url;
    let client = Client::new();
    wait_for("calibration lights", || {
        device_by_name(&get_json(base, "/api/v1/devices"), "Target").is_some()
    });
    let profile = json!({"id":"matching-model","name":"Matching model","reference_device_key":"dummy/reference","brightness":0.5,"brightness_points":[],"points":[
        {"reference":{"u":0.20,"v":0.47},"output":{"u":0.21,"v":0.48}}
    ]});
    client
        .post(format!("{base}/api/v1/config/calibration-profiles"))
        .json(&profile)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let mut edited_profile = profile.clone();
    edited_profile["name"] = json!("Edited matching model");
    edited_profile["points"][0]["output"] = json!({"u":0.22,"v":0.49});
    client
        .put(format!(
            "{base}/api/v1/config/calibration-profiles/{}",
            profile["id"].as_str().unwrap()
        ))
        .json(&edited_profile)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(
        get_json(base, "/api/v1/config/calibration-profiles")["data"],
        json!([edited_profile])
    );
    let assignment_url = format!("{base}/api/v1/config/calibration-assignments");
    client
        .put(&assignment_url)
        .json(&json!({"device_keys":["dummy/target","dummy/other"],"profile_id":"matching-model"}))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let assigned = get_json(base, "/api/v1/config/calibration-assignments");
    assert_eq!(assigned["data"].as_array().unwrap().len(), 2);
    assert_eq!(
        client
            .put(&assignment_url)
            .json(&json!({"device_keys":["dummy/target","dummy/missing"],"profile_id":null}))
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get_json(base, "/api/v1/config/calibration-assignments")["data"],
        assigned["data"]
    );
    let effective = get_json(base, "/api/v1/config/device-color-calibrations");
    assert!(effective["data"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["points"] == edited_profile["points"]));
    let before = get_json(base, "/api/v1/devices");
    let session_url = format!("{base}/api/v1/config/calibration-sessions/test-session");
    let preview = json!({"target_key":"dummy/target","reference_key":"dummy/reference","reference":{"h":30,"s":0.25},"output":{"h":47,"s":0.4},"brightness":0.5});
    client
        .post(&session_url)
        .json(&preview)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    client
        .put(&session_url)
        .json(&preview)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let during = get_json(base, "/api/v1/devices");
    for name in ["Target", "Reference"] {
        assert_eq!(
            device_by_name(&before, name).unwrap()["data"]["Controllable"]["state"],
            device_by_name(&during, name).unwrap()["data"]["Controllable"]["state"]
        );
    }
    client
        .delete(&session_url)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(
        client
            .put(&session_url)
            .json(&preview)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let exported = get_json(base, "/api/v1/config/export");
    assert_eq!(
        exported["data"]["color_calibration_profiles"],
        json!([edited_profile])
    );
    assert_eq!(
        exported["data"]["color_calibration_assignments"],
        assigned["data"]
    );
    let mut invalid_import = exported["data"].clone();
    invalid_import["color_calibration_assignments"][0]["profile_id"] = json!("does-not-exist");
    assert_eq!(
        client
            .post(format!("{base}/api/v1/config/import"))
            .json(&invalid_import)
            .send()
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    client
        .put(&assignment_url)
        .json(&json!({"device_keys":["dummy/target","dummy/other"],"profile_id":null}))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(
        get_json(base, "/api/v1/config/calibration-assignments")["data"],
        json!([])
    );
    client
        .post(format!("{base}/api/v1/config/import"))
        .json(&exported["data"])
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(
        get_json(base, "/api/v1/config/calibration-assignments")["data"],
        assigned["data"]
    );
}

fn floorplan_grid_with_devices(devices: &[(&str, &str, i32, i32)]) -> String {
    let width = devices
        .iter()
        .map(|(_, _, x, _)| *x)
        .max()
        .unwrap_or(0)
        .max(0)
        + 1;
    let height = devices
        .iter()
        .map(|(_, _, _, y)| *y)
        .max()
        .unwrap_or(0)
        .max(0)
        + 1;
    let tiles = vec![vec!["floor"; width as usize]; height as usize];

    json!({
        "width": width,
        "height": height,
        "tileSize": 1,
        "deviceScale": 1,
        "tiles": tiles,
        "devices": devices
            .iter()
            .map(|(device_key, device_name, x, y)| {
                json!({
                    "deviceKey": device_key,
                    "deviceName": device_name,
                    "x": x,
                    "y": y
                })
            })
            .collect::<Vec<_>>(),
        "groups": {}
    })
    .to_string()
}

fn exported_floorplan_grid(export: &Value, floorplan_id: &str) -> Value {
    let floorplan = export["data"]["floorplans"]
        .as_array()
        .expect("exported floorplans should be an array")
        .iter()
        .find(|floorplan| floorplan["id"] == floorplan_id)
        .unwrap_or_else(|| panic!("missing floorplan '{floorplan_id}'"));

    serde_json::from_str(
        floorplan["grid_data"]
            .as_str()
            .expect("floorplan grid should be a JSON string"),
    )
    .expect("floorplan grid should be valid JSON")
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
    config["floorplans"] = json!([
        {
            "id": "default",
            "name": "Main floorplan",
            "image_data": null,
            "image_mime_type": null,
            "width": null,
            "height": null,
            "grid_data": floorplan_grid_with_devices(&[
                ("rollout_dummy/sensor1", "Rollout Sensor", 0, 0),
                ("rollout_dummy/light1", "Rollout Light 1", 1, 0),
                ("rollout_dummy/light2", "Rollout Light 2", 3, 0),
            ])
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

fn delete_json(base_url: &str, path: &str, body: &Value) -> Response {
    Client::new()
        .delete(format!("{base_url}{path}"))
        .json(body)
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
        "helpers": [],
        "helper_values": [],
        "sources": [],
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
                "grid_data": floorplan_grid_with_devices(&[
                    ("dummy/light1", "Light 1", 12, 8)
                ])
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
        "group_positions": [],
        "device_display_overrides": [],
        "device_color_calibrations": [],
        "color_calibration_profiles": [],
        "color_calibration_assignments": [],
        "device_sensor_configs": [],
        "dashboard_layouts": [
            {
                "id": 1,
                "name": "Default",
                "is_default": true
            }
        ],
        "dashboard_widgets": [],
        "widget_settings": []
    })
}

#[test]
fn config_export_import_roundtrip_preserves_config() {
    let server = TestServer::new().expect("Failed to start test server");
    let runtime_status = get_json(&server.base_url, "/api/v1/config/runtime-status");
    assert_eq!(runtime_status["success"], true);
    assert_eq!(runtime_status["data"]["persistence_available"], true);
    assert_eq!(runtime_status["data"]["memory_only_mode"], false);

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
fn dashboard_fractional_dimensions_round_trip_through_database() {
    let server = TestServer::new().expect("Failed to start test server");
    let response = post_json(
        &server.base_url,
        "/api/v1/config/dashboard/widgets",
        &json!({
            "id": 0,
            "layout_id": 1,
            "widget_type": "weather",
            "config": { "title": "Weather", "options": {} },
            "grid_x": 0,
            "grid_y": 0,
            "grid_w": 1.5,
            "grid_h": 0.75,
            "sort_order": 0
        }),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response
        .json()
        .expect("Dashboard widget response should be valid JSON");
    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["grid_w"], 1.5);
    assert_eq!(result["data"]["grid_h"], 0.75);

    let widgets = get_json(
        &server.base_url,
        "/api/v1/config/dashboard/layouts/1/widgets",
    );
    assert_eq!(widgets["success"], true);
    assert_eq!(widgets["data"][0]["grid_w"], 1.5);
    assert_eq!(widgets["data"][0]["grid_h"], 0.75);
}

#[test]
fn config_api_starts_from_json_backup_with_default_sqlite_database() {
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
    assert_eq!(runtime_status["data"]["persistence_available"], true);
    assert_eq!(runtime_status["data"]["memory_only_mode"], false);

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
fn default_sqlite_database_persists_config_across_restarts() {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_default_sqlite_{}_{}",
        std::process::id(),
        unique_id
    ));

    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).expect("old sqlite test dir should be removable");
    }
    std::fs::create_dir_all(&temp_dir).expect("sqlite test dir should be created");

    let mut server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to start default sqlite test server");

    assert!(
        temp_dir.join("homectl.db").exists(),
        "default SQLite database should be created in the server working directory"
    );

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &json!({
            "id": "persisted-sqlite",
            "name": "Persisted SQLite"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    server.stop();
    drop(server);

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart default sqlite test server");

    let floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(floorplans["success"], true);
    assert!(floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "persisted-sqlite" && floorplan["name"] == "Persisted SQLite"
        }));

    drop(server);
    std::fs::remove_dir_all(&temp_dir).expect("sqlite test dir should be removable");
}

#[test]
fn explicit_sqlite_database_url_creates_database_and_persists_config() {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_explicit_sqlite_{}_{}",
        std::process::id(),
        unique_id
    ));
    let database_path = temp_dir.join("nested").join("custom.db");
    let database_url = format!("sqlite://{}", database_path.display());

    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).expect("old sqlite test dir should be removable");
    }

    let mut server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url.clone()),
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to start explicit sqlite test server");

    assert!(
        database_path.exists(),
        "explicit SQLite DATABASE_URL should create the database file"
    );

    let create_response = post_json(
        &server.base_url,
        "/api/v1/config/floorplans",
        &json!({
            "id": "explicit-sqlite",
            "name": "Explicit SQLite"
        }),
    );
    assert_eq!(create_response.status(), StatusCode::CREATED);

    server.stop();
    drop(server);

    let server = TestServer::with_config(TestServerConfig {
        database_url: Some(database_url),
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart explicit sqlite test server");

    let floorplans = get_json(&server.base_url, "/api/v1/config/floorplans");
    assert_eq!(floorplans["success"], true);
    assert!(floorplans["data"]
        .as_array()
        .expect("floorplans should be an array")
        .iter()
        .any(|floorplan| {
            floorplan["id"] == "explicit-sqlite" && floorplan["name"] == "Explicit SQLite"
        }));

    drop(server);
    std::fs::remove_dir_all(&temp_dir).expect("sqlite test dir should be removable");
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
fn persisted_cycle_scenes_spatial_rollout_reuses_rollout_behavior() {
    let server = start_rollout_test_server();

    wait_for("rollout fixture devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Rollout Light 1").is_some()
            && device_by_name(&devices, "Rollout Light 2").is_some()
            && device_by_name(&devices, "Rollout Sensor").is_some()
    });

    let create_routine_response = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "sensor_cycles_rollout_scene",
            "name": "Sensor Cycles Rollout Scene",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "rollout_dummy",
                    "device_id": "sensor1",
                    "state": {
                        "value": true
                    },
                    "trigger_mode": "pulse"
                }
            ],
            "actions": [
                {
                    "action": "CycleScenes",
                    "scenes": [
                        { "scene_id": "rollout_off" },
                        { "scene_id": "rollout_on" }
                    ],
                    "rollout": "spatial",
                    "rollout_source_device_key": "rollout_dummy/sensor1",
                    "rollout_duration_ms": 900
                }
            ]
        }),
    );
    assert_eq!(create_routine_response.status(), StatusCode::CREATED);

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    let stored_routine = routines["data"]
        .as_array()
        .expect("routines data should be an array")
        .iter()
        .find(|routine| routine["id"] == "sensor_cycles_rollout_scene")
        .expect("stored rollout routine should exist");
    let stored_action = &stored_routine["actions"][0];
    assert_eq!(stored_action["action"], json!("CycleScenes"));
    assert_eq!(stored_action["rollout"], json!("spatial"));
    assert_eq!(
        stored_action["rollout_source_device_key"],
        json!("rollout_dummy/sensor1"),
    );
    assert_eq!(stored_action["rollout_duration_ms"], json!(900));

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

    let sensor_update_response = put_json(
        &server.base_url,
        "/api/v1/devices/sensor1",
        &json!({
            "id": "sensor1",
            "name": "Rollout Sensor",
            "integration_id": "rollout_dummy",
            "data": {
                "Sensor": {
                    "value": true
                }
            }
        }),
    );
    assert_eq!(sensor_update_response.status(), StatusCode::OK);

    thread::sleep(Duration::from_millis(100));
    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert_eq!(device_power(&devices, "Rollout Light 2"), Some(false));

    wait_for(
        "persisted cycle scenes near rollout target to update first",
        || {
            let devices = get_json(&server.base_url, "/api/v1/devices");
            device_power(&devices, "Rollout Light 1") == Some(true)
                && device_power(&devices, "Rollout Light 2") == Some(false)
        },
    );

    wait_for(
        "persisted cycle scenes far rollout target to update last",
        || {
            let devices = get_json(&server.base_url, "/api/v1/devices");
            device_power(&devices, "Rollout Light 1") == Some(true)
                && device_power(&devices, "Rollout Light 2") == Some(true)
        },
    );
}

#[test]
fn config_api_rejects_invalid_spatial_rollout_routines() {
    let server = start_rollout_test_server();

    let create_routine_response = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "invalid_rollout_routine",
            "name": "Invalid Rollout Routine",
            "enabled": true,
            "rules": [],
            "actions": [
                {
                    "action": "CycleScenes",
                    "scenes": [
                        { "scene_id": "rollout_off" },
                        { "scene_id": "rollout_on" }
                    ],
                    "rollout": "spatial"
                }
            ]
        }),
    );
    assert_eq!(create_routine_response.status(), StatusCode::BAD_REQUEST);

    let error_body: Value = create_routine_response
        .json()
        .expect("invalid rollout response should be JSON");
    let error_message = error_body["error"]
        .as_str()
        .expect("invalid rollout response should include an error message");
    assert!(error_message.contains("rollout_source_device_key"));
    assert!(error_message.contains("rollout_duration_ms > 0"));

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    let routines_data = routines["data"]
        .as_array()
        .expect("routines data should be an array");
    assert!(!routines_data
        .iter()
        .any(|routine| routine["id"] == "invalid_rollout_routine"));
}

#[test]
fn actions_api_rejects_invalid_spatial_rollout_actions() {
    let server = start_rollout_test_server();

    let trigger_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "rollout_on",
            "rollout": "spatial"
        }),
    );
    assert_eq!(trigger_response.status(), StatusCode::BAD_REQUEST);

    let error_body: Value = trigger_response
        .json()
        .expect("invalid trigger response should be JSON");
    let error_message = error_body["error"]
        .as_str()
        .expect("invalid trigger response should include an error message");
    assert!(error_message.contains("rollout_source_device_key"));

    thread::sleep(Duration::from_millis(100));
    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert_eq!(device_power(&devices, "Rollout Light 1"), Some(false));
    assert_eq!(device_power(&devices, "Rollout Light 2"), Some(false));
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
fn config_api_device_display_name_overrides_accept_key_in_json_body() {
    let server = TestServer::new().expect("Failed to start test server");
    let device_key = "esphome-gx53/lower-bathroom-downlight-1";

    let upsert_response = put_json(
        &server.base_url,
        "/api/v1/config/device-display-names",
        &json!({
            "device_key": device_key,
            "display_name": "Lower bathroom downlight 1"
        }),
    );
    assert_eq!(upsert_response.status(), StatusCode::OK);

    let list_result = get_json(&server.base_url, "/api/v1/config/device-display-names");
    assert_eq!(
        list_result["data"],
        json!([{
            "device_key": device_key,
            "display_name": "Lower bathroom downlight 1"
        }]),
    );

    let delete_response = delete_json(
        &server.base_url,
        "/api/v1/config/device-display-names",
        &json!({"device_key": device_key}),
    );
    assert_eq!(delete_response.status(), StatusCode::OK);
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
fn config_api_replaces_device_references_and_removes_source_device() {
    let mut server = TestServer::with_config(TestServerConfig {
        config_content: Some(
            json!({
                "version": 1,
                "core": { "warmup_time_seconds": 0 },
                "integrations": [
                    {
                        "id": "dummy",
                        "plugin": "dummy",
                        "enabled": true,
                        "config": {
                            "devices": {
                                "light1": { "name": "Source Light" },
                                "light2": { "name": "Replacement Light" }
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
                            { "integration_id": "dummy", "device_id": "light1" }
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
                            "dummy/light1": { "power": true }
                        },
                        "group_states": {}
                    }
                ],
                "routines": [
                    {
                        "id": "watch_source_light",
                        "name": "Watch Source Light",
                        "enabled": true,
                        "rules": [
                            {
                                "integration_id": "dummy",
                                "device_id": "light1",
                                "power": true,
                                "trigger_mode": "level"
                            },
                            {
                                "integration_id": "dummy",
                                "device_id": "light1",
                                "path": "/raw/power",
                                "operator": "eq",
                                "value": true,
                                "trigger_mode": "pulse"
                            }
                        ],
                        "actions": [
                            {
                                "action": "ActivateScene",
                                "scene_id": "main_on",
                                "device_keys": ["dummy/light1"],
                                "rollout": "spatial",
                                "rollout_source_device_key": "dummy/light1",
                                "rollout_duration_ms": 1000
                            },
                            {
                                "action": "ToggleDeviceOverride",
                                "device_keys": ["dummy/light1"],
                                "override_state": true
                            },
                            {
                                "action": "SetDeviceState",
                                "id": "light1",
                                "name": "Source Light",
                                "integration_id": "dummy",
                                "data": {
                                    "Controllable": {
                                        "state": {
                                            "power": true
                                        },
                                        "state_source": {
                                            "scope": "device",
                                            "kind": "device_link",
                                            "group_id": null,
                                            "linked_scene_id": null,
                                            "linked_device_key": "dummy/light1"
                                        }
                                    }
                                }
                            },
                            {
                                "action": "RandomizeColor",
                                "device_keys": ["dummy/light1", "dummy/light2"]
                            }
                        ]
                    }
                ],
                "floorplan": null,
                "floorplans": [
                    {
                        "id": "default",
                        "name": "Main floorplan",
                        "image_data": null,
                        "image_mime_type": null,
                        "width": null,
                        "height": null,
                        "grid_data": floorplan_grid_with_devices(&[
                            ("dummy/light1", "Source Light", 1, 2)
                        ])
                    }
                ],
                "group_positions": [],
                "device_display_overrides": [
                    {
                        "device_key": "dummy/light1",
                        "display_name": "Renamed Source"
                    }
                ],
                "device_color_calibrations": [
                    {
                        "device_key": "dummy/light1",
                        "points": [
                            {
                                "reference": { "u": 0.20, "v": 0.47 },
                                "output": { "u": 0.21, "v": 0.48 }
                            }
                        ]
                    }
                ],
                "color_calibration_profiles": [
                    {
                        "id": "source-profile",
                        "name": "Source profile",
                        "reference_device_key": "dummy/light1",
                        "brightness": 0.5,
                        "points": [
                            {
                                "reference": { "u": 0.20, "v": 0.47 },
                                "output": { "u": 0.21, "v": 0.48 }
                            }
                        ]
                    }
                ],
                "color_calibration_assignments": [
                    {
                        "device_key": "dummy/light1",
                        "profile_id": "source-profile"
                    }
                ],
                "device_sensor_configs": [
                    {
                        "device_ref": "dummy/light1",
                        "interaction_kind": "hue_dimmer",
                        "config": { "on_value": "press" }
                    }
                ],
                "dashboard_layouts": [
                    {
                        "id": 1,
                        "name": "Default",
                        "is_default": true
                    }
                ],
                "dashboard_widgets": [
                    {
                        "id": 0,
                        "layout_id": 1,
                        "widget_type": "controls",
                        "config": {
                            "options": {
                                "deviceKeys": ["dummy/light1", "dummy/light2"]
                            },
                            "deviceKey": "dummy/light1",
                            "devicesByKey": {
                                "dummy/light1": { "enabled": true }
                            }
                        },
                        "grid_x": 0,
                        "grid_y": 0,
                        "grid_w": 1,
                        "grid_h": 1,
                        "sort_order": 0
                    }
                ]
            })
            .to_string(),
        ),
        config_file_name: Some("config-backup.json".to_string()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to start replace-device test server");

    wait_for("source and replacement devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Source Light").is_some()
            && device_by_name(&devices, "Replacement Light").is_some()
    });

    let activate_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "main_on",
            "device_keys": ["dummy/light1"]
        }),
    );
    assert_eq!(activate_response.status(), StatusCode::OK);
    wait_for("source scene activation", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Source Light")
            .and_then(|device| device["data"]["Controllable"]["scene_id"].as_str())
            == Some("main_on")
    });

    let override_response = post_json(
        &server.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ToggleDeviceOverride",
            "device_keys": ["dummy/light1"],
            "override_state": true
        }),
    );
    assert_eq!(override_response.status(), StatusCode::OK);
    thread::sleep(Duration::from_millis(250));

    let replace_response = post_json(
        &server.base_url,
        "/api/v1/config/devices/replace",
        &json!({
            "source_device_key": "dummy/light1",
            "replacement_device_key": "dummy/light2"
        }),
    );
    assert_eq!(replace_response.status(), StatusCode::OK);
    let replace_result: Value = replace_response
        .json()
        .expect("replacement response should be valid JSON");
    assert_eq!(replace_result["success"], true);
    assert_eq!(replace_result["data"]["updated_integrations"], 1);
    assert_eq!(replace_result["data"]["updated_scene_overrides"], 1);
    assert_eq!(replace_result["write"]["persistence"], "persisted");

    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert!(device_by_name(&devices, "Source Light").is_none());
    assert!(device_by_name(&devices, "Replacement Light").is_some());

    let groups = get_json(&server.base_url, "/api/v1/config/groups");
    assert_eq!(
        groups["data"][0]["devices"],
        json!([
            {
                "integration_id": "dummy",
                "device_id": "light2"
            }
        ]),
    );

    let scenes = get_json(&server.base_url, "/api/v1/config/scenes");
    assert!(scenes["data"][0]["device_states"]
        .get("dummy/light1")
        .is_none());
    assert_eq!(
        scenes["data"][0]["device_states"]["dummy/light2"],
        json!({ "power": true }),
    );

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    assert_eq!(
        routines["data"][0]["rules"][0]["device_id"],
        json!("light2")
    );
    assert_eq!(
        routines["data"][0]["rules"][1]["device_id"],
        json!("light2")
    );
    assert_eq!(
        routines["data"][0]["actions"][0]["device_keys"],
        json!(["dummy/light2"]),
    );
    assert_eq!(
        routines["data"][0]["actions"][0]["rollout_source_device_key"],
        json!("dummy/light2"),
    );
    assert_eq!(routines["data"][0]["actions"][2]["id"], json!("light2"));
    assert_eq!(
        routines["data"][0]["actions"][2]["data"]["Controllable"]["state_source"]
            ["linked_device_key"],
        json!("dummy/light2")
    );
    assert_eq!(
        routines["data"][0]["actions"][3]["device_keys"],
        json!(["dummy/light2"]),
    );

    let integrations = get_json(&server.base_url, "/api/v1/config/integrations");
    assert_eq!(
        integrations["data"][0]["config"]["disabled_device_ids"],
        json!(["light1"]),
    );

    let export = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(
        export["data"]["device_display_overrides"],
        json!([
            {
                "device_key": "dummy/light2",
                "display_name": "Renamed Source"
            }
        ]),
    );
    assert_eq!(export["data"]["device_color_calibrations"], json!([]));
    assert_eq!(
        export["data"]["color_calibration_profiles"][0]["reference_device_key"],
        json!("dummy/light2")
    );
    assert_eq!(
        export["data"]["color_calibration_assignments"],
        json!([{
            "device_key": "dummy/light2",
            "profile_id": "source-profile"
        }]),
    );
    assert_eq!(
        export["data"]["device_sensor_configs"],
        json!([{
            "device_ref": "dummy/light2",
            "interaction_kind": "hue_dimmer",
            "config": { "on_value": "press" }
        }]),
    );
    assert_eq!(
        export["data"]["dashboard_widgets"][0]["config"],
        json!({
            "options": { "deviceKeys": ["dummy/light2"] },
            "deviceKey": "dummy/light2",
            "devicesByKey": {
                "dummy/light2": { "enabled": true }
            }
        }),
    );
    let exported_grid = exported_floorplan_grid(&export, "default");
    assert_eq!(
        exported_grid["devices"],
        json!([
            {
                "deviceKey": "dummy/light2",
                "deviceName": "Replacement Light",
                "x": 1,
                "y": 2
            }
        ]),
    );

    let temp_dir = server.temp_dir.clone();
    server.stop();
    drop(server);
    let restarted = TestServer::with_config(TestServerConfig {
        config_content: Some(
            json!({
                "version": 1,
                "core": { "warmup_time_seconds": 0 },
                "integrations": [
                    {
                        "id": "dummy",
                        "plugin": "dummy",
                        "enabled": true,
                        "config": {
                            "devices": {
                                "light1": { "name": "Source Light" },
                                "light2": { "name": "Replacement Light" }
                            }
                        }
                    }
                ],
                "groups": [],
                "scenes": [],
                "routines": [],
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
            .to_string(),
        ),
        config_file_name: Some("config-backup.json".to_string()),
        working_dir: Some(temp_dir.clone()),
        ..Default::default()
    })
    .expect("Failed to restart replace-device test server");
    thread::sleep(Duration::from_millis(250));
    let restarted_devices = get_json(&restarted.base_url, "/api/v1/devices");
    assert!(device_by_name(&restarted_devices, "Source Light").is_none());
    assert!(device_by_name(&restarted_devices, "Replacement Light").is_some());

    let activate_replacement_response = post_json(
        &restarted.base_url,
        "/api/v1/actions/trigger",
        &json!({
            "action": "ActivateScene",
            "scene_id": "main_on",
            "device_keys": ["dummy/light2"]
        }),
    );
    assert_eq!(activate_replacement_response.status(), StatusCode::OK);
    wait_for("replacement scene override after restart", || {
        let devices = get_json(&restarted.base_url, "/api/v1/devices");
        device_by_name(&devices, "Replacement Light")
            .and_then(|device| device["data"]["Controllable"]["state_source"]["scope"].as_str())
            == Some("override")
    });
    drop(restarted);
}

#[test]
fn config_api_deletes_device_with_key_in_body_and_legacy_segments() {
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(
            json!({
                "version": 1,
                "core": { "warmup_time_seconds": 0 },
                "integrations": [
                    {
                        "id": "dummy",
                        "plugin": "dummy",
                        "enabled": true,
                        "config": {
                            "devices": {
                                "sensor1": {
                                    "name": "Body Delete Sensor",
                                    "init_state": { "Sensor": { "value": false } }
                                },
                                "light1": { "name": "Segment Delete Light" }
                            }
                        }
                    }
                ],
                "groups": [],
                "scenes": [],
                "routines": [],
                "floorplan": null,
                "floorplans": [],
                "group_positions": [],
                "device_display_overrides": [],
                "device_sensor_configs": [],
                "dashboard_layouts": [{ "id": 1, "name": "Default", "is_default": true }],
                "dashboard_widgets": []
            })
            .to_string(),
        ),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start device-delete-route test server");

    wait_for("devices to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Body Delete Sensor").is_some()
            && device_by_name(&devices, "Segment Delete Light").is_some()
    });

    // The UI cannot put `%2F` in the path: gateways normalize it and redirect to a
    // two-segment path that used to answer 405 without deleting anything.
    let response = post_json(
        &server.base_url,
        "/api/v1/config/devices/delete",
        &json!({ "device_key": "dummy/sensor1" }),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["data"]["deleted_device_key"], json!("dummy/sensor1"));

    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert!(device_by_name(&devices, "Body Delete Sensor").is_none());

    // A gateway that rewrote the encoded slash sends the key as two real segments.
    let response = delete(&server.base_url, "/api/v1/config/devices/dummy/light1");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response.json().unwrap();
    assert_eq!(body["data"]["deleted_device_key"], json!("dummy/light1"));

    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert!(device_by_name(&devices, "Segment Delete Light").is_none());
}

#[test]
fn config_api_deletes_device_references_and_removes_source_device() {
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(
            json!({
                "version": 1,
                "core": { "warmup_time_seconds": 0 },
                "integrations": [
                    {
                        "id": "dummy",
                        "plugin": "dummy",
                        "enabled": true,
                        "config": {
                            "devices": {
                                "sensor1": {
                                    "name": "Delete Sensor",
                                    "init_state": {
                                        "Sensor": {
                                            "value": false
                                        }
                                    }
                                },
                                "light1": {
                                    "name": "Target Light"
                                }
                            }
                        }
                    }
                ],
                "groups": [],
                "scenes": [],
                "routines": [
                    {
                        "id": "watch_sensor",
                        "name": "Watch Sensor",
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
                                "action": "ToggleDeviceOverride",
                                "device_keys": ["dummy/sensor1"],
                                "override_state": true
                            }
                        ]
                    }
                ],
                "floorplan": null,
                "floorplans": [
                    {
                        "id": "default",
                        "name": "Main floorplan",
                        "image_data": null,
                        "image_mime_type": null,
                        "width": null,
                        "height": null,
                        "grid_data": floorplan_grid_with_devices(&[
                            ("dummy/sensor1", "Delete Sensor", 2, 1)
                        ])
                    }
                ],
                "group_positions": [],
                "device_display_overrides": [],
                "device_sensor_configs": [
                    {
                        "device_ref": "dummy/sensor1",
                        "interaction_kind": "hue_dimmer",
                        "config": {
                            "on_value": "on"
                        }
                    }
                ],
                "dashboard_layouts": [
                    {
                        "id": 1,
                        "name": "Default",
                        "is_default": true
                    }
                ],
                "dashboard_widgets": []
            })
            .to_string(),
        ),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start delete-device test server");

    wait_for("sensor device to appear", || {
        let devices = get_json(&server.base_url, "/api/v1/devices");
        device_by_name(&devices, "Delete Sensor").is_some()
    });

    let delete_response = delete(&server.base_url, "/api/v1/config/devices/dummy%2Fsensor1");
    assert_eq!(delete_response.status(), StatusCode::OK);

    let devices = get_json(&server.base_url, "/api/v1/devices");
    assert!(device_by_name(&devices, "Delete Sensor").is_none());

    let sensor_configs = get_json(&server.base_url, "/api/v1/config/device-sensor-configs");
    assert_eq!(sensor_configs["data"], json!([]));

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    assert_eq!(routines["data"][0]["rules"], json!([]));
    assert_eq!(routines["data"][0]["actions"][0]["device_keys"], json!([]));

    let export = get_json(&server.base_url, "/api/v1/config/export");
    let exported_grid = exported_floorplan_grid(&export, "default");
    assert_eq!(exported_grid["devices"], json!([]));
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
devices = {}

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

    wait_for("scene script to power on the target light", || {
        let activation = post_json(
            &server.base_url,
            "/api/v1/actions/trigger",
            &json!({
                "action": "ActivateScene",
                "scene_id": "scripted_scene"
            }),
        );
        assert_eq!(activation.status(), StatusCode::OK);

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

#[test]
fn config_api_updates_routine_id_and_force_trigger_references() {
    let server = TestServer::new().expect("Failed to start test server");

    let create_primary = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "routine_a",
            "name": "Routine A",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "dummy",
                    "device_id": "sensor1",
                    "state": { "value": true },
                    "trigger_mode": "pulse"
                }
            ],
            "actions": []
        }),
    );
    assert_eq!(create_primary.status(), StatusCode::CREATED);

    let create_secondary = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "routine_b",
            "name": "Routine B",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "dummy",
                    "device_id": "sensor1",
                    "state": { "value": true },
                    "trigger_mode": "pulse"
                }
            ],
            "actions": [
                {
                    "action": "ForceTriggerRoutine",
                    "routine_id": "routine_a"
                }
            ]
        }),
    );
    assert_eq!(create_secondary.status(), StatusCode::CREATED);

    let update_response = put_json(
        &server.base_url,
        "/api/v1/config/routines/routine_a",
        &json!({
            "id": "routine_a_renamed",
            "name": "Routine A Renamed",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "dummy",
                    "device_id": "sensor1",
                    "state": { "value": true },
                    "trigger_mode": "pulse"
                }
            ],
            "actions": []
        }),
    );
    assert_eq!(update_response.status(), StatusCode::OK);

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    let routines_data = routines["data"]
        .as_array()
        .expect("routines data should be an array");

    assert!(routines_data
        .iter()
        .any(|routine| routine["id"] == "routine_a_renamed"));
    assert!(!routines_data
        .iter()
        .any(|routine| routine["id"] == "routine_a"));

    let dependent_routine = routines_data
        .iter()
        .find(|routine| routine["id"] == "routine_b")
        .expect("dependent routine should exist");
    assert_eq!(
        dependent_routine["actions"][0]["routine_id"],
        json!("routine_a_renamed"),
    );
}

#[test]
fn config_api_concurrent_integration_writes_preserve_all_changes() {
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(blank_backup_config().to_string()),
        ..Default::default()
    })
    .unwrap();
    thread::scope(|scope| {
        for index in 0..8 {
            let base_url = &server.base_url;
            scope.spawn(move || {
                let response = post_json(
                    base_url,
                    "/api/v1/config/integrations",
                    &json!({
                        "id": format!("concurrent_{index}"), "plugin": "dummy", "enabled": true,
                        "config": {"devices": {}}
                    }),
                );
                assert_eq!(response.status(), StatusCode::CREATED);
                let result: Value = response.json().unwrap();
                assert_eq!(result["write"]["persistence"], "persisted");
            });
        }
    });
    let export = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(export["data"]["integrations"].as_array().unwrap().len(), 8);
    let invalid = put_json(
        &server.base_url,
        "/api/v1/config/integrations/concurrent_0",
        &json!({
            "id": "concurrent_0", "plugin": "dummy", "enabled": true, "config": {"devices": 42}
        }),
    );
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        get_json(&server.base_url, "/api/v1/config/export")["data"]["integrations"],
        export["data"]["integrations"]
    );
}

#[test]
fn config_api_memory_only_write_returns_warning_and_applies_change() {
    let server = TestServer::with_config(TestServerConfig {
        config_content: Some(blank_backup_config().to_string()),
        database_url: Some("sqlite:///dev/null/homectl.db".into()),
        ..Default::default()
    })
    .unwrap();
    let response = post_json(
        &server.base_url,
        "/api/v1/config/groups",
        &json!({
            "id": "memory", "name": "Memory group", "hidden": false, "devices": [], "linked_groups": []
        }),
    );
    assert_eq!(response.status(), StatusCode::CREATED);
    let result: Value = response.json().unwrap();
    assert_eq!(result["write"]["applied"], true);
    assert_eq!(result["write"]["persistence"], "memory_only");
    assert!(result["write"]["warning"].is_string());
    assert_eq!(
        get_json(&server.base_url, "/api/v1/config/groups")["data"][0]["id"],
        "memory"
    );
}

#[test]
fn device_command_api_applies_patch_and_rejects_unsupported_controls() {
    let server = start_reload_test_server();
    wait_for("command target", || {
        device_by_name(
            &get_json(&server.base_url, "/api/v1/devices"),
            "Reload Light",
        )
        .is_some()
    });
    let response = post_json(
        &server.base_url,
        "/api/v1/commands/device",
        &json!({
            "request_id": "power", "device_key": "reload_dummy/light1", "power": true
        }),
    );
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response.json().unwrap();
    assert_eq!(result["request_id"], "power");
    assert_eq!(result["applied"], true);
    assert_eq!(
        device_power(
            &get_json(&server.base_url, "/api/v1/devices"),
            "Reload Light"
        ),
        Some(true)
    );
    let response = post_json(
        &server.base_url,
        "/api/v1/commands/device",
        &json!({
            "request_id": "dim", "device_key": "reload_dummy/light1", "brightness": 0.5
        }),
    );
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.json::<Value>().unwrap()["applied"], false);
    let response = post_json(
        &server.base_url,
        "/api/v1/commands/device",
        &json!({
            "request_id": "sensor", "device_key": "reload_dummy/sensor1", "power": true
        }),
    );
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// P03: v2 schema, strict version dispatch, invalid drafts
// ============================================================================

fn v2_manual_timer_definition() -> Value {
    json!({
        "triggers": [{ "kind": "manual", "id": "manual_trig" }],
        "program": {
            "kind": "native",
            "steps": [
                { "action": "cancel_timer", "id": "cancel_timer", "timer": "t1" }
            ]
        }
    })
}

fn v2_mixed_definition() -> Value {
    json!({
        "triggers": [{ "kind": "manual", "id": "manual_trig" }],
        "condition": {
            "kind": "group",
            "group_id": "main",
            "quantifier": "all",
            "power": true
        },
        "program": {
            "kind": "native",
            "steps": [
                { "action": "activate_scene", "id": "scene_step", "scene_id": "main_on" }
            ]
        }
    })
}

/// P10 fixture: a device report schedules a named timer whose expiry turns
/// the same device off. The trigger fires when the dummy sensor reports true.
fn v2_durable_timer_definition() -> Value {
    json!({
        "triggers": [{
            "kind": "state_change",
            "id": "sensor_on",
            "device": { "integration_id": "dummy", "device_id": "sensor1" },
            "mode": "level"
        }],
        "condition": { "kind": "literal", "value": true },
        "program": { "kind": "native", "steps": [
            {
                "action": "schedule_timer",
                "id": "schedule_off",
                "timer": "off",
                "delay_ms": 600000
            }
        ]}
    })
}

#[test]
fn v2_routines_validate_quarantine_drafts_and_preserve_definitions() {
    let server = TestServer::new().expect("Failed to start test server");

    // A valid enabled v2 routine saves with its definition and semantics marker.
    let create = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "v2_valid",
            "name": "V2 Valid",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": v2_manual_timer_definition(),
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(create.status(), StatusCode::CREATED);
    let created: Value = create.json().unwrap();
    assert_eq!(created["data"]["semantics_version"], json!(2));
    assert_eq!(
        created["data"]["definition_v2"],
        v2_manual_timer_definition()
    );

    // V01/V03: an enabled v2 routine with an unknown device fails with a
    // path-specific error and is not stored.
    let invalid_enabled = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "v2_invalid_enabled",
            "name": "V2 Invalid Enabled",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": {
                "triggers": [{
                    "kind": "report",
                    "id": "trig_report",
                    "device": { "integration_id": "dummy", "device_id": "missing" }
                }],
                "program": { "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "cancel_timer", "timer": "t1" }
                ]}
            },
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(invalid_enabled.status(), StatusCode::BAD_REQUEST);
    let invalid_body: Value = invalid_enabled.json().unwrap();
    let invalid_error = invalid_body["error"].as_str().unwrap_or_default();
    assert!(
        invalid_error.contains("/triggers/0/device") && invalid_error.contains("dummy/missing"),
        "unexpected error: {invalid_error}"
    );

    // V02: invalid script syntax is rejected at save.
    let invalid_script = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "v2_invalid_script",
            "name": "V2 Invalid Script",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": {
                "triggers": [{ "kind": "manual", "id": "manual_trig" }],
                "program": { "kind": "script", "spec": {
                    "api_version": 1,
                    "source_body": "if (",
                    "declarations": []
                }}
            },
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(invalid_script.status(), StatusCode::BAD_REQUEST);
    let script_body: Value = invalid_script.json().unwrap();
    assert!(script_body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("/program/spec/source_body"));

    // V04: an invalid draft saves only when disabled and stays visible/exported.
    let draft = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "v2_invalid_draft",
            "name": "V2 Invalid Draft",
            "enabled": false,
            "semantics_version": 2,
            "definition_v2": {
                "triggers": [{
                    "kind": "predicate_transition",
                    "id": "trig_predicate",
                    "predicate": { "kind": "all", "conditions": [] }
                }],
                "program": { "kind": "native", "steps": [] }
            },
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(draft.status(), StatusCode::CREATED);

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    let routines_data = routines["data"].as_array().expect("routines array");
    let stored_draft = routines_data
        .iter()
        .find(|routine| routine["id"] == "v2_invalid_draft")
        .expect("disabled draft stays listed");
    assert_eq!(stored_draft["enabled"], json!(false));
    assert_eq!(stored_draft["semantics_version"], json!(2));
    assert!(stored_draft["definition_v2"]["triggers"].is_array());
    assert!(!routines_data
        .iter()
        .any(|routine| routine["id"] == "v2_invalid_enabled"));

    let export = get_json(&server.base_url, "/api/v1/config/export");
    assert!(export["data"]["routines"]
        .as_array()
        .expect("exported routines")
        .iter()
        .any(|routine| routine["id"] == "v2_invalid_draft"
            && routine["definition_v2"]["triggers"].is_array()));

    // Unknown versions fail visibly and are never treated as v1.
    let unknown = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "v2_unknown_version",
            "name": "V2 Unknown",
            "enabled": false,
            "semantics_version": 3,
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    let unknown_body: Value = unknown.json().unwrap();
    assert!(unknown_body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("Unsupported routine semantics version 3"));

    // V08: a legacy (v1) editor write to a v2 row preserves the v2 body.
    let legacy_write = put_json(
        &server.base_url,
        "/api/v1/config/routines/v2_valid",
        &json!({
            "id": "v2_valid",
            "name": "V2 Renamed",
            "enabled": true,
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(legacy_write.status(), StatusCode::OK);

    let routines = get_json(&server.base_url, "/api/v1/config/routines");
    let stored = routines["data"]
        .as_array()
        .expect("routines array")
        .iter()
        .find(|routine| routine["id"] == "v2_valid")
        .expect("v2 routine still present");
    assert_eq!(stored["name"], json!("V2 Renamed"));
    assert_eq!(stored["semantics_version"], json!(2));
    assert_eq!(stored["definition_v2"], v2_manual_timer_definition());
    assert_eq!(stored["revision"], json!(2));
}

#[test]
fn mixed_semantics_config_round_trips_through_sqlite_database() {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_mixed_semantics_{}_{}",
        std::process::id(),
        unique_id
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).expect("old test dir should be removable");
    }
    std::fs::create_dir_all(&temp_dir).expect("test dir should be created");

    let mut import_payload = sample_config_export();
    import_payload["routines"] = json!([
        {
            "id": "sensor_main_on",
            "name": "Sensor Main On",
            "enabled": true,
            "rules": [
                {
                    "integration_id": "dummy",
                    "device_id": "sensor1",
                    "state": { "value": true },
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
        },
        {
            "id": "v2_mixed",
            "name": "V2 Mixed",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": v2_mixed_definition(),
            "rules": [],
            "actions": []
        }
    ]);

    let mut server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to start mixed-semantics SQLite server");

    let import = post_json(&server.base_url, "/api/v1/config/import", &import_payload);
    assert_eq!(import.status(), StatusCode::OK);

    let export = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(export["data"]["routines"], import_payload["routines"]);

    server.stop();

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart mixed-semantics SQLite server");

    let export_after_restart = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(
        export_after_restart["data"]["routines"],
        import_payload["routines"]
    );
}

// P05: helper definitions and values are editable through the API, validated
// against the declared kind, exported for backup, and restored on restart.
#[test]
fn helper_api_validates_and_persists_values() {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_helpers_{}_{}",
        std::process::id(),
        unique_id
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).expect("old test dir should be removable");
    }
    std::fs::create_dir_all(&temp_dir).expect("test dir should be created");

    let mut server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to start helpers SQLite server");

    let definition = json!({
        "id": "mode",
        "name": "Mode",
        "kind": { "kind": "enum", "options": ["day", "night"] },
        "initial_value": "day",
        "persistence": "durable"
    });
    let created = put_json(&server.base_url, "/api/v1/config/helpers/mode", &definition);
    assert_eq!(created.status(), StatusCode::OK);

    let list = get_json(&server.base_url, "/api/v1/config/helpers");
    let mode = list["data"]
        .as_array()
        .expect("helpers array")
        .iter()
        .find(|helper| helper["id"] == "mode")
        .expect("mode helper visible");
    assert_eq!(mode["value"], json!("day"));
    assert_eq!(mode["revision"], json!(0));

    let invalid = put_json(
        &server.base_url,
        "/api/v1/config/helpers/mode/value",
        &json!({ "value": "noon" }),
    );
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

    let updated = put_json(
        &server.base_url,
        "/api/v1/config/helpers/mode/value",
        &json!({ "value": "night" }),
    );
    assert_eq!(updated.status(), StatusCode::OK);
    let updated: Value = updated.json().expect("update response is JSON");
    assert_eq!(updated["data"]["value"], json!("night"));
    assert_eq!(updated["data"]["revision"], json!(1));

    let export = get_json(&server.base_url, "/api/v1/config/export");
    assert_eq!(export["data"]["helpers"][0]["id"], json!("mode"));
    assert_eq!(export["data"]["helper_values"][0]["value"], json!("night"));
    assert_eq!(export["data"]["helper_values"][0]["revision"], json!(1));

    let deleted = delete(&server.base_url, "/api/v1/config/helpers/mode");
    assert_eq!(deleted.status(), StatusCode::OK);
    let list = get_json(&server.base_url, "/api/v1/config/helpers");
    assert!(list["data"]
        .as_array()
        .expect("helpers array")
        .iter()
        .all(|helper| helper["id"] != "mode"));

    server.stop();

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart helpers SQLite server");
    let list = get_json(&server.base_url, "/api/v1/config/helpers");
    assert!(
        list["data"].as_array().expect("helpers array").is_empty(),
        "deleted helper does not return after restart"
    );
}

// P10: a scheduled named timer is written through to the database, survives a
// server restart, and remains cancellable. Past-due timers are dropped at
// startup rather than fired late.
#[test]
fn durable_named_timers_survive_restart_and_cancelled_ones_do_not() {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "homectl_timer_jobs_{}_{}",
        std::process::id(),
        unique_id
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).expect("old test dir should be removable");
    }
    std::fs::create_dir_all(&temp_dir).expect("test dir should be created");

    let mut server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        config_content: Some(sample_config_export().to_string()),
        config_file_name: Some("config-backup.json".to_string()),
        ..Default::default()
    })
    .expect("Failed to start timer persistence SQLite server");

    let create = post_json(
        &server.base_url,
        "/api/v1/config/routines",
        &json!({
            "id": "durable_timer",
            "name": "Durable Timer",
            "enabled": true,
            "semantics_version": 2,
            "definition_v2": v2_durable_timer_definition(),
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(create.status(), StatusCode::CREATED);

    // The routine fires on the sensor's level-true state change and schedules
    // a named timer for ten minutes out.
    let sensor_update = put_json(
        &server.base_url,
        "/api/v1/devices/sensor1",
        &json!({
            "id": "sensor1",
            "name": "Sensor 1",
            "integration_id": "dummy",
            "data": { "Sensor": { "value": true } }
        }),
    );
    assert_eq!(sensor_update.status(), StatusCode::OK);

    let timer_job_count = |database_path: &std::path::Path| -> i64 {
        use sea_orm::ConnectionTrait;
        use sea_orm::TryGetable;

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should start");
        runtime.block_on(async {
            let db = sea_orm::Database::connect(format!(
                "sqlite://{}?mode=rwc",
                database_path.display()
            ))
            .await
            .expect("should open the test SQLite database");
            let row = db
                .query_one_raw(sea_orm::Statement::from_string(
                    sea_orm::DbBackend::Sqlite,
                    "SELECT COUNT(*) AS count FROM automation_timer_jobs",
                ))
                .await
                .expect("timer jobs table should be queryable")
                .expect("count row");
            i64::try_get_by_index(&row, 0).expect("count column")
        })
    };

    let database_path = temp_dir.join("homectl.db");
    wait_for("durable timer row to be written through", || {
        timer_job_count(&database_path) == 1
    });

    server.stop();

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart timer persistence SQLite server");
    wait_for(
        "timer persistence table to remain readable after restart",
        || timer_job_count(&database_path) == 1,
    );

    // Cancel through the API path (routine edit drops the live generation),
    // then restart again: the row must not resurrect.
    let disable = put_json(
        &server.base_url,
        "/api/v1/config/routines/durable_timer",
        &json!({
            "id": "durable_timer",
            "name": "Durable Timer",
            "enabled": false,
            "semantics_version": 2,
            "definition_v2": v2_durable_timer_definition(),
            "rules": [],
            "actions": []
        }),
    );
    assert_eq!(disable.status(), StatusCode::OK);
    wait_for("dropped timer row to be deleted", || {
        timer_job_count(&database_path) == 0
    });
    drop(server);

    let server = TestServer::with_config(TestServerConfig {
        working_dir: Some(temp_dir.clone()),
        cleanup_working_dir: false,
        ..Default::default()
    })
    .expect("Failed to restart timer persistence SQLite server for the cancel check");
    assert_eq!(
        timer_job_count(&database_path),
        0,
        "an acknowledged cancel survives a restart"
    );
    drop(server);

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn cross_origin_requests_are_restricted() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let export_url = format!("{}/api/v1/config/export", server.base_url);

    // Requests without an Origin header (CLI, curl, health probes) keep working.
    let response = client.get(&export_url).send().unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Same-origin browser requests (the bundled UI) keep working, even when
    // the public host differs from the loopback address used in tests.
    let response = client
        .get(&export_url)
        .header("Host", "homectl.test")
        .header("Origin", "https://homectl.test")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("Access-Control-Allow-Origin")
            .unwrap(),
        "https://homectl.test"
    );

    // Loopback origins are allowed for local development.
    let response = client
        .get(&export_url)
        .header("Origin", "http://localhost:5173")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Foreign origins are rejected before any handler runs, and their
    // responses carry no CORS permissions.
    let response = client
        .get(&export_url)
        .header("Origin", "https://evil.example")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(response
        .headers()
        .get("Access-Control-Allow-Origin")
        .is_none());

    let import_url = format!("{}/api/v1/config/import", server.base_url);
    let response = client
        .post(&import_url)
        .header("Origin", "https://evil.example")
        .json(&blank_backup_config())
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = client
        .request(reqwest::Method::OPTIONS, &import_url)
        .header("Origin", "https://evil.example")
        .header("Access-Control-Request-Method", "POST")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Allowed preflights are answered with CORS headers.
    let response = client
        .request(reqwest::Method::OPTIONS, &import_url)
        .header("Origin", "http://localhost:5173")
        .header("Access-Control-Request-Method", "POST")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response
            .headers()
            .get("Access-Control-Allow-Origin")
            .unwrap(),
        "http://localhost:5173"
    );
}

fn widget_setting(config: &Value, key: &str) -> Value {
    config["widget_settings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["key"] == key)
        .cloned()
        .unwrap_or_else(|| panic!("missing widget setting {key}"))
}

#[test]
fn config_exports_redact_widget_secrets_by_default() {
    let server = TestServer::new().unwrap();
    let client = Client::new();
    let base = &server.base_url;

    // Secrets can still be written through the write-only core patch.
    client
        .put(format!("{base}/api/v1/config/core"))
        .json(&json!({
            "influx_token": "secret-token",
            "calendar_ics_url": "https://calendar.example/private.ics",
        }))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();

    // Browser config responses never carry the secrets.
    let ui_config: Value = client
        .get(format!("{base}/api/config"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    for key in [
        "influx_token",
        "influxToken",
        "calendar_ics_url",
        "calendarIcsUrl",
    ] {
        assert!(
            ui_config.get(key).is_none(),
            "unexpected {key} in /api/config"
        );
    }

    let core: Value = client
        .get(format!("{base}/api/v1/config/core"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert!(core["data"].get("influx_token").is_none());
    assert!(core["data"].get("calendar_ics_url").is_none());

    // Default exports omit secret fields entirely.
    let export: Value = client
        .get(format!("{base}/api/v1/config/export"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let redacted = export["data"].clone();
    let influx = widget_setting(&redacted, "influxdb");
    assert!(influx["config"].get("token").is_none());
    let calendar = widget_setting(&redacted, "calendar");
    assert!(calendar["config"].get("icsUrl").is_none());

    // An explicit request gets a secret-inclusive backup for restores.
    let full: Value = client
        .get(format!("{base}/api/v1/config/export?include_secrets=true"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let full = full["data"].clone();
    assert_eq!(
        widget_setting(&full, "influxdb")["config"]["token"],
        "secret-token"
    );
    assert_eq!(
        widget_setting(&full, "calendar")["config"]["icsUrl"],
        "https://calendar.example/private.ics"
    );

    // Importing the redacted export keeps the stored secrets.
    client
        .post(format!("{base}/api/v1/config/import"))
        .json(&redacted)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let restored: Value = client
        .get(format!("{base}/api/v1/config/export?include_secrets=true"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let restored = restored["data"].clone();
    assert_eq!(
        widget_setting(&restored, "influxdb")["config"]["token"],
        "secret-token"
    );
    assert_eq!(
        widget_setting(&restored, "calendar")["config"]["icsUrl"],
        "https://calendar.example/private.ics"
    );

    // An explicit empty value still clears a stored secret.
    let mut cleared = redacted.clone();
    for row in cleared["widget_settings"].as_array_mut().unwrap() {
        if row["key"] == "influxdb" {
            row["config"]["token"] = json!("");
        }
    }
    client
        .post(format!("{base}/api/v1/config/import"))
        .json(&cleared)
        .send()
        .unwrap()
        .error_for_status()
        .unwrap();
    let after_clear: Value = client
        .get(format!("{base}/api/v1/config/export?include_secrets=true"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(
        widget_setting(&after_clear["data"], "influxdb")["config"]["token"],
        ""
    );
}

#[test]
fn cross_origin_allowlist_honors_configured_origins() {
    let server = TestServer::with_config(TestServerConfig {
        extra_env: vec![(
            "HOMECTL_ALLOWED_ORIGINS".to_string(),
            "https://dashboard.example/, http://kiosk.local:8080".to_string(),
        )],
        ..Default::default()
    })
    .unwrap();
    let client = Client::new();
    let export_url = format!("{}/api/v1/config/export", server.base_url);

    let response = client
        .get(&export_url)
        .header("Origin", "https://dashboard.example")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("Access-Control-Allow-Origin")
            .unwrap(),
        "https://dashboard.example"
    );

    let response = client
        .get(&export_url)
        .header("Origin", "http://kiosk.local:8080")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = client
        .get(&export_url)
        .header("Origin", "https://other.example")
        .send()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
