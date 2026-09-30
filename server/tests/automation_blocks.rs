use homectl_server::core::automation::{self, blocks, ConfigCatalog};
use homectl_server::db::config_queries::ConfigExport;
use homectl_server::types::automation_block::AutomationBlock;
use serde_json::{json, Value};

fn block(id: &str, kind: &str, body: Value) -> AutomationBlock {
    serde_json::from_value(json!({"id":id,"name":id,"kind":kind,"inputs":{"room":{"label":"Room","kind":{"kind":"group"}}},"body":body})).unwrap()
}
fn catalog(blocks: Vec<AutomationBlock>) -> ConfigCatalog {
    let export: ConfigExport=serde_json::from_value(json!({"version":1,"core":{},"integrations":[],"groups":[{"id":"room","name":"Room","hidden":false,"devices":[],"linked_groups":[]}],"scenes":[{"id":"normal","name":"Normal","hidden":false,"script":null,"device_states":{},"group_states":{}}],"routines":[],"blocks":blocks,"floorplan":null,"dashboard_layouts":[],"dashboard_widgets":[]})).unwrap();
    ConfigCatalog::from_export(&export)
}
fn definition(steps: Value) -> Value {
    json!({"triggers":[{"kind":"manual","id":"manual"}],"program":{"kind":"native","steps":steps}})
}
fn call(id: &str, block: &str) -> Value {
    json!({"action":"call_block","id":id,"block_id":block,"inputs":{"room":"room"}})
}

#[test]
fn action_block_expands_with_typed_inputs_and_distinct_callsite_ids() {
    let block = block(
        "normal",
        "action",
        json!([{"action":"activate_scene","id":"activate","scene_id":"normal","targets":{"groups":[{"$input":"room"}]},"rollout":{"style":"spatial","source":{"kind":"triggering_device"},"duration_ms":1500}}]),
    );
    let compiled = automation::compile_definition_value(
        &definition(json!([call("first", "normal"), call("second", "normal")])),
        &catalog(vec![block]),
    )
    .unwrap();
    let expanded = serde_json::to_value(compiled.normalized).unwrap();
    let first = &expanded["program"]["steps"][0]["branches"][0]["steps"][0];
    let second = &expanded["program"]["steps"][1]["branches"][0]["steps"][0];
    assert_eq!(first["targets"]["groups"], json!(["room"]));
    assert_eq!(first["rollout"]["source"]["kind"], "triggering_device");
    assert_ne!(first["id"], second["id"]);
    assert!(first["id"].as_str().unwrap().contains("block:normal@1"));
}

#[test]
fn condition_block_expands_in_guards_branches_and_trigger_predicates() {
    let block = block(
        "off",
        "condition",
        json!({"kind":"group","group_id":{"$input":"room"},"quantifier":"all","power":false}),
    );
    let check = json!({"kind":"block","block_id":"off","inputs":{"room":"room"}});
    let def = json!({"triggers":[{"kind":"predicate_transition","id":"trigger","predicate":check}],"condition":check,"program":{"kind":"native","steps":[{"action":"choose","id":"choice","branches":[{"id":"branch","condition":check,"steps":[{"action":"activate_scene","id":"activate","scene_id":"normal","targets":{"groups":["room"]}}]}]}]}});
    let compiled = automation::compile_definition_value(&def, &catalog(vec![block])).unwrap();
    assert!(compiled.dependencies.iter().any(|r| matches!(
        r,
        homectl_server::core::automation::compile::ResolvedReference::Group(_)
    )));
    let expanded = serde_json::to_value(compiled.normalized).unwrap();
    assert_eq!(expanded["condition"]["group_id"], "room");
    assert_eq!(
        expanded["program"]["steps"][0]["branches"][0]["condition"]["kind"],
        "group"
    );
}

#[test]
fn missing_extra_wrong_typed_and_unknown_entity_inputs_are_rejected() {
    let block = block(
        "off",
        "condition",
        json!({"kind":"group","group_id":{"$input":"room"},"quantifier":"all","power":false}),
    );
    let catalog = catalog(vec![block]);
    for inputs in [
        json!({}),
        json!({"room":true}),
        json!({"room":"missing"}),
        json!({"room":"room","extra":1}),
    ] {
        let mut def = definition(json!([]));
        def["condition"] = json!({"kind":"block","block_id":"off","inputs":inputs});
        assert!(
            automation::compile_definition_value(&def, &catalog).is_err(),
            "{inputs}"
        );
    }
}

#[test]
fn nested_blocks_expand_and_recursion_wrong_kind_and_unknown_blocks_fail() {
    let inner = block(
        "inner",
        "action",
        json!([{"action":"activate_scene","id":"activate","scene_id":"normal","targets":{"groups":[{"$input":"room"}]}}]),
    );
    let outer = block(
        "outer",
        "action",
        json!([{"action":"call_block","id":"nested","block_id":"inner","inputs":{"room":{"$input":"room"}}}]),
    );
    let mut catalog = catalog(vec![inner, outer]);
    assert!(automation::compile_definition_value(
        &definition(json!([call("call", "outer")])),
        &catalog
    )
    .is_ok());
    catalog.blocks.get_mut("inner").unwrap().body = json!([call("cycle", "outer")]);
    assert!(blocks::validate_catalog(&catalog)
        .unwrap_err()
        .message
        .contains("Recursive"));
    assert!(automation::compile_definition_value(
        &definition(json!([call("call", "missing")])),
        &catalog
    )
    .is_err());
    let mut def = definition(json!([]));
    def["condition"] = json!({"kind":"block","block_id":"outer","inputs":{"room":"room"}});
    assert!(automation::compile_definition_value(&def, &catalog).is_err());
}

#[test]
fn expansion_respects_native_action_limits_and_rejects_private_state() {
    let large=block("large","action",json!((0..64).map(|i| json!({"action":"activate_scene","id":format!("a{i}"),"scene_id":"normal","targets":{"groups":[{"$input":"room"}]}})).collect::<Vec<_>>()));
    assert!(automation::compile_definition_value(
        &definition(json!([call("call", "large")])),
        &catalog(vec![large])
    )
    .is_err());
    let timer = block(
        "timer",
        "action",
        json!([{"action":"replace_timer","id":"timer","timer":"off","delay_ms":1000}]),
    );
    assert!(blocks::validate_block(&timer).is_err());
}

#[test]
fn defaults_work_and_parameter_substitution_never_interpolates_strings() {
    let mut block = block(
        "normal",
        "action",
        json!([{"action":"activate_scene","id":"$input:room","scene_id":"normal","targets":{"groups":[{"$input":"room"}]}}]),
    );
    block.inputs.get_mut("room").unwrap().default = Some(json!("room"));
    let mut invocation = call("call", "normal");
    invocation["inputs"] = json!({});
    let expanded =
        blocks::expand_definition(&definition(json!([invocation])), &catalog(vec![block])).unwrap();
    assert!(
        expanded["program"]["steps"][0]["branches"][0]["steps"][0]["id"]
            .as_str()
            .unwrap()
            .ends_with("$input:room")
    );
}

#[test]
fn original_node_ids_remain_unique_and_empty_ids_cannot_be_hidden_by_prefixes() {
    let good = block(
        "good",
        "action",
        json!([{"action":"activate_scene","id":"activate","scene_id":"normal","targets":{"groups":[{"$input":"room"}]}}]),
    );
    let other = AutomationBlock {
        id: "other".into(),
        ..good.clone()
    };
    assert!(automation::compile_definition_value(
        &definition(json!([call("same", "good"), call("same", "other")])),
        &catalog(vec![good.clone(), other])
    )
    .is_err());
    let empty = AutomationBlock {
        body: json!([{"action":"activate_scene","id":"","scene_id":"normal","targets":{"groups":[{"$input":"room"}]}}]),
        ..good
    };
    assert!(automation::compile_definition_value(
        &definition(json!([call("call", "good")])),
        &catalog(vec![empty])
    )
    .is_err());
}

#[test]
fn catalog_rejects_invalid_unused_definitions_and_limits() {
    for body in [
        json!([]),
        json!([{"action":"dim","id":"dim","step":2.0,"targets":{"groups":[{"$input":"room"}]}}]),
        json!([{"action":"activate_scene","id":"activate","scene_id":"missing","targets":{"groups":[{"$input":"room"}]}}]),
    ] {
        assert!(
            blocks::validate_catalog(&catalog(vec![block("invalid", "action", body)])).is_err()
        );
    }
    let off = block("off", "condition", json!({"kind":"all","conditions":[]}));
    assert!(blocks::validate_catalog(&catalog(vec![off])).is_err());
}

#[test]
fn calls_have_fixed_targets_and_dependency_inspection_ignores_literal_operands() {
    let mut dynamic = block(
        "dynamic",
        "action",
        json!([{"action":"call_block","id":"call","block_id":{"$input":"callee"},"inputs":{}}]),
    );
    dynamic.inputs.insert(
        "callee".into(),
        serde_json::from_value(
            json!({"label":"Callee","kind":{"kind":"string"},"default":"existing"}),
        )
        .unwrap(),
    );
    assert!(blocks::validate_block(&dynamic)
        .unwrap_err()
        .message
        .contains("fixed block"));
    let operand = json!({"kind":"comparison","source":{"kind":"helper","helper":"payload"},"operator":"eq","value":{"kind":"block","block_id":"literal","inputs":{}}});
    assert!(!blocks::references(&operand, "literal"));
    assert!(blocks::references(
        &json!({"triggers":[{"kind":"predicate_transition","predicate":{"kind":"block","block_id":"real","inputs":{}}}]}),
        "real"
    ));
}
