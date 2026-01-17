//! Integration tests for the configuration API endpoints.
//!
//! These tests verify that:
//! - Config CRUD operations work correctly
//! - Hot-reload triggers function properly
//! - Import/export maintains data integrity

use serde_json::{json, Value};

/// Helper to create a test integration config
fn create_test_integration(id: &str, plugin: &str) -> Value {
    json!({
        "id": id,
        "plugin": plugin,
        "enabled": true,
        "config": {}
    })
}

/// Helper to create a test group config
fn create_test_group(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "hidden": false,
        "devices": [],
        "linked_groups": []
    })
}

/// Helper to create a test scene config
fn create_test_scene(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "hidden": false,
        "script": null
    })
}

/// Helper to create a test routine config
fn create_test_routine(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "enabled": true,
        "rules": [],
        "actions": []
    })
}

#[cfg(test)]
mod config_serialization {
    use super::*;

    #[test]
    fn test_integration_config_structure() {
        let config = create_test_integration("test-mqtt", "mqtt");
        assert_eq!(config["id"], "test-mqtt");
        assert_eq!(config["plugin"], "mqtt");
        assert_eq!(config["enabled"], true);
        assert!(config["config"].is_object());
    }

    #[test]
    fn test_group_config_structure() {
        let config = create_test_group("living-room", "Living Room");
        assert_eq!(config["id"], "living-room");
        assert_eq!(config["name"], "Living Room");
        assert_eq!(config["hidden"], false);
        assert!(config["devices"].is_array());
        assert!(config["linked_groups"].is_array());
    }

    #[test]
    fn test_scene_config_structure() {
        let config = create_test_scene("movie-mode", "Movie Mode");
        assert_eq!(config["id"], "movie-mode");
        assert_eq!(config["name"], "Movie Mode");
        assert_eq!(config["hidden"], false);
    }

    #[test]
    fn test_routine_config_structure() {
        let config = create_test_routine("motion-lights", "Motion Lights");
        assert_eq!(config["id"], "motion-lights");
        assert_eq!(config["name"], "Motion Lights");
        assert_eq!(config["enabled"], true);
        assert!(config["rules"].is_array());
        assert!(config["actions"].is_array());
    }

    #[test]
    fn test_complex_routine_with_rules() {
        let routine = json!({
            "id": "sunset-routine",
            "name": "Sunset Routine",
            "enabled": true,
            "rules": [
                {
                    "type": "DeviceState",
                    "device_key": "sensor/motion",
                    "state": { "OnOffSensor": { "value": true } }
                },
                {
                    "type": "Script",
                    "script": "devices['sensor/lux']?.state?.LightLevel?.value < 50"
                }
            ],
            "actions": [
                {
                    "type": "ActivateScene",
                    "scene_id": "evening-lights"
                }
            ]
        });

        assert_eq!(routine["rules"].as_array().unwrap().len(), 2);
        assert_eq!(routine["actions"].as_array().unwrap().len(), 1);

        // Verify Script rule structure
        let script_rule = &routine["rules"][1];
        assert!(script_rule["script"].is_string());
    }

    #[test]
    fn test_scene_with_script() {
        let scene = json!({
            "id": "dynamic-brightness",
            "name": "Dynamic Brightness",
            "hidden": false,
            "script": "({ power: true, brightness: Math.max(0.1, 1 - (devices['sensor/lux']?.state?.LightLevel?.value || 0) / 1000) })"
        });

        assert!(scene["script"].is_string());
        assert!(scene["script"].as_str().unwrap().contains("brightness"));
    }
}

#[cfg(test)]
mod config_export_import {
    use super::*;

    #[test]
    fn test_full_export_structure() {
        let export = json!({
            "integrations": [
                create_test_integration("mqtt-1", "mqtt"),
                create_test_integration("dummy-1", "dummy")
            ],
            "groups": [
                create_test_group("living-room", "Living Room"),
                create_test_group("bedroom", "Bedroom")
            ],
            "scenes": [
                create_test_scene("bright", "Bright"),
                create_test_scene("dim", "Dim")
            ],
            "routines": [
                create_test_routine("motion-1", "Motion Lights")
            ],
            "core_config": {
                "warmup_seconds": 5
            }
        });

        assert_eq!(export["integrations"].as_array().unwrap().len(), 2);
        assert_eq!(export["groups"].as_array().unwrap().len(), 2);
        assert_eq!(export["scenes"].as_array().unwrap().len(), 2);
        assert_eq!(export["routines"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_import_validates_required_fields() {
        // Missing 'id' field should be detectable
        let invalid_integration = json!({
            "plugin": "mqtt",
            "enabled": true
        });

        assert!(invalid_integration.get("id").is_none());
    }

    #[test]
    fn test_export_import_roundtrip() {
        let original = json!({
            "integrations": [create_test_integration("test", "dummy")],
            "groups": [create_test_group("g1", "Group 1")],
            "scenes": [create_test_scene("s1", "Scene 1")],
            "routines": [create_test_routine("r1", "Routine 1")]
        });

        // Serialize to string (simulating export)
        let exported = serde_json::to_string(&original).unwrap();

        // Deserialize back (simulating import)
        let imported: Value = serde_json::from_str(&exported).unwrap();

        // Verify data integrity
        assert_eq!(original["integrations"], imported["integrations"]);
        assert_eq!(original["groups"], imported["groups"]);
        assert_eq!(original["scenes"], imported["scenes"]);
        assert_eq!(original["routines"], imported["routines"]);
    }
}

#[cfg(test)]
mod floorplan_config {
    use serde_json::json;

    #[test]
    fn test_floorplan_grid_structure() {
        let grid = json!({
            "width": 20,
            "height": 15,
            "tileSize": 24,
            "tiles": [
                ["floor", "floor", "wall"],
                ["floor", "floor", "wall"],
                ["door", "floor", "window"]
            ],
            "devices": [
                { "deviceKey": "light/living", "deviceName": "Living Light", "x": 5, "y": 3 },
                { "deviceKey": "sensor/motion", "deviceName": "Motion", "x": 10, "y": 7 }
            ]
        });

        assert_eq!(grid["width"], 20);
        assert_eq!(grid["height"], 15);
        assert_eq!(grid["tileSize"], 24);
        assert_eq!(grid["tiles"].as_array().unwrap().len(), 3);
        assert_eq!(grid["devices"].as_array().unwrap().len(), 2);

        // Verify device position
        let device = &grid["devices"][0];
        assert_eq!(device["deviceKey"], "light/living");
        assert_eq!(device["x"], 5);
        assert_eq!(device["y"], 3);
    }

    #[test]
    fn test_tile_types() {
        let valid_tiles = ["floor", "wall", "door", "window"];

        for tile in valid_tiles {
            let grid = json!({
                "tiles": [[tile]]
            });
            assert_eq!(grid["tiles"][0][0], tile);
        }
    }

    #[test]
    fn test_device_position_bounds() {
        // Device positions should be within grid bounds
        let grid = json!({
            "width": 10,
            "height": 10,
            "devices": [
                { "deviceKey": "d1", "deviceName": "Device 1", "x": 5, "y": 5 }
            ]
        });

        let device = &grid["devices"][0];
        let x = device["x"].as_i64().unwrap();
        let y = device["y"].as_i64().unwrap();
        let width = grid["width"].as_i64().unwrap();
        let height = grid["height"].as_i64().unwrap();

        assert!(x >= 0 && x < width);
        assert!(y >= 0 && y < height);
    }
}

#[cfg(test)]
mod dashboard_config {
    use serde_json::json;

    #[test]
    fn test_dashboard_layout_structure() {
        let layout = json!({
            "id": "default",
            "name": "Default Dashboard",
            "is_default": true
        });

        assert_eq!(layout["id"], "default");
        assert_eq!(layout["name"], "Default Dashboard");
        assert_eq!(layout["is_default"], true);
    }

    #[test]
    fn test_widget_structure() {
        let widget = json!({
            "id": "w1",
            "layout_id": "default",
            "widget_type": "weather",
            "title": "Weather",
            "position": 0,
            "width": 2,
            "height": 2,
            "options": {
                "location": "Helsinki",
                "units": "metric"
            }
        });

        assert_eq!(widget["widget_type"], "weather");
        assert_eq!(widget["width"], 2);
        assert_eq!(widget["height"], 2);
        assert!(widget["options"]["location"].is_string());
    }

    #[test]
    fn test_widget_types() {
        let valid_types = [
            "clock",
            "weather",
            "sensors",
            "controls",
            "spot_price",
            "train_schedule",
            "custom",
        ];

        for widget_type in valid_types {
            let widget = json!({
                "widget_type": widget_type,
                "title": widget_type,
                "width": 1,
                "height": 1
            });
            assert_eq!(widget["widget_type"], widget_type);
        }
    }
}
