//! P00 baseline characterization tests.
//!
//! These tests intentionally record the *current* v1 behavior of the routine
//! evaluator, including known ordering and truthiness hazards, so that later
//! automation-v2 packages can change behavior against a named expectation.
//!
//! Test IDs (plan Section 13) are in the test names:
//! B01 defaults, B02 level re-match, B03 mixed Any paired bits, B04 malformed
//! rows + script truthiness, B05 group scene semantics, E01 queue coherence.
//!
//! None of these tests touch a live sink; see `automation_baseline` for the
//! offline harness.

use homectl_server::core::automation_baseline::{
    action_counts, run_fixture, BaselineHarness, ReplayFixture, BASELINE_REVISION,
};
use homectl_server::core::routines::Routines;
use homectl_server::core::scripting::ScriptEngine;
use homectl_server::db::config_queries::RoutineRow;
use homectl_server::types::{
    action::{Action, Actions},
    device::{
        ControllableDevice, Device, DeviceData, DeviceId, DeviceRef, ManageKind, SensorDevice,
    },
    event::mk_event_channel,
    group::{GroupConfig, GroupId, GroupsConfig},
    integration::IntegrationId,
    rule::{
        AnyRule, DeviceRule, GroupRule, RawRule, RawRuleOperator, Routine, RoutineId,
        RoutinesConfig, Rule, ScriptRule, SensorRule, TriggerMode,
    },
    scene::SceneId,
};
use serde_json::json;
use std::str::FromStr;

fn integration() -> IntegrationId {
    IntegrationId::from("test".to_string())
}

fn device_id(id: &str) -> DeviceId {
    DeviceId::new(id)
}

fn sensor_ref(id: &str) -> DeviceRef {
    DeviceRef::new_with_id(integration(), device_id(id))
}

fn lamp_ref(id: &str) -> DeviceRef {
    DeviceRef::new_with_id(integration(), device_id(id))
}

fn sensor_device(id: &str, value: bool) -> Device {
    Device::new(
        integration(),
        device_id(id),
        format!("Sensor {id}"),
        DeviceData::Sensor(SensorDevice::Boolean { value }),
        None,
    )
}

fn lamp_device(id: &str, power: bool) -> Device {
    Device::new(
        integration(),
        device_id(id),
        format!("Lamp {id}"),
        DeviceData::Controllable(ControllableDevice::new(
            None,
            power,
            None,
            None,
            None,
            Default::default(),
            ManageKind::Unmanaged,
        )),
        None,
    )
}

fn lamp_device_with_scene(id: &str, scene: Option<&str>) -> Device {
    Device::new(
        integration(),
        device_id(id),
        format!("Lamp {id}"),
        DeviceData::Controllable(ControllableDevice::new(
            scene.map(|s| SceneId::from(s.to_string())),
            true,
            None,
            None,
            None,
            Default::default(),
            ManageKind::Unmanaged,
        )),
        None,
    )
}

fn noop_action() -> Action {
    Action::ForceTriggerRoutine(homectl_server::types::rule::ForceTriggerRoutineDescriptor {
        routine_id: RoutineId::from("noop".to_string()),
    })
}

fn harness_with(rules: Vec<Rule>, actions: Actions) -> BaselineHarness {
    let mut routines = RoutinesConfig::new();
    routines.insert(
        RoutineId::from("routine".to_string()),
        Routine {
            name: "Routine".to_string(),
            rules,
            actions,
        },
    );
    BaselineHarness::new(GroupsConfig::new(), routines)
}

// ---------------------------------------------------------------------------
// B01: legacy defaults remain sensor/raw pulse and device/group level
// ---------------------------------------------------------------------------

#[test]
fn b01_legacy_trigger_mode_defaults() {
    let sensor: SensorRule = serde_json::from_value(json!({
        "state": { "value": true },
        "integration_id": "test",
        "device_id": "sensor",
    }))
    .expect("sensor rule should deserialize");
    assert_eq!(sensor.trigger_mode, TriggerMode::Pulse);

    let raw: RawRule = serde_json::from_value(json!({
        "path": "/payload/action",
        "operator": "gt",
        "value": 1,
        "integration_id": "test",
        "device_id": "sensor",
    }))
    .expect("raw rule should deserialize");
    assert_eq!(raw.trigger_mode, TriggerMode::Pulse);
    assert_eq!(raw.operator, RawRuleOperator::Gt);

    let device: DeviceRule = serde_json::from_value(json!({
        "power": true,
        "integration_id": "test",
        "device_id": "lamp",
    }))
    .expect("device rule should deserialize");
    assert_eq!(device.trigger_mode, TriggerMode::Level);

    let group: GroupRule = serde_json::from_value(json!({
        "group_id": "room",
        "power": true,
    }))
    .expect("group rule should deserialize");
    assert_eq!(group.trigger_mode, TriggerMode::Level);
}

// ---------------------------------------------------------------------------
// B02: a matching legacy all-level routine can match again on an unrelated
// eligible update. v2 must not acquire this behavior by default.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn b02_level_rule_retriggers_on_unrelated_update() {
    let rule = Rule::Device(DeviceRule {
        power: Some(true),
        scene: None,
        trigger_mode: TriggerMode::Level,
        device_ref: lamp_ref("lamp_a"),
    });
    let mut harness = harness_with(vec![rule], vec![noop_action()]);

    // Seed both devices first. New-device discovery alone does not dispatch.
    harness.report(&lamp_device("lamp_a", false)).await;
    harness.report(&lamp_device("lamp_b", false)).await;
    harness.take_actions();

    harness.report(&lamp_device("lamp_a", true)).await;
    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&1),
        "level rule should match when its own device turns on"
    );
    harness.take_actions();

    // An unrelated device update is still an eligible evaluation. The level
    // rule reads current state, so it matches again. This is the legacy
    // behavior v2 replaces with explicit transition triggers.
    harness.report(&lamp_device("lamp_b", true)).await;
    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&1),
        "legacy level rule re-fires on an unrelated eligible update"
    );
}

// ---------------------------------------------------------------------------
// B03: legacy mixed Any and multiple event-leaf fixtures preserve actual
// paired-bit behavior (condition_match, trigger_match) in the oracle.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn b03_mixed_any_combines_event_leaf_and_state_leaf_bits() {
    // child 1: event leaf (pulse on sensor a == true)
    // child 2: state leaf (level on lamp b power == true)
    let rule = Rule::Any(AnyRule {
        any: vec![
            Rule::Sensor(SensorRule {
                state: SensorDevice::Boolean { value: true },
                trigger_mode: TriggerMode::Pulse,
                device_ref: sensor_ref("sensor_a"),
            }),
            Rule::Device(DeviceRule {
                power: Some(true),
                scene: None,
                trigger_mode: TriggerMode::Level,
                device_ref: lamp_ref("lamp_b"),
            }),
        ],
    });
    let mut harness = harness_with(vec![rule], vec![noop_action()]);

    // Seed lamp_b as on. Discovery alone does not dispatch, but it makes the
    // state leaf's condition true.
    harness.report(&lamp_device("lamp_b", true)).await;
    harness.take_actions();

    // Report the event leaf's sensor as false (non-matching). The state leaf
    // still matches, so Any's trigger bit is true and the routine fires even
    // though no event leaf matched.
    harness.report(&sensor_device("sensor_a", false)).await;
    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&1),
        "state leaf inside Any can trigger without an event on the event leaf"
    );
    let status = harness
        .status_for(&RoutineId::from("routine".to_string()))
        .expect("status");
    assert!(status.will_trigger);
    harness.take_actions();

    // A second identical non-matching sensor report fires again, because the
    // state leaf is still true and pulse re-fires on every sensor update.
    harness.report(&sensor_device("sensor_a", false)).await;
    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&1),
        "mixed Any fires again because the state leaf remains true"
    );
}

// ---------------------------------------------------------------------------
// B04: Script expressions/truthiness and malformed rows are characterized
// separately from the proposed strict v2 contract.
// ---------------------------------------------------------------------------

#[test]
fn b04_script_truthiness_is_plain_javascript() {
    let mut engine = ScriptEngine::new();
    // v1 uses JavaScript `ToBoolean`, not three-valued logic.
    assert!(engine.eval_boolean("[]").unwrap());
    assert!(engine.eval_boolean("({})").unwrap());
    assert!(engine.eval_boolean("\"0\"").unwrap());
    assert!(engine.eval_boolean("\"false\"").unwrap());
    assert!(!engine.eval_boolean("0").unwrap());
    assert!(!engine.eval_boolean("\"\"").unwrap());
    assert!(!engine.eval_boolean("null").unwrap());
    assert!(!engine.eval_boolean("undefined").unwrap());
    // Non-expression scripts that fall through are silently interpreted.
    assert!(!engine.eval_boolean("var x = 1;").unwrap());
}

// P01 changes the P00 B04 expectation: malformed enabled rows are no longer
// silently decoded to an empty (always-false) routine. They are quarantined as
// non-runnable and their validation errors are surfaced through status reads.
#[tokio::test]
async fn b04_malformed_rows_are_quarantined_not_silently_empty() {
    let (event_tx, _rx) = mk_event_channel();
    let mut routines = Routines::new(RoutinesConfig::new(), event_tx);
    routines.load_config_rows(
        &[RoutineRow {
            id: "malformed".to_string(),
            name: "Malformed".to_string(),
            enabled: true,
            rules: json!({ "not": "a rule list" }),
            actions: json!(42),
            ..Default::default()
        }],
        &homectl_server::core::automation::ConfigCatalog::default(),
    );

    assert!(
        routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("malformed".to_string())),
        "malformed enabled row is quarantined"
    );

    let cli = homectl_server::core::automation_baseline::test_cli();
    let (device_tx, _device_rx) = mk_event_channel();
    let devices = homectl_server::core::devices::Devices::new(device_tx, &cli);
    let groups = homectl_server::core::groups::Groups::new(Default::default());
    routines.refresh_runtime_statuses(&devices, &groups, None);

    let status = routines
        .get_runtime_statuses()
        .0
        .get(&RoutineId::from("malformed".to_string()))
        .cloned()
        .expect("quarantined row is still visible in status reads");
    assert!(!status.will_trigger, "quarantined routines never run");
    assert!(!status.all_conditions_match);
    assert!(
        status
            .rules
            .iter()
            .all(|rule| rule.error.as_deref().is_some_and(|e| e.contains("/rules"))),
        "validation errors are surfaced instead of an empty rule list"
    );
}

#[test]
fn b04_script_rule_is_present_in_legacy_contract() {
    // Just pins the shape used by the v1 engine; v2 uses a function-body ABI.
    let rule = Rule::Script(ScriptRule {
        script: "true".to_string(),
    });
    let encoded = serde_json::to_value(&rule).unwrap();
    assert_eq!(encoded["script"], json!("true"));
}

// ---------------------------------------------------------------------------
// B05: legacy group scene/mirroring timing and source groups are captured.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn b05_group_scene_is_unanimous_or_unknown() {
    let mut groups = GroupsConfig::new();
    groups.insert(
        GroupId::from_str("room").unwrap(),
        GroupConfig {
            name: "Room".to_string(),
            devices: Some(vec![lamp_ref("a"), lamp_ref("b")]),
            groups: None,
            hidden: None,
        },
    );
    let mut routines = RoutinesConfig::new();
    let mut harness = BaselineHarness::new(groups, {
        routines.insert(
            RoutineId::from("unused".to_string()),
            Routine {
                name: "Unused".to_string(),
                rules: vec![],
                actions: vec![],
            },
        );
        routines
    });

    // Mixed scenes -> no unanimous group scene.
    harness
        .report(&lamp_device_with_scene("a", Some("day")))
        .await;
    harness
        .report(&lamp_device_with_scene("b", Some("night")))
        .await;
    let room = GroupId::from_str("room").unwrap();
    assert_eq!(
        harness
            .groups
            .get_group_scene_id(harness.devices.get_state(), &room),
        None,
        "mixed scenes report unknown"
    );

    // Unanimous scenes -> group scene id.
    harness
        .report(&lamp_device_with_scene("b", Some("day")))
        .await;
    assert_eq!(
        harness
            .groups
            .get_group_scene_id(harness.devices.get_state(), &room),
        Some(SceneId::from("day".to_string())),
        "unanimous scenes report the shared scene"
    );

    // Empty group -> no scene.
    let empty = GroupId::from_str("empty").unwrap();
    assert_eq!(
        harness
            .groups
            .get_group_scene_id(harness.devices.get_state(), &empty),
        None
    );
}

// ---------------------------------------------------------------------------
// E01: queue true then false before handling derived work. The first decision
// sees its own true frame and the second its false frame. P02 fixed the P00
// queue-order hazard by evaluating each internal update against a coherent
// view where the event source device is the event's `after` state.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e01_queued_pulse_reports_keep_their_own_frame() {
    let rule = Rule::Sensor(SensorRule {
        state: SensorDevice::Boolean { value: true },
        trigger_mode: TriggerMode::Pulse,
        device_ref: sensor_ref("button"),
    });
    let mut harness = harness_with(vec![rule], vec![noop_action()]);

    harness.queue_report(&sensor_device("button", true));
    harness.queue_report(&sensor_device("button", false));
    let processed = harness.flush().await;
    assert_eq!(processed, 2, "both queued reports are evaluated");

    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&1),
        "the first queued report sees its own true frame and fires; the second sees false"
    );
}

// ---------------------------------------------------------------------------
// E02: repeated identical sensor/button reports are distinct events and
// preserve pulse counts. They must not be deduplicated by value.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn e02_repeated_identical_reports_have_distinct_ids_and_pulses() {
    let rule = Rule::Sensor(SensorRule {
        state: SensorDevice::Boolean { value: true },
        trigger_mode: TriggerMode::Pulse,
        device_ref: sensor_ref("button"),
    });
    let mut harness = harness_with(vec![rule], vec![noop_action()]);

    harness.report(&sensor_device("button", true)).await;
    harness.report(&sensor_device("button", true)).await;

    assert_eq!(
        action_counts(harness.actions()).get("force_trigger_routine"),
        Some(&2),
        "identical repeated pulses both fire"
    );

    let ids = harness.event_ids();
    assert_eq!(ids.len(), 2, "two internal events were processed");
    assert_ne!(ids[0], ids[1], "identical reports have distinct event IDs");
}

/// The serializable replay fixture format round-trips from disk and replays
/// with no live sinks. This is the artifact later packages extend.
#[tokio::test]
async fn fixture_format_round_trips_and_replays() {
    let raw = include_str!("fixtures/baseline_pulse_framed.json");
    let fixture: ReplayFixture = serde_json::from_str(raw).expect("fixture should deserialize");

    assert_eq!(fixture.baseline_revision, BASELINE_REVISION);
    assert_eq!(fixture.id, "baseline_pulse_framed");

    let round_tripped = serde_json::to_string(&fixture).unwrap();
    let decoded: ReplayFixture = serde_json::from_str(&round_tripped).unwrap();
    assert_eq!(decoded.routines.len(), 1);
    assert_eq!(decoded.steps.len(), 3);

    let run = run_fixture(&fixture).await;
    assert_eq!(run.fixture_id, "baseline_pulse_framed");
    assert_eq!(run.steps.len(), 1, "one flush step");
    assert_eq!(
        run.steps[0].actions.len(),
        1,
        "E01 fix: the first queued report keeps its own true frame and fires"
    );
    assert_eq!(
        run.final_devices
            .0
            .get(&homectl_server::types::device::DeviceKey::new(
                integration(),
                device_id("button"),
            ))
            .and_then(|device| device.get_sensor_state())
            .cloned(),
        Some(SensorDevice::Boolean { value: false }),
        "final state is the last queued report"
    );
}
