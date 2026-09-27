use homectl_server::{
    core::scenario::{
        run_scenario_suite, ExpectedCommand, ExpectedDeviceState, LightState, ScenarioEvent,
        ScenarioSuite, SensorValue,
    },
    db::config_queries::ConfigExport,
    types::device::DeviceKey,
};
use serde_json::{json, Value};

fn stairs_config() -> ConfigExport {
    serde_json::from_value(json!({
        "version": 1,
        "core": {},
        "integrations": [],
        "groups": [{
            "id": "upstairs",
            "name": "Upstairs",
            "hidden": false,
            "devices": [
                { "integration_id": "sim", "device_id": "upstairs_main" },
                { "integration_id": "sim", "device_id": "upstairs_hall" }
            ],
            "linked_groups": []
        }],
        "scenes": [],
        "routines": [{
            "id": "stairs_motion",
            "name": "Stairs motion",
            "enabled": true,
            "semantics_version": 2,
            "revision": 1,
            "definition_v2": {
                "triggers": [{
                    "kind": "state_change",
                    "id": "motion",
                    "device": { "integration_id": "sim", "device_id": "stairs_motion" }
                }],
                "condition": {
                    "kind": "group",
                    "group_id": "upstairs",
                    "quantifier": "none",
                    "power": true
                },
                "program": { "kind": "native", "steps": [
                    { "action": "set_power", "id": "left_on",
                      "device": { "integration_id": "sim", "device_id": "kids_left" },
                      "power": true },
                    { "action": "set_power", "id": "right_on",
                      "device": { "integration_id": "sim", "device_id": "kids_right" },
                      "power": true }
                ]}
            },
            "rules": [],
            "actions": []
        }],
        "floorplan": null,
        "dashboard_layouts": [],
        "dashboard_widgets": []
    }))
    .expect("synthetic config export should decode")
}

fn stairs_suite() -> ScenarioSuite {
    let suite: Value = json!({
        "version": 1,
        "devices": [
            { "kind": "sensor", "device": "sim/stairs_motion", "name": "Stairs motion" },
            { "kind": "light", "device": "sim/upstairs_main", "name": "Upstairs main", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/upstairs_hall", "name": "Upstairs hall", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/kids_left", "name": "Kids left lamp", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/kids_right", "name": "Kids right lamp", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/office", "name": "Office lamp", "capabilities": { "brightness": true } }
        ],
        "scenarios": [
            {
                "name": "stairs motion turns on kids lamps when upstairs is dark",
                "routines": ["Stairs motion"],
                "initial_state": [
                    { "kind": "sensor", "device": "sim/stairs_motion", "value": false },
                    { "kind": "light", "device": "sim/upstairs_main", "power": false, "brightness": 0.8 },
                    { "kind": "light", "device": "sim/upstairs_hall", "power": false, "brightness": 0.6 },
                    { "kind": "light", "device": "sim/kids_left", "power": false, "brightness": 0.25 },
                    { "kind": "light", "device": "sim/kids_right", "power": false, "brightness": 0.4 },
                    { "kind": "light", "device": "sim/office", "power": false, "brightness": 0.7 }
                ],
                "events": [
                    { "type": "sensor", "device": "sim/stairs_motion", "value": true }
                ],
                "expect": {
                    "commands": [
                        { "type": "device_state", "device": "sim/kids_left", "power": true, "brightness": 0.25 },
                        { "type": "device_state", "device": "sim/kids_right", "power": true, "brightness": 0.4 }
                    ],
                    "final_state": [
                        { "kind": "light", "device": "sim/kids_left", "name": "Kids left lamp", "power": true, "brightness": 0.25 },
                        { "kind": "light", "device": "sim/kids_right", "name": "Kids right lamp", "power": true, "brightness": 0.4 },
                        { "kind": "sensor", "device": "sim/stairs_motion", "value": true }
                    ],
                    "unchanged": ["sim/upstairs_main", "sim/upstairs_hall", "sim/office"]
                }
            },
            {
                "name": "stairs motion does nothing if an upstairs light is already on",
                "routines": ["Stairs motion"],
                "initial_state": [
                    { "kind": "sensor", "device": "sim/stairs_motion", "value": false },
                    { "kind": "light", "device": "sim/upstairs_main", "power": true, "brightness": 0.8 },
                    { "kind": "light", "device": "sim/upstairs_hall", "power": false, "brightness": 0.6 },
                    { "kind": "light", "device": "sim/kids_left", "power": false, "brightness": 0.25 },
                    { "kind": "light", "device": "sim/kids_right", "power": false, "brightness": 0.4 },
                    { "kind": "light", "device": "sim/office", "power": false, "brightness": 0.7 }
                ],
                "events": [
                    { "type": "sensor", "device": "sim/stairs_motion", "value": true }
                ],
                "expect": {
                    "commands": [],
                    "final_state": [
                        { "kind": "sensor", "device": "sim/stairs_motion", "value": true }
                    ],
                    "unchanged": ["sim/upstairs_main", "sim/upstairs_hall", "sim/kids_left", "sim/kids_right", "sim/office"]
                }
            }
        ]
    });
    serde_json::from_value(suite).expect("synthetic scenario suite should decode")
}

fn behavior_config() -> ConfigExport {
    serde_json::from_value(json!({
        "version": 1,
        "core": {},
        "integrations": [],
        "groups": [],
        "scenes": [],
        "routines": [
            {
                "id": "arrival_home",
                "name": "Arrival home",
                "enabled": true,
                "semantics_version": 2,
                "revision": 1,
                "definition_v2": {
                    "triggers": [{
                        "kind": "state_change",
                        "id": "presence_rises",
                        "device": { "integration_id": "sim", "device_id": "home_presence" }
                    }],
                    "program": { "kind": "native", "steps": [
                        { "action": "set_power", "id": "entry_on",
                          "device": { "integration_id": "sim", "device_id": "entry_light" },
                          "power": true },
                        { "action": "set_power", "id": "living_on",
                          "device": { "integration_id": "sim", "device_id": "living_light" },
                          "power": true }
                    ]}
                },
                "rules": [],
                "actions": []
            },
            {
                "id": "entry_dimmer_off",
                "name": "Entry dimmer off",
                "enabled": true,
                "semantics_version": 2,
                "revision": 1,
                "definition_v2": {
                    "triggers": [{
                        "kind": "state_change",
                        "id": "dimmer_off",
                        "device": { "integration_id": "sim", "device_id": "entry_dimmer_off" }
                    }],
                    "program": { "kind": "native", "steps": [
                        { "action": "set_power", "id": "entry_off",
                          "device": { "integration_id": "sim", "device_id": "entry_light" },
                          "power": false },
                        { "action": "set_power", "id": "hall_off",
                          "device": { "integration_id": "sim", "device_id": "hall_light" },
                          "power": false }
                    ]}
                },
                "rules": [],
                "actions": []
            }
        ],
        "floorplan": null,
        "dashboard_layouts": [],
        "dashboard_widgets": []
    }))
    .expect("synthetic behavior config should decode")
}

fn behavior_suite() -> ScenarioSuite {
    serde_json::from_value(json!({
        "version": 1,
        "devices": [
            { "kind": "sensor", "device": "sim/home_presence", "name": "Home presence" },
            { "kind": "sensor", "device": "sim/entry_dimmer_off", "name": "Entry dimmer off button" },
            { "kind": "light", "device": "sim/entry_light", "name": "Entry light", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/living_light", "name": "Living light", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/hall_light", "name": "Hall light", "capabilities": { "brightness": true } },
            { "kind": "light", "device": "sim/office_light", "name": "Office light", "capabilities": { "brightness": true } }
        ],
        "scenarios": [
            {
                "name": "arriving home turns on entry and living lights",
                "routines": ["Arrival home"],
                "initial_state": [
                    { "kind": "sensor", "device": "sim/home_presence", "value": false },
                    { "kind": "light", "device": "sim/entry_light", "power": false, "brightness": 0.4 },
                    { "kind": "light", "device": "sim/living_light", "power": false, "brightness": 0.6 },
                    { "kind": "light", "device": "sim/office_light", "power": false, "brightness": 0.8 }
                ],
                "events": [{ "type": "sensor", "device": "sim/home_presence", "value": true }],
                "expect": {
                    "commands": [
                        { "type": "device_state", "device": "sim/entry_light", "power": true, "brightness": 0.4 },
                        { "type": "device_state", "device": "sim/living_light", "power": true, "brightness": 0.6 }
                    ],
                    "final_state": [
                        { "kind": "sensor", "device": "sim/home_presence", "value": true },
                        { "kind": "light", "device": "sim/entry_light", "power": true, "brightness": 0.4 },
                        { "kind": "light", "device": "sim/living_light", "power": true, "brightness": 0.6 }
                    ],
                    "unchanged": ["sim/office_light"]
                }
            },
            {
                "name": "repeated home presence does not relight the house",
                "routines": ["Arrival home"],
                "initial_state": [
                    { "kind": "sensor", "device": "sim/home_presence", "value": true },
                    { "kind": "light", "device": "sim/entry_light", "power": true, "brightness": 0.4 },
                    { "kind": "light", "device": "sim/living_light", "power": true, "brightness": 0.6 },
                    { "kind": "light", "device": "sim/office_light", "power": false, "brightness": 0.8 }
                ],
                "events": [{ "type": "sensor", "device": "sim/home_presence", "value": true }],
                "expect": {
                    "commands": [],
                    "final_state": [{ "kind": "sensor", "device": "sim/home_presence", "value": true }],
                    "unchanged": ["sim/entry_light", "sim/living_light", "sim/office_light"]
                }
            },
            {
                "name": "entry dimmer off turns off only entry and hall lights",
                "routines": ["Entry dimmer off"],
                "initial_state": [
                    { "kind": "sensor", "device": "sim/entry_dimmer_off", "value": false },
                    { "kind": "light", "device": "sim/entry_light", "power": true, "brightness": 0.5 },
                    { "kind": "light", "device": "sim/hall_light", "power": true, "brightness": 0.3 },
                    { "kind": "light", "device": "sim/office_light", "power": true, "brightness": 0.8 }
                ],
                "events": [{ "type": "sensor", "device": "sim/entry_dimmer_off", "value": true }],
                "expect": {
                    "commands": [
                        { "type": "device_state", "device": "sim/entry_light", "power": false, "brightness": 0.5 },
                        { "type": "device_state", "device": "sim/hall_light", "power": false, "brightness": 0.3 }
                    ],
                    "final_state": [
                        { "kind": "sensor", "device": "sim/entry_dimmer_off", "value": true },
                        { "kind": "light", "device": "sim/entry_light", "power": false, "brightness": 0.5 },
                        { "kind": "light", "device": "sim/hall_light", "power": false, "brightness": 0.3 }
                    ],
                    "unchanged": ["sim/office_light"]
                }
            }
        ]
    }))
    .expect("synthetic behavior scenarios should decode")
}

#[tokio::test]
async fn scenario_runner_executes_arrival_home_and_dimmer_scenarios() {
    let report = run_scenario_suite(&behavior_config(), &behavior_suite())
        .await
        .expect("behavior suite should run");

    assert_eq!(report.scenarios.len(), 3);
    assert!(
        report.scenarios.iter().all(|scenario| scenario.passed),
        "{report:#?}"
    );
}

#[tokio::test]
async fn scenario_runner_executes_compiled_routines_and_checks_commands_and_state() {
    let report = run_scenario_suite(&stairs_config(), &stairs_suite())
        .await
        .expect("scenario suite should run");

    assert_eq!(report.scenarios.len(), 2);
    assert!(
        report.scenarios.iter().all(|scenario| scenario.passed),
        "{report:#?}"
    );
}

#[tokio::test]
async fn scenario_executes_other_enabled_routines_that_share_an_event() {
    let mut config = stairs_config();
    config.routines.push(
        serde_json::from_value(json!({
            "id": "second_stairs_routine",
            "name": "Second stairs routine",
            "enabled": true,
            "semantics_version": 2,
            "revision": 1,
            "definition_v2": {
                "triggers": [{
                    "kind": "state_change",
                    "id": "same_motion",
                    "device": { "integration_id": "sim", "device_id": "stairs_motion" }
                }],
                "program": { "kind": "native", "steps": [
                    { "action": "set_power", "id": "office_on",
                      "device": { "integration_id": "sim", "device_id": "office" },
                      "power": true }
                ]}
            },
            "rules": [],
            "actions": []
        }))
        .expect("second synthetic routine should decode"),
    );
    let mut suite = stairs_suite();
    suite.scenarios.truncate(1);
    let office: DeviceKey = serde_json::from_value(json!("sim/office")).unwrap();
    suite.scenarios[0]
        .expect
        .commands
        .push(ExpectedCommand::DeviceState {
            device: office.clone(),
            state: LightState {
                power: true,
                brightness: Some(0.7),
                color: None,
                transition: None,
            },
        });
    suite.scenarios[0]
        .expect
        .final_state
        .push(ExpectedDeviceState::Light {
            device: office.clone(),
            state: LightState {
                power: true,
                brightness: Some(0.7),
                color: None,
                transition: None,
            },
        });
    suite.scenarios[0]
        .expect
        .unchanged
        .retain(|device| device != &office);

    let report = run_scenario_suite(&config, &suite)
        .await
        .expect("scenario suite should run");
    assert!(report.scenarios[0].passed, "{report:#?}");
}

#[tokio::test]
async fn scenario_failures_name_devices_instead_of_internal_keys() {
    let mut suite = stairs_suite();
    suite.scenarios[0].expect.commands[0] = ExpectedCommand::DeviceState {
        device: serde_json::from_value(json!("sim/kids_left")).unwrap(),
        state: LightState {
            power: true,
            brightness: Some(0.26),
            color: None,
            transition: None,
        },
    };

    let report = run_scenario_suite(&stairs_config(), &suite)
        .await
        .expect("scenario suite should run");
    let failure = report.scenarios[0].failures.join("\n");

    assert!(!report.scenarios[0].passed);
    assert!(failure.contains("Kids left lamp"), "{failure}");
    assert!(!failure.contains("sim/kids_left"), "{failure}");
}

#[tokio::test]
async fn scenario_rejects_sensor_events_with_a_different_value_type() {
    let mut suite = stairs_suite();
    suite.scenarios[0].events[0] = ScenarioEvent::Sensor {
        device: serde_json::from_value(json!("sim/stairs_motion")).unwrap(),
        value: SensorValue::Text("active".to_string()),
    };

    let error = run_scenario_suite(&stairs_config(), &suite)
        .await
        .expect_err("a boolean sensor should reject a text event");
    assert!(
        format!("{error:#}").contains("wrong value type"),
        "{error:#}"
    );
}
