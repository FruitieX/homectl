//! Compile fixed, DB-backed function dependencies into a worker invocation.
//! Only syntax and schemas are checked here; user JavaScript never runs here.
use super::compile::ConfigCatalog;
use crate::types::{
    automation_block::{AutomationBlock, BlockInputKind, BlockKind},
    automation_definition::ScriptSpec,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub fn script_body(block: &AutomationBlock) -> Option<&Value> {
    (block.body["kind"] == "javascript").then_some(&block.body)
}

pub fn validate_script(body: &Value, kind: BlockKind) -> Result<(), String> {
    let spec: ScriptSpec =
        serde_json::from_value(body["spec"].clone()).map_err(|e| e.to_string())?;
    if spec.api_version != 1
        || spec.limits_profile != "default"
        || spec.source_body.trim().is_empty()
    {
        return Err(
            "Use script API version 1, default limits and a non-empty function body.".into(),
        );
    }
    crate::core::js_worker::engine::validate_script(&spec.source_body)?;
    if spec.functions.len() > 16 {
        return Err("At most 16 function dependencies are supported.".into());
    }
    if kind == BlockKind::Function {
        let output: BlockInputKind = serde_json::from_value(body["output"].clone())
            .map_err(|_| "Choose the function's output type.".to_string())?;
        if let BlockInputKind::Enum { options } = output {
            crate::types::automation_value::HelperKind::Enum { options }.validate()?;
        }
        if !spec.declarations.is_empty() {
            return Err(
                "Functions receive explicit inputs; declare device dependencies on their callers."
                    .into(),
            );
        }
    }
    Ok(())
}

pub fn libraries(
    ids: &[String],
    catalog: &ConfigCatalog,
) -> Result<BTreeMap<String, Value>, String> {
    fn visit(
        id: &str,
        catalog: &ConfigCatalog,
        stack: &mut BTreeSet<String>,
        result: &mut BTreeMap<String, Value>,
    ) -> Result<(), String> {
        if stack.contains(id) {
            return Err(format!("Function dependency cycle at '{id}'."));
        }
        if result.contains_key(id) {
            return Ok(());
        }
        if stack.len() >= 8 || result.len() >= 32 {
            return Err("Function dependencies exceed the depth/count limit.".into());
        }
        let block = catalog
            .blocks
            .get(id)
            .ok_or_else(|| format!("Unknown function '{id}'."))?;
        if block.kind != BlockKind::Function || script_body(block).is_none() {
            return Err(format!("Block '{id}' is not a JavaScript function."));
        }
        validate_script(&block.body, block.kind)?;
        let spec: ScriptSpec =
            serde_json::from_value(block.body["spec"].clone()).map_err(|e| e.to_string())?;
        stack.insert(id.to_string());
        for dependency in &spec.functions {
            visit(dependency, catalog, stack, result)?;
        }
        stack.remove(id);
        result.insert(id.to_string(), json!({"inputs":block.inputs,"output":block.body["output"],"source_body":spec.source_body,"functions":spec.functions,"revision":block.revision}));
        Ok(())
    }
    let mut result = BTreeMap::new();
    for id in ids {
        visit(id, catalog, &mut BTreeSet::new(), &mut result)?;
    }
    Ok(result)
}

pub fn resolve_spec(spec: &ScriptSpec, catalog: &ConfigCatalog) -> Result<ScriptSpec, String> {
    if spec.functions.len() > 16 {
        return Err("At most 16 function dependencies are supported.".into());
    }
    let functions = libraries(&spec.functions, catalog)?;
    let mut resolved = spec.clone();
    // Source bodies are code; arguments and library metadata are strict JSON
    // data, never template replacements inside the user's source strings.
    let library_json = serde_json::to_string(&functions).map_err(|error| error.to_string())?;
    resolved.source_body = format!("return (function(ctx, api, inputs) {{\n{}\n}})(ctx, api.withFunctions(ctx, JSON.parse({}), {}), ctx.inputs || {{}});", spec.source_body, serde_json::to_string(&library_json).map_err(|e| e.to_string())?,serde_json::to_string(&spec.functions).map_err(|error|error.to_string())?);
    // The caller's compiler validates syntax and preserves the original field path.
    Ok(resolved)
}

pub fn resolve_source(
    compute: &crate::types::automation_source::SourceCompute,
    catalog: &ConfigCatalog,
) -> Result<String, String> {
    let body = super::sources::resolve_source_body(compute)?;
    let functions = match compute {
        crate::types::automation_source::SourceCompute::Script { functions, .. } => {
            functions.clone().unwrap_or_default()
        }
        _ => vec![],
    };
    let spec = ScriptSpec {
        api_version: 1,
        source_body: body,
        functions,
        inputs: Default::default(),
        declarations: vec![],
        limits_profile: "default".into(),
    };
    Ok(resolve_spec(&spec, catalog)?.source_body)
}

pub async fn preview_execute(body: &str, context: Value) -> Result<Value, String> {
    use crate::core::js_worker::{JsWorkerPool, SupervisorConfig};
    static POOL: tokio::sync::OnceCell<JsWorkerPool> = tokio::sync::OnceCell::const_new();
    #[cfg(test)]
    let worker_binary = Some(
        std::env::current_exe()
            .map_err(|error| error.to_string())?
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("script-worker"),
    );
    #[cfg(not(test))]
    let worker_binary = None;
    let pool = POOL
        .get_or_try_init(|| {
            JsWorkerPool::new(SupervisorConfig {
                worker_binary,
                workers: 1,
                max_outstanding_requests: 8,
                ..Default::default()
            })
        })
        .await
        .map_err(|error| error.to_string())?;
    pool.execute(body, context)
        .await
        .map_err(|error| error.to_string())
}

pub fn resolve_in_value(value: &mut Value, catalog: &ConfigCatalog) -> Result<(), String> {
    match value {
        Value::Object(map)
            if map.contains_key("api_version") && map.contains_key("source_body") =>
        {
            let spec: ScriptSpec =
                serde_json::from_value(Value::Object(map.clone())).map_err(|e| e.to_string())?;
            *value =
                serde_json::to_value(resolve_spec(&spec, catalog)?).map_err(|e| e.to_string())?;
        }
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                // Arguments, comparison operands and extension parameters are data.
                if matches!(key.as_str(), "value" | "inputs" | "params") {
                    continue;
                }
                resolve_in_value(item, catalog)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                resolve_in_value(item, catalog)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_helpers(
    config: &crate::db::config_queries::ConfigExport,
    catalog: &ConfigCatalog,
) -> Result<(), String> {
    fn visit(
        id: &str,
        config: &crate::db::config_queries::ConfigExport,
        stack: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if stack.contains(id) {
            return Err(format!("Computed helper dependency cycle at '{id}'."));
        }
        if done.contains(id) {
            return Ok(());
        }
        if stack.len() >= 32 {
            return Err("Computed helper dependency depth exceeds 32.".into());
        }
        let helper = config
            .helpers
            .iter()
            .find(|helper| helper.id.as_str() == id)
            .ok_or_else(|| format!("Unknown helper dependency '{id}'."))?;
        stack.insert(id.into());
        if let Some(compute) = &helper.compute {
            for dependency in &compute.helpers {
                visit(dependency.as_str(), config, stack, done)?;
            }
        }
        stack.remove(id);
        done.insert(id.into());
        Ok(())
    }
    let mut done = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for helper in &config.helpers {
        if !ids.insert(helper.id.clone()) {
            return Err(format!("Duplicate helper ID '{}'.", helper.id));
        }
        helper.validate()?;
        visit(helper.id.as_str(), config, &mut BTreeSet::new(), &mut done)?;
        if let Some(compute) = &helper.compute {
            let definition = json!({"triggers":[{"kind":"manual","id":"probe"}],"program":{"kind":"script","spec":compute.script}});
            super::compile::compile_definition_value(&definition, catalog)
                .map_err(|report| format!("Helper '{}': {}", helper.name, report.summary()))?;
        }
    }
    Ok(())
}
