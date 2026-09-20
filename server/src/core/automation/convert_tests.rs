use crate::core::automation::compile::ConfigCatalog;
use crate::core::automation::convert::{
    convert_routine, ConversionStatus, ConvertOptions, RoutineConversion,
};
use crate::db::config_queries::RoutineRow;
use crate::types::scene::SceneId;
use serde_json::{json, Value};

fn row(rules: Value, actions: Value) -> RoutineRow {
    RoutineRow {
        id: "routine".to_string(),
        name: "Routine".to_string(),
        enabled: true,
        semantics_version: 1,
        revision: 1,
        definition_v2: None,
        rules,
        actions,
    }
}

fn convert(rules: Value, actions: Value) -> RoutineConversion {
    convert_with(rules, actions, &ConvertOptions::default())
}

fn convert_with(rules: Value, actions: Value, options: &ConvertOptions) -> RoutineConversion {
    let mut catalog = ConfigCatalog::default();
    catalog = catalog.with_scene(SceneId::from("night".to_string()));
    catalog = catalog.with_scene(SceneId::from("bright".to_string()));
    catalog = catalog.with_group(crate::types::group::GroupId("living".to_string()));
    convert_routine(&row(rules, actions), &catalog, options)
}

fn definition_json(conversion: &RoutineConversion) -> Value {
    serde_json::to_value(conversion.converted_definition().expect("converted")).unwrap()
}

fn status_reasons(status: &ConversionStatus) -> Vec<String> {
    match status {
        ConversionStatus::NeedsManual { reasons } | ConversionStatus::Unsupported { reasons } => {
            reasons.clone()
        }
        other => panic!("expected a blocking status, got {other:?}"),
    }
}

fn reasons(conversion: &RoutineConversion) -> Vec<String> {
    status_reasons(&conversion.status)
}

fn cron_reasons(conversion: &crate::core::automation::convert::CronConversion) -> Vec<String> {
    status_reasons(&conversion.status)
}

#[test]
fn pulse_sensor_maps_to_report_trigger_with_value_condition() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["triggers"],
        json!([
            {
                "kind": "report",
                "id": "t1",
                "device": {"integration_id": "dummy", "device_id": "button"}
            }
        ])
    );
    assert_eq!(
        definition["condition"],
        json!({
            "kind": "comparison",
            "source": {
                "kind": "device",
                "device": {"integration_id": "dummy", "device_id": "button"},
                "path": "/value"
            },
            "operator": "eq",
            "value": true
        })
    );
    assert_eq!(
        definition["program"],
        json!({
            "kind": "native",
            "steps": [{
                "action": "activate_scene",
                "id": "a1",
                "scene_id": "night",
                "targets": {},
                "use_scene_transition": false
            }]
        })
    );
}

#[test]
fn edge_sensor_and_level_guard_map_to_predicate_transition_and_all_condition() {
    let conversion = convert(
        json!([
            {
                "integration_id": "dummy",
                "device_id": "button",
                "state": {"value": "press"},
                "trigger_mode": "edge"
            },
            {"integration_id": "dummy", "device_id": "lamp", "power": true}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["triggers"][0]["kind"], "predicate_transition");
    assert_eq!(definition["triggers"][0]["predicate"]["value"], "press");
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(conditions.len(), 2);
    assert_eq!(conditions[0]["value"], "press");
    assert_eq!(conditions[1]["source"]["path"], "/power");
    assert_eq!(conditions[1]["value"], true);
}

#[test]
fn device_power_pulse_and_edge_map_to_state_change_modes() {
    let pulse = convert(
        json!([{"integration_id": "dummy", "device_id": "lamp", "power": true, "trigger_mode": "pulse"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );
    let definition = definition_json(&pulse);
    assert_eq!(definition["triggers"][0]["kind"], "state_change");
    assert_eq!(definition["triggers"][0]["mode"], "level");
    match &pulse.status {
        ConversionStatus::Converted { notes, .. } => {
            assert!(notes.iter().any(|note| note.contains("state_change")));
        }
        other => panic!("expected converted, got {other:?}"),
    }

    let edge = convert(
        json!([{"integration_id": "dummy", "device_id": "lamp", "power": true, "trigger_mode": "edge"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );
    let definition = definition_json(&edge);
    assert_eq!(definition["triggers"][0]["mode"], "transition");
}

#[test]
fn device_scene_level_guard_maps_to_scene_id_condition() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "motion", "state": {"value": true}},
            {"integration_id": "dummy", "device_id": "lamp", "scene": "normal"}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(conditions[1]["source"]["path"], "/scene_id");
    assert_eq!(conditions[1]["value"], "normal");
    assert_eq!(conditions[1]["operator"], "eq");
}

#[test]
fn device_scene_pulse_and_edge_map_to_event_triggers() {
    let pulse = convert(
        json!([{"integration_id": "dummy", "device_id": "lamp", "scene": "normal", "trigger_mode": "pulse"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );
    let definition = definition_json(&pulse);
    assert_eq!(definition["triggers"][0]["kind"], "report");
    assert_eq!(definition["condition"]["source"]["path"], "/scene_id");

    let edge = convert(
        json!([{"integration_id": "dummy", "device_id": "lamp", "scene": "normal", "trigger_mode": "edge"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );
    let definition = definition_json(&edge);
    assert_eq!(definition["triggers"][0]["kind"], "predicate_transition");
}

#[test]
fn device_scene_and_power_constraints_combine() {
    let conversion = convert(
        json!([{
            "integration_id": "dummy",
            "device_id": "lamp",
            "scene": "normal",
            "power": false,
            "trigger_mode": "pulse"
        }]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["triggers"][0]["kind"], "report");
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(conditions.len(), 2);
    assert_eq!(conditions[0]["source"]["path"], "/scene_id");
    assert_eq!(conditions[1]["source"]["path"], "/power");
    assert_eq!(conditions[1]["value"], false);
}

#[test]
fn group_level_guard_maps_to_group_condition() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}},
            {"group_id": "living", "power": true}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(
        conditions[1],
        json!({"kind": "group", "group_id": "living", "quantifier": "all", "power": true})
    );
}

#[test]
fn any_of_level_rules_maps_to_any_condition() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}},
            {
                "any": [
                    {"integration_id": "dummy", "device_id": "lamp", "power": true},
                    {"group_id": "living", "power": true}
                ]
            }
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(conditions[1]["kind"], "any");
    assert_eq!(conditions[1]["conditions"].as_array().unwrap().len(), 2);
}

#[test]
fn any_of_event_leaves_maps_to_multiple_triggers_and_any_condition() {
    let conversion = convert(
        json!([{
            "any": [
                {"integration_id": "dummy", "device_id": "a", "state": {"value": "off_press"}},
                {"integration_id": "dummy", "device_id": "b", "state": {"value": "off_press"}}
            ]
        }]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let triggers = definition["triggers"].as_array().unwrap();
    assert_eq!(triggers.len(), 2);
    assert_eq!(triggers[0]["device"]["device_id"], "a");
    assert_eq!(triggers[1]["device"]["device_id"], "b");
    assert_eq!(definition["condition"]["kind"], "any");
    assert_eq!(
        definition["condition"]["conditions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn any_of_edge_leaves_maps_to_predicate_transitions() {
    let conversion = convert(
        json!([{
            "any": [
                {"integration_id": "dummy", "device_id": "a", "state": {"value": "on_press"}, "trigger_mode": "edge"},
                {"integration_id": "dummy", "device_id": "a", "state": {"value": "up_press"}, "trigger_mode": "edge"}
            ]
        }]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let triggers = definition["triggers"].as_array().unwrap();
    assert_eq!(triggers.len(), 2);
    assert_eq!(triggers[0]["kind"], "predicate_transition");
    assert_eq!(triggers[1]["kind"], "predicate_transition");
}

#[test]
fn any_with_a_level_child_contributes_only_its_condition() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}},
            {
                "any": [
                    {"integration_id": "dummy", "device_id": "a", "state": {"value": true}},
                    {"integration_id": "dummy", "device_id": "lamp", "power": true}
                ]
            }
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    let triggers = definition["triggers"].as_array().unwrap();
    assert_eq!(triggers.len(), 1, "only the gating pulse rule triggers");
    assert_eq!(triggers[0]["kind"], "report");
    let conditions = definition["condition"]["conditions"].as_array().unwrap();
    assert_eq!(conditions[1]["kind"], "any");
}

#[test]
fn single_child_any_unwraps_to_the_child() {
    let conversion = convert(
        json!([{
            "any": [
                {"integration_id": "dummy", "device_id": "a", "state": {"value": "down_press"}}
            ]
        }]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["triggers"].as_array().unwrap().len(), 1);
    assert_eq!(definition["condition"]["kind"], "comparison");
    assert_eq!(definition["condition"]["value"], "down_press");
}

#[test]
fn any_of_events_plus_another_event_rule_needs_manual() {
    let conversion = convert(
        json!([
            {
                "any": [
                    {"integration_id": "dummy", "device_id": "a", "state": {"value": true}},
                    {"integration_id": "dummy", "device_id": "b", "state": {"value": true}}
                ]
            },
            {"integration_id": "dummy", "device_id": "button", "state": {"value": true}}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("top-level event rules"));
}

#[test]
fn level_only_routine_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "lamp", "power": true}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("level-only routine"));
}

#[test]
fn multiple_event_leaves_need_manual() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "a", "state": {"value": true}},
            {"integration_id": "dummy", "device_id": "b", "state": {"value": true}}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("top-level event rules"));
}

#[test]
fn raw_rules_are_unsupported() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "sensor", "path": "/battery", "operator": "gt", "value": 10}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("raw rules"));
}

#[test]
fn script_rules_are_unsupported() {
    let conversion = convert(
        json!([{"script": "return true;"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("script rules"));
}

#[test]
fn numeric_sensor_rule_is_unsupported() {
    let conversion = convert(
        json!([
            {"integration_id": "dummy", "device_id": "sensor", "state": {"value": 42}}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("never matched"));
}

#[test]
fn cycle_scenes_maps_entries_detection_and_rollout() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "CycleScenes",
            "nowrap": true,
            "group_keys": ["living"],
            "rollout": "spatial",
            "rollout_source_device_key": "__homectl_runtime__/triggering_device",
            "rollout_duration_ms": 1500,
            "scenes": [
                {"scene_id": "bright", "group_keys": ["living"]},
                {"scene_id": "night"}
            ]
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["program"]["steps"][0],
        json!({
            "action": "cycle_scenes",
            "id": "a1",
            "scenes": [
                {
                    "scene_id": "bright",
                    "targets": {"groups": ["living"]},
                    "use_scene_transition": false
                },
                {
                    "scene_id": "night",
                    "targets": {},
                    "use_scene_transition": false
                }
            ],
            "nowrap": true,
            "detection": {"groups": ["living"]},
            "rollout": {
                "style": "spatial",
                "source": {"kind": "triggering_device"},
                "duration_ms": 1500
            }
        })
    );
}

#[test]
fn cycle_scenes_with_mirror_entry_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "CycleScenes",
            "scenes": [{"scene_id": "night", "mirror_from_group": "living"}]
        }]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("mirror_from_group"));
}

#[test]
fn cycle_scenes_with_source_groups_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "CycleScenes",
            "include_source_groups": true,
            "scenes": [{"scene_id": "night"}]
        }]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("include_source_groups"));
}

#[test]
fn activate_scene_mirror_maps_to_group_active_selection() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "mirror_from_group": "living"
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["program"]["steps"][0],
        json!({
            "action": "activate_scene",
            "id": "a1",
            "select": {"kind": "group_active", "group_id": "living", "fallback_scene_id": "night"},
            "targets": {},
            "use_scene_transition": false
        })
    );
}

#[test]
fn activate_scene_with_explicit_targets_maps_to_targets() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "device_keys": ["dummy/lamp"],
            "group_keys": ["living"]
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["program"]["steps"][0]["targets"],
        json!({
            "devices": [{"integration_id": "dummy", "device_id": "lamp"}],
            "groups": ["living"]
        })
    );
}

#[test]
fn activate_scene_with_source_groups_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "include_source_groups": true
        }]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("include_source_groups"));
}

#[test]
fn activate_scene_rollout_maps_with_triggering_device_source() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "rollout": "spatial",
            "rollout_source_device_key": "__homectl_runtime__/triggering_device",
            "rollout_duration_ms": 1500
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["program"]["steps"][0]["rollout"],
        json!({
            "style": "spatial",
            "source": {"kind": "triggering_device"},
            "duration_ms": 1500
        })
    );
}

#[test]
fn activate_scene_rollout_maps_with_fixed_device_source() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "rollout": "spatial",
            "rollout_source_device_key": "zigbee2mqtt/0x001788010bd7ec37",
            "rollout_duration_ms": 1500
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(
        definition["program"]["steps"][0]["rollout"]["source"],
        json!({
            "kind": "device",
            "device": {"integration_id": "zigbee2mqtt", "device_id": "0x001788010bd7ec37"}
        })
    );
}

#[test]
fn activate_scene_transition_seconds_map_to_milliseconds() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{
            "action": "ActivateScene",
            "scene_id": "night",
            "transition": 0.25,
            "use_scene_transition": true
        }]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["program"]["steps"][0]["transition_ms"], 250);
    assert_eq!(
        definition["program"]["steps"][0]["use_scene_transition"],
        true
    );
}

#[test]
fn dim_maps_targets_and_default_step() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "Dim", "device_keys": ["dummy/lamp"]}]),
    );

    let definition = definition_json(&conversion);
    let step = &definition["program"]["steps"][0];
    assert_eq!(step["action"], "dim");
    assert_eq!(
        step["targets"],
        json!({"devices": [{"integration_id": "dummy", "device_id": "lamp"}]})
    );
    let value = step["step"].as_f64().expect("numeric step");
    assert!((value - 0.1).abs() < 1e-6, "unexpected step {value}");
}

#[test]
fn dim_without_targets_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "Dim", "step": 0.5}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("no target"));
}

#[test]
fn rule_without_state_or_power_is_unsupported() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button"}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("neither power nor scene"));
}

#[test]
fn malformed_rule_json_is_unsupported() {
    let conversion = convert(
        json!(["not a rule"]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("does not validate"));
}

#[test]
fn unknown_scene_is_reported_by_the_compiler() {
    let conversion = convert_routine(
        &row(
            json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
            json!([{"action": "ActivateScene", "scene_id": "missing"}]),
        ),
        &ConfigCatalog::default(),
        &ConvertOptions::default(),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("does not compile"));
    assert!(reasons(&conversion)[0].contains("Unknown scene 'missing'"));
}

#[test]
fn conversion_is_deterministic() {
    let rules = json!([
        {"integration_id": "dummy", "device_id": "button", "state": {"value": true}},
        {"integration_id": "dummy", "device_id": "lamp", "power": true}
    ]);
    let actions = json!([{"action": "ActivateScene", "scene_id": "night"}]);
    let first = definition_json(&convert(rules.clone(), actions.clone()));
    let second = definition_json(&convert(rules, actions));
    assert_eq!(first, second);
}

#[test]
fn v2_rows_are_never_rewritten() {
    let mut stored = row(json!([]), json!([]));
    stored.semantics_version = 2;
    stored.definition_v2 =
        Some(json!({"triggers": [], "program": {"kind": "native", "steps": []}}));

    let conversion = convert_routine(
        &stored,
        &ConfigCatalog::default(),
        &ConvertOptions::default(),
    );

    assert!(matches!(conversion.status, ConversionStatus::AlreadyV2));
    assert_eq!(conversion.id, "routine");
}

#[test]
fn converted_definition_carries_the_compiler_fingerprint() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    match &conversion.status {
        ConversionStatus::Converted { fingerprint, .. } => {
            assert!(!fingerprint.is_empty());
        }
        other => panic!("expected converted, got {other:?}"),
    }
}

#[test]
fn text_sensor_state_maps_to_string_equality() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "switch", "state": {"value": "press"}}]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["condition"]["value"], "press");
}

fn timer_options() -> ConvertOptions {
    ConvertOptions {
        timer_integrations: std::collections::BTreeSet::from(["entryway_timer".to_string()]),
        cron_timezone: None,
    }
}

#[test]
fn custom_action_on_timer_integration_maps_to_replace_timer() {
    let conversion = convert_with(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "Custom", "integration_id": "entryway_timer", "payload": "300000"}]),
        &timer_options(),
    );

    let definition = definition_json(&conversion);
    assert_eq!(definition["program"]["steps"][0]["action"], "replace_timer");
    assert_eq!(definition["program"]["steps"][0]["timer"], "entryway_timer");
    assert_eq!(definition["program"]["steps"][0]["delay_ms"], 300000);
}

#[test]
fn custom_action_on_other_integration_stays_manual() {
    let conversion = convert_with(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "Custom", "integration_id": "z2m", "payload": "brightness 50"}]),
        &timer_options(),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("no v2 native equivalent"));
}

#[test]
fn custom_timer_payload_must_be_numeric() {
    let conversion = convert_with(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "Custom", "integration_id": "entryway_timer", "payload": "soon"}]),
        &timer_options(),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("non-numeric payload"));
}

#[test]
fn timer_device_sensor_rule_reports_precise_reason() {
    let conversion = convert_with(
        json!([
            {"integration_id": "dummy", "device_id": "motion", "state": {"value": true}},
            {"integration_id": "entryway_timer", "device_id": "timer", "state": {"value": false}, "trigger": "level"}
        ]),
        json!([{"action": "ActivateScene", "scene_id": "night"}]),
        &timer_options(),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("synthetic device state"));
}

fn cron_input() -> crate::core::automation::convert::CronScheduleInput {
    crate::core::automation::convert::CronScheduleInput {
        integration_id: "morning".to_string(),
        schedule_id: "wake".to_string(),
        name: "Morning".to_string(),
        schedule: "30 6 * * 1-5".to_string(),
        action: serde_json::from_value(json!({"action": "ActivateScene", "scene_id": "night"}))
            .unwrap(),
        init_enabled: true,
        integration_enabled: true,
    }
}

fn convert_cron(
    input: &crate::core::automation::convert::CronScheduleInput,
    timezone: Option<&str>,
) -> crate::core::automation::convert::CronConversion {
    let mut catalog = ConfigCatalog::default();
    catalog = catalog.with_scene(SceneId::from("night".to_string()));
    crate::core::automation::convert::convert_cron_schedule(
        input,
        &catalog,
        &ConvertOptions {
            timer_integrations: std::collections::BTreeSet::new(),
            cron_timezone: timezone.map(str::to_string),
        },
        &std::collections::BTreeSet::new(),
    )
}

#[test]
fn cron_schedule_needs_timezone_before_conversion() {
    let conversion = convert_cron(&cron_input(), None);

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(cron_reasons(&conversion)[0].contains("--cron-timezone"));
}

#[test]
fn cron_schedule_converts_with_seconds_and_explicit_timezone() {
    let conversion = convert_cron(&cron_input(), Some("Europe/Helsinki"));

    let definition = conversion.converted_definition().expect("converted");
    let value = serde_json::to_value(definition).unwrap();
    assert_eq!(value["triggers"][0]["kind"], "schedule");
    assert_eq!(value["triggers"][0]["schedule"]["cron"], "0 30 6 * * 1-5");
    assert_eq!(
        value["triggers"][0]["schedule"]["timezone"],
        "Europe/Helsinki"
    );
    assert_eq!(conversion.routine_id, "cron-morning-wake");
}

#[test]
fn six_field_cron_expressions_are_kept() {
    let mut input = cron_input();
    input.schedule = "15 30 6 * * 1-5".to_string();
    let conversion = convert_cron(&input, Some("UTC"));

    let definition = conversion.converted_definition().expect("converted");
    let value = serde_json::to_value(definition).unwrap();
    assert_eq!(value["triggers"][0]["schedule"]["cron"], "15 30 6 * * 1-5");
}

#[test]
fn cron_disabled_flag_survives_conversion() {
    let mut input = cron_input();
    input.init_enabled = false;
    let conversion = convert_cron(&input, Some("UTC"));

    assert!(!conversion.enabled);
    assert!(conversion.is_converted());
}

#[test]
fn cron_routine_id_collision_is_unsupported() {
    let mut catalog = ConfigCatalog::default();
    catalog = catalog.with_scene(SceneId::from("night".to_string()));
    let conversion = crate::core::automation::convert::convert_cron_schedule(
        &cron_input(),
        &catalog,
        &ConvertOptions {
            timer_integrations: std::collections::BTreeSet::new(),
            cron_timezone: Some("UTC".to_string()),
        },
        &std::collections::BTreeSet::from(["cron-morning-wake".to_string()]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::Unsupported { .. }
    ));
    assert!(cron_reasons(&conversion)[0].contains("already exists"));
}

#[test]
fn cron_config_parses_schedules_with_init_enabled_default_true() {
    let schedules = crate::core::automation::convert::parse_cron_schedules(
        "morning",
        true,
        &json!({
            "schedules": {
                "wake": {"name": "Wake", "schedule": "30 6 * * *", "action": {"action": "ActivateScene", "scene_id": "night"}},
                "sleep": {"name": "Sleep", "schedule": "0 23 * * *", "action": {"action": "ActivateScene", "scene_id": "night"}, "init_enabled": false}
            }
        }),
    )
    .expect("parses");

    assert_eq!(schedules.len(), 2);
    assert!(schedules
        .iter()
        .all(|schedule| schedule.integration_enabled));
    assert!(
        schedules
            .iter()
            .find(|s| s.schedule_id == "wake")
            .unwrap()
            .init_enabled
    );
    assert!(
        !schedules
            .iter()
            .find(|s| s.schedule_id == "sleep")
            .unwrap()
            .init_enabled
    );
}

#[test]
fn malformed_cron_config_reports_unsupported() {
    let error = crate::core::automation::convert::parse_cron_schedules(
        "morning",
        true,
        &json!({"schedules": {"wake": {"name": "Wake"}}}),
    )
    .expect_err("missing schedule/action");

    assert!(error.contains("does not parse"));
}
