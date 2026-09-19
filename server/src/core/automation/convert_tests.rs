use crate::core::automation::compile::ConfigCatalog;
use crate::core::automation::convert::{convert_routine, ConversionStatus, RoutineConversion};
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
    let mut catalog = ConfigCatalog::default();
    catalog = catalog.with_scene(SceneId::from("night".to_string()));
    catalog = catalog.with_scene(SceneId::from("bright".to_string()));
    catalog = catalog.with_group(crate::types::group::GroupId("living".to_string()));
    convert_routine(&row(rules, actions), &catalog)
}

fn definition_json(conversion: &RoutineConversion) -> Value {
    serde_json::to_value(conversion.converted_definition().expect("converted")).unwrap()
}

fn reasons(conversion: &RoutineConversion) -> Vec<String> {
    match &conversion.status {
        ConversionStatus::NeedsManual { reasons } | ConversionStatus::Unsupported { reasons } => {
            reasons.clone()
        }
        other => panic!("expected a blocking status, got {other:?}"),
    }
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
                "targets": {}
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
fn any_containing_an_event_leaf_is_unsupported() {
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
        ConversionStatus::Unsupported { .. }
    ));
    assert!(reasons(&conversion)[0].contains("any rule contains an event leaf"));
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
    assert!(reasons(&conversion)[0].contains("multiple event leaves"));
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
fn cycle_scenes_needs_manual() {
    let conversion = convert(
        json!([{"integration_id": "dummy", "device_id": "button", "state": {"value": true}}]),
        json!([{"action": "CycleScenes", "scenes": [{"scene_id": "night"}]}]),
    );

    assert!(matches!(
        conversion.status,
        ConversionStatus::NeedsManual { .. }
    ));
    assert!(reasons(&conversion)[0].contains("cycle_scenes"));
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
            "targets": {}
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

    let conversion = convert_routine(&stored, &ConfigCatalog::default());

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
