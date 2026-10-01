//! Reuse contracts through the real supervised worker, with no device commands.
use homectl_server::{
    core::{
        automation::{self, reuse, ConfigCatalog},
        js_worker::{JsWorkerPool, SupervisorConfig},
    },
    db::config_queries::ConfigExport,
    types::{
        automation_block::AutomationBlock,
        automation_definition::{ConditionExpr, NativeAction, Program, ScriptSpec},
    },
};
use serde_json::json;
use std::{path::PathBuf, time::Duration};

async fn pool() -> JsWorkerPool {
    JsWorkerPool::new(SupervisorConfig {
        worker_binary: Some(PathBuf::from(env!("CARGO_BIN_EXE_script-worker"))),
        workers: 1,
        invocation_timeout: Duration::from_secs(2),
        ..Default::default()
    })
    .await
    .unwrap()
}
fn function(id: &str, body: &str, functions: Vec<&str>) -> AutomationBlock {
    serde_json::from_value(json!({"id":id,"name":id,"kind":"function","inputs":{"value":{"label":"Value","kind":{"kind":"number"}},"factor":{"label":"Factor","kind":{"kind":"number"},"default":2}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":body,"functions":functions,"declarations":[],"limits_profile":"default"},"output":{"kind":"number"}}})).unwrap()
}
fn spec(body: &str, functions: Vec<&str>) -> ScriptSpec {
    serde_json::from_value(json!({"api_version":1,"source_body":body,"functions":functions,"declarations":[],"limits_profile":"default"})).unwrap()
}
fn empty_config(blocks: Vec<AutomationBlock>) -> ConfigExport {
    serde_json::from_value(json!({"version":1,"core":homectl_server::db::config_queries::CoreConfigRow::default(),"integrations":[],"groups":[],"scenes":[],"routines":[],"blocks":blocks,"floorplan":null,"dashboard_layouts":[],"dashboard_widgets":[]})).unwrap()
}
fn catalog(blocks: Vec<AutomationBlock>) -> ConfigCatalog {
    ConfigCatalog::from_export(&empty_config(blocks))
}

#[tokio::test]
async fn shared_functions_validate_arguments_outputs_and_fresh_realms() {
    let mut scale=function("scale","globalThis.calls=(globalThis.calls||0)+1; return inputs.value * inputs.factor + globalThis.calls;",vec![]);
    let catalog = catalog(vec![scale.clone()]);
    let pool = pool().await;
    let body = reuse::resolve_spec(
        &spec(
            "return api.functions.call('scale',{value:3});",
            vec!["scale"],
        ),
        &catalog,
    )
    .unwrap()
    .source_body;
    assert_eq!(pool.execute(&body, json!({})).await.unwrap(), json!(7));
    assert_eq!(
        pool.execute(&body, json!({})).await.unwrap(),
        json!(7),
        "fresh realm resets function globals"
    );
    for call in [
        "api.functions.call('scale',{value:'not a number'})",
        "api.functions.call('scale',{value:1,other:2})",
        "api.functions.call('missing',{value:1})",
    ] {
        let body = reuse::resolve_spec(&spec(&format!("return {call};"), vec!["scale"]), &catalog)
            .unwrap()
            .source_body;
        assert!(
            pool.execute(&body, json!({})).await.is_err(),
            "invalid call {call}"
        );
    }
    scale.body["spec"]["source_body"] = json!("return 'wrong output';");
    let catalog = ConfigCatalog::from_export(&empty_config(vec![scale]));
    let body = reuse::resolve_spec(
        &spec(
            "return api.functions.call('scale',{value:3});",
            vec!["scale"],
        ),
        &catalog,
    )
    .unwrap()
    .source_body;
    assert!(pool.execute(&body, json!({})).await.is_err());
}

#[test]
fn function_dependency_cycles_missing_dependencies_and_input_schemas_are_rejected() {
    let a = function("a", "return inputs.value;", vec!["b"]);
    let b = function("b", "return inputs.value;", vec!["a"]);
    assert!(automation::blocks::validate_catalog(&catalog(vec![a, b]))
        .unwrap_err()
        .to_string()
        .contains("cycle"));
    assert!(reuse::resolve_spec(&spec("return 0;", vec!["missing"]), &catalog(vec![])).is_err());
    let mut invalid = function("a", "return 0;", vec![]);
    invalid.inputs.get_mut("value").unwrap().default = Some(json!("bad"));
    assert!(automation::blocks::validate_block(&invalid).is_err());
}

#[tokio::test]
async fn scripted_action_block_preserves_arguments_as_data_and_returns_planned_actions() {
    let block:AutomationBlock=serde_json::from_value(json!({"id":"power","name":"Power","kind":"action","inputs":{"device":{"label":"Device","kind":{"kind":"device"}},"power":{"label":"Power","kind":{"kind":"boolean"},"default":true},"text":{"label":"Text","kind":{"kind":"string"}}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return {actions:[api.actions.setPower({device:inputs.device,power:inputs.power})],next_state:{text:inputs.text}};","declarations":[],"limits_profile":"default"}}})).unwrap();
    let catalog = catalog(vec![block]);
    let definition = json!({"triggers":[{"kind":"manual","id":"start"}],"program":{"kind":"native","steps":[{"action":"call_block","id":"call","block_id":"power","inputs":{"device":{"integration_id":"dummy","device_id":"lamp"},"power":false,"text":"'); throw new Error('injected'); //"}}]}});
    let compiled = automation::compile_definition_value(&definition, &catalog).unwrap();
    let Program::Native(program) = compiled.normalized.program else {
        panic!()
    };
    let NativeAction::RunScript { spec, .. } = &program.steps[0] else {
        panic!()
    };
    let output = pool()
        .await
        .execute(&spec.source_body, json!({"inputs":spec.inputs}))
        .await
        .unwrap();
    let parsed =
        automation::parse_routine_handler_outcome(&output, automation::MAX_SCRIPT_STATE_BYTES)
            .unwrap();
    assert!(matches!(
        parsed.actions[0],
        NativeAction::SetPower { power: false, .. }
    ));
    assert_eq!(
        parsed.next_state.unwrap()["text"],
        definition["program"]["steps"][0]["inputs"]["text"]
    );
}

#[tokio::test]
async fn scripted_conditions_keep_boolean_unknown_and_errors_distinct() {
    let pool = pool().await;
    for (source, known) in [
        ("return true;", Some(true)),
        ("return false;", Some(false)),
        ("return api.unknown('no reading');", None),
    ] {
        let spec = reuse::resolve_spec(&spec(source, vec![]), &catalog(vec![])).unwrap();
        let output = pool.execute(&spec.source_body, json!({})).await.unwrap();
        let outcome = automation::parse_condition_outcome(&output).unwrap();
        match (outcome, known) {
            (automation::ConditionOutcome::Known(actual), Some(expected)) => {
                assert_eq!(actual, expected)
            }
            (automation::ConditionOutcome::Unknown { .. }, None) => {}
            other => panic!("{other:?}"),
        }
    }
    for source in ["return 1;", "return {actions:[]};"] {
        let output = pool.execute(source, json!({})).await.unwrap();
        assert!(automation::parse_condition_outcome(&output).is_err());
    }
    let definition = json!({"triggers":[{"kind":"predicate_transition","id":"edge","predicate":{"kind":"script","spec":spec("return true;",vec![])}}],"program":{"kind":"script","spec":spec("return {actions:[]};",vec![])}});
    assert!(
        automation::compile_definition_value(&definition, &catalog(vec![]))
            .unwrap_err()
            .errors
            .iter()
            .any(|error| error.code == "script_transition")
    );
    let condition: ConditionExpr = serde_json::from_value(
        json!({"kind":"script","spec":spec("return false;",vec![]),"result":{"value":true}}),
    )
    .unwrap();
    assert!(
        matches!(condition, ConditionExpr::Script { result: None, .. }),
        "clients cannot inject condition results"
    );
}

#[tokio::test]
async fn source_functions_keep_the_restricted_source_context() {
    let function:AutomationBlock=serde_json::from_value(json!({"id":"profile","name":"Profile","kind":"function","inputs":{"level":{"label":"Level","kind":{"kind":"number"}}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":"if (ctx.after || ctx.values) throw new Error('live data leaked'); return {brightness:inputs.level};","functions":[],"declarations":[],"limits_profile":"default"},"output":{"kind":"json"}}})).unwrap();
    let compute=serde_json::from_value(json!({"kind":"script","source_body":"return {value:api.functions.call('profile',{level:ctx.params.level})};","functions":["profile"],"params":{"level":0.4}})).unwrap();
    let body = reuse::resolve_source(&compute, &catalog(vec![function])).unwrap();
    let result = pool()
        .await
        .execute(&body, json!({"params":{"level":0.4}}))
        .await
        .unwrap();
    assert_eq!(result["value"]["brightness"], json!(0.4));
}

#[tokio::test]
async fn functions_use_fixed_transitive_dependencies_and_literal_json_arguments() {
    let inner = function("__proto__", "return inputs.value*2;", vec![]);
    let outer = function(
        "outer",
        "return api.functions.call('__proto__',{value:inputs.value});",
        vec!["__proto__"],
    );
    let catalog = catalog(vec![inner, outer]);
    let pool = pool().await;
    let resolved = reuse::resolve_spec(
        &spec(
            "return api.functions.call('outer',{value:4});",
            vec!["outer"],
        ),
        &catalog,
    )
    .unwrap();
    assert_eq!(
        pool.execute(&resolved.source_body, json!({}))
            .await
            .unwrap(),
        json!(8)
    );
    let unlisted = reuse::resolve_spec(
        &spec(
            "return api.functions.call('__proto__',{value:4});",
            vec!["outer"],
        ),
        &catalog,
    )
    .unwrap();
    assert!(
        pool.execute(&unlisted.source_body, json!({}))
            .await
            .is_err(),
        "root cannot call a transitive dependency without declaring it"
    );
    let block:AutomationBlock=serde_json::from_value(json!({"id":"json","name":"JSON","kind":"action","inputs":{"payload":{"label":"Payload","kind":{"kind":"json"}}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return {actions:[],next_state:inputs.payload};","declarations":[],"limits_profile":"default"}}})).unwrap();
    let catalog = ConfigCatalog::from_export(&empty_config(vec![block]));
    let payload = json!({"$input":"not_a_binding","spec":{"api_version":1,"source_body":"not JavaScript","functions":["missing"]}});
    let definition = json!({"triggers":[{"kind":"manual","id":"manual"}],"program":{"kind":"native","steps":[{"action":"call_block","id":"call","block_id":"json","inputs":{"payload":payload}}]}});
    let compiled = automation::compile_definition_value(&definition, &catalog).unwrap();
    let Program::Native(program) = compiled.normalized.program else {
        panic!()
    };
    let NativeAction::RunScript { spec, .. } = &program.steps[0] else {
        panic!()
    };
    let output = pool
        .execute(&spec.source_body, json!({"inputs":spec.inputs}))
        .await
        .unwrap();
    assert_eq!(output["next_state"], payload);
    assert!(!automation::blocks::references(&definition, "missing"));
}
#[test]
fn computed_helpers_reject_cycles_missing_dependencies_and_routine_writes() {
    let computed = |id: &str, dependencies: Vec<&str>| {
        serde_json::from_value(json!({"id":id,"name":id,"kind":{"kind":"boolean"},"initial_value":false,"persistence":"durable","compute":{"script":{"api_version":1,"source_body":"return true;","declarations":[],"limits_profile":"default"},"helpers":dependencies,"enabled":true,"refresh_ms":1000,"revision":1}})).unwrap()
    };
    let mut config = empty_config(vec![]);
    config.helpers = vec![computed("a", vec!["b"]), computed("b", vec!["a"])];
    assert!(
        reuse::validate_helpers(&config, &ConfigCatalog::from_export(&config))
            .unwrap_err()
            .contains("cycle")
    );
    config.helpers = vec![computed("a", vec!["missing"])];
    assert!(
        reuse::validate_helpers(&config, &ConfigCatalog::from_export(&config))
            .unwrap_err()
            .contains("Unknown helper")
    );
    config.helpers = vec![computed("a", vec![])];
    let definition = json!({"triggers":[{"kind":"manual","id":"manual"}],"program":{"kind":"native","steps":[{"action":"set_helper","id":"write","helper":"a","value":true}]}});
    let errors =
        automation::compile_definition_value(&definition, &ConfigCatalog::from_export(&config))
            .unwrap_err()
            .errors;
    assert!(errors
        .iter()
        .any(|error| error.code == "computed_helper_read_only"));
}
