//! Blocks expand at compilation, before subscriptions, limits and planning.
//! Their effects therefore use the caller's coherent frame, trigger and policy.
use super::compile::ConfigCatalog;
use crate::types::automation_block::{AutomationBlock, BlockInputKind, BlockKind};
use crate::types::automation_definition::{ConditionExpr, NativeAction, TargetSpec};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_BLOCK_DEPTH: usize = 8;
pub const MAX_BLOCK_INPUTS: usize = 16;
pub const MAX_BLOCK_BYTES: usize = 64 * 1024;
const MAX_EXPANSION_NODES: usize = 4096;

#[derive(Debug)]
pub struct BlockError {
    pub path: String,
    pub message: String,
}
impl std::fmt::Display for BlockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.path, self.message)
    }
}
impl std::error::Error for BlockError {}
fn error(path: &str, message: impl Into<String>) -> BlockError {
    BlockError {
        path: path.into(),
        message: message.into(),
    }
}

pub fn validate_input(kind: &BlockInputKind, value: &Value) -> Result<(), String> {
    let valid = match kind {
        BlockInputKind::Group
        | BlockInputKind::Scene
        | BlockInputKind::Helper
        | BlockInputKind::String => value.as_str().is_some_and(|v| !v.trim().is_empty()),
        BlockInputKind::Device => serde_json::from_value::<crate::types::device::DeviceRef>(
            value.clone(),
        )
        .is_ok_and(|v| match v {
            crate::types::device::DeviceRef::Id(v) => {
                !v.integration_id.to_string().is_empty() && !v.device_id.to_string().is_empty()
            }
        }),
        BlockInputKind::Targets => serde_json::from_value::<TargetSpec>(value.clone()).is_ok(),
        BlockInputKind::Rollout => {
            value.is_null()
                || serde_json::from_value::<crate::types::automation_definition::RolloutSpec>(
                    value.clone(),
                )
                .is_ok_and(|r| {
                    r.duration_ms
                        .is_none_or(|ms| ms <= super::compile::MAX_ROLLOUT_DURATION_MS)
                })
        }
        BlockInputKind::Boolean => value.is_boolean(),
        BlockInputKind::Json => true,
        BlockInputKind::Number => value.is_number(),
        BlockInputKind::Duration => value
            .as_u64()
            .is_some_and(|v| v <= super::compile::MAX_TIMER_DELAY_MS),
        BlockInputKind::Enum { options } => value
            .as_str()
            .is_some_and(|v| options.iter().any(|o| o == v)),
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "value does not match input type {}",
            serde_json::to_string(kind).unwrap_or_default()
        ))
    }
}

fn sample(kind: &BlockInputKind) -> Value {
    match kind {
        BlockInputKind::Rollout => {
            json!({"style":"spatial","duration_ms":1500,"source":{"kind":"triggering_device"}})
        }
        BlockInputKind::Boolean => json!(true),
        BlockInputKind::Json => json!({}),
        BlockInputKind::Number => json!(0.1),
        BlockInputKind::Duration => json!(1000),
        BlockInputKind::Device => json!({"integration_id":"block_input", "device_id":"device"}),
        BlockInputKind::Targets => json!({"groups":["block_input"]}),
        BlockInputKind::Enum { options } => json!(options.first().cloned().unwrap_or_default()),
        _ => json!("block_input"),
    }
}

fn substitute(
    value: &Value,
    inputs: &BTreeMap<String, Value>,
    path: &str,
    depth: usize,
    nodes: &mut usize,
) -> Result<Value, BlockError> {
    *nodes += 1;
    if depth > 64 || *nodes > MAX_EXPANSION_NODES {
        return Err(error(
            path,
            "Block expansion is too large or too deeply nested.",
        ));
    }
    match value {
        Value::Object(map) if map.contains_key("$input") => {
            if map.len() != 1 {
                return Err(error(path, "An input reference must contain only $input."));
            }
            let name = map["$input"]
                .as_str()
                .ok_or_else(|| error(path, "$input must name an input."))?;
            inputs
                .get(name)
                .cloned()
                .ok_or_else(|| error(path, format!("Unknown input '{name}'.")))
        }
        Value::Object(map) => map
            .iter()
            .map(|(k, v)| {
                substitute(v, inputs, &format!("{path}/{k}"), depth + 1, nodes)
                    .map(|v| (k.clone(), v))
            })
            .collect::<Result<serde_json::Map<_, _>, _>>()
            .map(Value::Object),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, v)| substitute(v, inputs, &format!("{path}/{i}"), depth + 1, nodes))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        _ => Ok(value.clone()),
    }
}

pub fn validate_block(block: &AutomationBlock) -> Result<(), BlockError> {
    if block.id.trim().is_empty() || block.name.trim().is_empty() {
        return Err(error("/", "Give the block an ID and a name."));
    }
    if block.inputs.len() > MAX_BLOCK_INPUTS {
        return Err(error("/inputs", "A block supports at most 16 inputs."));
    }
    if serde_json::to_vec(block)
        .map_err(|e| error("/", e.to_string()))?
        .len()
        > MAX_BLOCK_BYTES
    {
        return Err(error("/body", "A block must fit within 64 KiB."));
    }
    let mut probes = BTreeMap::new();
    for (name, input) in &block.inputs {
        if name.is_empty()
            || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            || input.label.trim().is_empty()
        {
            return Err(error(
                &format!("/inputs/{name}"),
                "Inputs need a label and an alphanumeric/underscore key.",
            ));
        }
        if let BlockInputKind::Enum { options } = &input.kind {
            let unique: BTreeSet<_> = options.iter().collect();
            if options.is_empty()
                || unique.len() != options.len()
                || options.iter().any(|o| o.trim().is_empty())
            {
                return Err(error(
                    &format!("/inputs/{name}"),
                    "Enum options must be nonempty and unique.",
                ));
            }
        }
        if let Some(default) = &input.default {
            validate_input(&input.kind, default)
                .map_err(|m| error(&format!("/inputs/{name}/default"), m))?;
        }
        probes.insert(
            name.clone(),
            input.default.clone().unwrap_or_else(|| sample(&input.kind)),
        );
    }
    if super::reuse::script_body(block).is_some() {
        return super::reuse::validate_script(&block.body, block.kind)
            .map_err(|m| error("/body", m));
    }
    if block.kind == BlockKind::Function {
        return Err(error("/body", "Functions need a JavaScript body."));
    }
    let mut dynamic = false;
    visit_calls(&block.body, &mut |call| {
        dynamic |= !call["block_id"].is_string();
    });
    if dynamic {
        return Err(error(
            "/body",
            "Calls name a fixed block; bind its arguments to inputs instead.",
        ));
    }
    let body = substitute(&block.body, &probes, "/body", 0, &mut 0)?;
    validate_template(&body, block.kind, "/body", 0)?;
    Ok(())
}

fn validate_template(
    body: &Value,
    kind: BlockKind,
    path: &str,
    depth: usize,
) -> Result<(), BlockError> {
    if depth > MAX_BLOCK_DEPTH {
        return Err(error(path, "Too many nested branches."));
    }
    match kind {
        BlockKind::Function => return Err(error(path, "Functions need JavaScript.")),
        BlockKind::Condition => {
            serde_json::from_value::<ConditionExpr>(body.clone())
                .map_err(|e| error(path, e.to_string()))?;
        }
        BlockKind::Action => {
            let steps: Vec<NativeAction> =
                serde_json::from_value(body.clone()).map_err(|e| error(path, e.to_string()))?;
            if steps.is_empty() {
                return Err(error(path, "Add an action to the block."));
            }
            for (i, step) in steps.iter().enumerate() {
                let path = format!("{path}/{i}");
                match step {
                    NativeAction::ScheduleTimer {..} | NativeAction::ReplaceTimer {..} | NativeAction::CancelTimer {..} | NativeAction::InvokeRoutine {..} => return Err(error(&path,"Blocks use native actions and helpers; timers and routine invocation belong to the calling routine.")),
                    NativeAction::Choose { branches, .. } => for branch in branches { validate_template(&serde_json::to_value(&branch.steps).unwrap(), BlockKind::Action, &path, depth+1)?; },
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

// Apply arguments after template substitution: JSON arguments remain literal data.
fn attach_script_inputs(
    value: &mut Value,
    block: &AutomationBlock,
    inputs: &BTreeMap<String, Value>,
) {
    if let Some(map) = value.as_object_mut() {
        if matches!(
            map.get("kind").and_then(Value::as_str),
            Some("javascript" | "script")
        ) || map.get("action").and_then(Value::as_str) == Some("run_script")
        {
            if let Some(spec) = map.get_mut("spec") {
                spec["inputs"] = json!(inputs);
                let mut declarations = spec["declarations"].as_array().cloned().unwrap_or_default();
                for (name, input) in &block.inputs {
                    let value = &inputs[name];
                    let additions: Vec<Value> = match input.kind {
                        BlockInputKind::Device => vec![json!({"kind":"device","device":value})],
                        BlockInputKind::Group => vec![json!({"kind":"group","group_id":value})],
                        BlockInputKind::Targets => value["devices"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|device| json!({"kind":"device","device":device}))
                            .chain(
                                value["groups"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .map(|group| json!({"kind":"group","group_id":group})),
                            )
                            .collect(),
                        _ => vec![],
                    };
                    for declaration in additions {
                        if !declarations.contains(&declaration) {
                            declarations.push(declaration);
                        }
                    }
                }
                spec["declarations"] = json!(declarations);
            }
            return;
        }
        for (key, item) in map {
            if !matches!(key.as_str(), "inputs" | "value" | "params") {
                attach_script_inputs(item, block, inputs);
            }
        }
    } else if let Some(items) = value.as_array_mut() {
        for item in items {
            attach_script_inputs(item, block, inputs);
        }
    }
}

struct Expander<'a> {
    catalog: &'a ConfigCatalog,
    stack: Vec<String>,
    nodes: usize,
}
impl Expander<'_> {
    fn body(
        &mut self,
        call: &Value,
        kind: BlockKind,
        path: &str,
    ) -> Result<(AutomationBlock, Value), BlockError> {
        let id = call["block_id"]
            .as_str()
            .ok_or_else(|| error(path, "Choose a block."))?;
        let block = self
            .catalog
            .blocks
            .get(id)
            .ok_or_else(|| error(path, format!("Unknown block '{id}'.")))?
            .clone();
        if block.kind != kind {
            return Err(error(path, format!("Block '{id}' has the wrong kind.")));
        }
        if self.stack.iter().any(|x| x == id) {
            return Err(error(
                path,
                format!("Recursive block call: {} → {id}", self.stack.join(" → ")),
            ));
        }
        if self.stack.len() >= MAX_BLOCK_DEPTH {
            return Err(error(path, "Block call depth exceeds 8."));
        }
        validate_block(&block)?;
        let supplied = match call.get("inputs") {
            Some(Value::Object(v)) => v.clone(),
            None => Default::default(),
            _ => return Err(error(path, "Block inputs must be an object.")),
        };
        for name in supplied.keys() {
            if !block.inputs.contains_key(name) {
                return Err(error(
                    path,
                    format!("Unknown input '{name}' for block '{id}'."),
                ));
            }
        }
        let mut inputs = BTreeMap::new();
        for (name, spec) in &block.inputs {
            let value = supplied
                .get(name)
                .or(spec.default.as_ref())
                .ok_or_else(|| error(path, format!("Missing input '{name}' for block '{id}'.")))?;
            self.catalog
                .validate_block_input(&spec.kind, value)
                .map_err(|m| error(&format!("{path}/inputs/{name}"), m))?;
            inputs.insert(name.clone(), value.clone());
        }
        let mut body = if super::reuse::script_body(&block).is_some() {
            block.body.clone()
        } else {
            substitute(&block.body, &inputs, path, 0, &mut self.nodes)?
        };
        attach_script_inputs(&mut body, &block, &inputs);
        self.stack.push(id.into());
        Ok((block, body))
    }
    fn condition(&mut self, value: &Value, path: &str, depth: usize) -> Result<Value, BlockError> {
        if depth > super::compile::MAX_CONDITION_DEPTH {
            return Err(error(path, "Condition depth exceeds 32."));
        }
        self.nodes += 1;
        if self.nodes > MAX_EXPANSION_NODES {
            return Err(error(path, "Block expansion is too large."));
        }
        let mut result = value.clone();
        match value["kind"].as_str() {
            Some("block") => {
                let (_, body) = self.body(value, BlockKind::Condition, path)?;
                result = if body["kind"] == "javascript" {
                    json!({"kind":"script","spec":body["spec"]})
                } else {
                    self.condition(&body, path, depth + 1)?
                };
                self.stack.pop();
            }
            Some("all" | "any") => {
                if let Some(items) = value["conditions"].as_array() {
                    result["conditions"] = Value::Array(
                        items
                            .iter()
                            .enumerate()
                            .map(|(i, v)| {
                                self.condition(v, &format!("{path}/conditions/{i}"), depth + 1)
                            })
                            .collect::<Result<_, _>>()?,
                    );
                }
            }
            Some("not") => {
                result["condition"] =
                    self.condition(&value["condition"], &format!("{path}/condition"), depth + 1)?
            }
            _ => {}
        }
        Ok(result)
    }
    fn steps(
        &mut self,
        value: &Value,
        path: &str,
        prefix: &str,
        depth: usize,
    ) -> Result<Value, BlockError> {
        if depth > super::compile::MAX_CHOOSE_DEPTH {
            return Err(error(path, "Expanded branch depth exceeds 8."));
        }
        let items = value
            .as_array()
            .ok_or_else(|| error(path, "Actions must be an array."))?;
        let mut result = Vec::new();
        for (i, item) in items.iter().enumerate() {
            self.nodes += 1;
            if self.nodes > MAX_EXPANSION_NODES {
                return Err(error(path, "Block expansion is too large."));
            }
            let path = format!("{path}/{i}");
            let original_id = item["id"].as_str().unwrap_or("");
            if original_id.trim().is_empty() {
                return Err(error(&path, "Actions need a stable ID."));
            }
            let node_id = format!("{prefix}{original_id}");
            if item["action"] == "call_block" {
                if original_id.trim().is_empty() {
                    return Err(error(&path, "Block calls need a stable ID."));
                }
                let (block, body) = self.body(item, BlockKind::Action, &path)?;
                let qualified = format!("{node_id}/block:{}@{}/", block.id, block.revision);
                if body["kind"] == "javascript" {
                    result.push(json!({"action":"run_script","id":format!("{qualified}script"),"spec":body["spec"]}));
                    self.stack.pop();
                    continue;
                }
                let expanded = self.steps(&body, &path, &qualified, depth + 1)?;
                self.stack.pop();
                // A named native branch preserves call provenance in the plan and
                // counts this call toward the existing node and action limits.
                result.push(json!({"action":"choose","id":node_id,"branches":[{"id":format!("{qualified}body"),"condition":{"kind":"literal","value":true},"steps":expanded}]}));
            } else {
                let mut step = item.clone();
                if !prefix.is_empty() {
                    step["id"] = json!(node_id);
                }
                if item["action"] == "choose" {
                    if let Some(branches) = item["branches"].as_array() {
                        let mut expanded = Vec::new();
                        for (j, branch) in branches.iter().enumerate() {
                            let mut branch = branch.clone();
                            let branch_path = format!("{path}/branches/{j}");
                            if branch["id"].as_str().is_none_or(|id| id.trim().is_empty()) {
                                return Err(error(&branch_path, "Branches need a stable ID."));
                            }
                            if !prefix.is_empty() {
                                branch["id"] = json!(format!(
                                    "{prefix}{}",
                                    branch["id"].as_str().unwrap_or("")
                                ));
                            }
                            branch["condition"] = self.condition(
                                &branch["condition"],
                                &format!("{branch_path}/condition"),
                                0,
                            )?;
                            branch["steps"] = self.steps(
                                &branch["steps"],
                                &format!("{branch_path}/steps"),
                                prefix,
                                depth + 1,
                            )?;
                            expanded.push(branch);
                        }
                        step["branches"] = json!(expanded);
                    }
                }
                result.push(step);
            }
        }
        Ok(json!(result))
    }
}

pub fn expand_definition(value: &Value, catalog: &ConfigCatalog) -> Result<Value, BlockError> {
    let mut expander = Expander {
        catalog,
        stack: Vec::new(),
        nodes: 0,
    };
    let mut result = value.clone();
    if let Some(condition) = value.get("condition") {
        result["condition"] = expander.condition(condition, "/condition", 0)?;
    }
    if let Some(triggers) = value["triggers"].as_array() {
        for (i, trigger) in triggers.iter().enumerate() {
            if let Some(predicate) = trigger.get("predicate") {
                result["triggers"][i]["predicate"] =
                    expander.condition(predicate, &format!("/triggers/{i}/predicate"), 0)?;
            }
        }
    }
    if value["program"]["kind"] == "native" {
        result["program"]["steps"] =
            expander.steps(&value["program"]["steps"], "/program/steps", "", 0)?;
    }
    super::reuse::resolve_in_value(&mut result, catalog).map_err(|m| error("/", m))?;
    Ok(result)
}

/// Includes nested calls, for the editor's usage lists and guarded deletion.
fn visit_calls(value: &Value, visitor: &mut impl FnMut(&Value)) {
    if let Some(items) = value.as_array() {
        for item in items {
            visit_calls(item, visitor);
        }
        return;
    }
    match (value["kind"].as_str(), value["action"].as_str()) {
        (Some("block"), _) | (_, Some("call_block")) => visitor(value),
        (Some("all" | "any"), _) => visit_calls(&value["conditions"], visitor),
        (Some("not"), _) => visit_calls(&value["condition"], visitor),
        (_, Some("choose")) => {
            if let Some(branches) = value["branches"].as_array() {
                for branch in branches {
                    visit_calls(&branch["condition"], visitor);
                    visit_calls(&branch["steps"], visitor);
                }
            }
        }
        (None, None) if value.is_object() => {
            visit_calls(&value["condition"], visitor);
            if value["program"]["kind"] == "native" {
                visit_calls(&value["program"]["steps"], visitor);
            }
            if let Some(triggers) = value["triggers"].as_array() {
                for trigger in triggers {
                    if matches!(
                        trigger["kind"].as_str(),
                        Some("predicate_transition" | "predicate_for")
                    ) {
                        visit_calls(&trigger["predicate"], visitor);
                    }
                }
            }
        }
        _ => {}
    }
}
pub fn references(value: &Value, id: &str) -> bool {
    if let Value::Object(map) = value {
        if ((map.contains_key("api_version") && map.contains_key("source_body"))
            || (map.get("kind").and_then(Value::as_str) == Some("script")
                && map.contains_key("params")))
            && map
                .get("functions")
                .and_then(Value::as_array)
                .is_some_and(|v| v.iter().any(|v| v.as_str() == Some(id)))
        {
            return true;
        }
        if map.iter().any(|(key, v)| {
            !matches!(key.as_str(), "value" | "inputs" | "params") && references(v, id)
        }) {
            return true;
        }
    }
    if let Value::Array(items) = value {
        if items.iter().any(|v| references(v, id)) {
            return true;
        }
    }
    let mut found = false;
    visit_calls(value, &mut |call| {
        found |= call["block_id"].as_str() == Some(id);
    });
    found
}

pub fn validate_catalog(catalog: &ConfigCatalog) -> Result<(), BlockError> {
    let probe = catalog
        .clone()
        .with_group(crate::types::group::GroupId("block_input".into()))
        .with_scene("block_input".to_string().into())
        .with_helper(crate::types::automation_definition::HelperId(
            "block_input".into(),
        ));
    for block in catalog.blocks.values() {
        validate_block(block)?;
        if super::reuse::script_body(block).is_some() {
            let spec: crate::types::automation_definition::ScriptSpec =
                serde_json::from_value(block.body["spec"].clone())
                    .map_err(|e| error("/body/spec", e.to_string()))?;
            super::reuse::resolve_spec(&spec, catalog).map_err(|e| error("/body/spec", e))?;
            if block.kind != BlockKind::Function {
                let definition = if block.kind == BlockKind::Action {
                    json!({"triggers":[{"kind":"manual","id":"probe"}],"program":{"kind":"script","spec":spec}})
                } else {
                    json!({"triggers":[{"kind":"manual","id":"probe"}],"condition":{"kind":"script","spec":spec},"program":{"kind":"native","steps":[{"action":"dim","id":"probe_action","step":0.1,"targets":{"groups":["block_input"]}}]}})
                };
                super::compile::compile_definition_value(&definition, &probe)
                    .map_err(|report| error("/body/spec", report.summary()))?;
            }
            continue;
        }
        let inputs: BTreeMap<_, _> = block
            .inputs
            .iter()
            .map(|(key, input)| {
                (
                    key.clone(),
                    input.default.clone().unwrap_or_else(|| sample(&input.kind)),
                )
            })
            .collect();
        let call = json!({"id":"validate","block_id":block.id,"inputs":inputs});
        let mut probe = probe.clone();
        if let Ok(device) = serde_json::from_value::<crate::types::device::DeviceRef>(sample(
            &BlockInputKind::Device,
        )) {
            let crate::types::device::DeviceRef::Id(device) = device;
            probe = probe.with_block_sample_device(crate::types::device::DeviceKey::new(
                device.integration_id,
                device.device_id,
            ));
        }
        let mut expander = Expander {
            catalog: &probe,
            stack: Vec::new(),
            nodes: 0,
        };
        let (_, body) = expander.body(&call, block.kind, "/body")?;
        let definition = match block.kind {
            BlockKind::Function => unreachable!("functions validated above"),
            BlockKind::Condition => {
                json!({"triggers":[{"kind":"manual","id":"probe_trigger"}],"condition":expander.condition(&body,"/body",0)?,"program":{"kind":"native","steps":[{"action":"dim","id":"probe_action","step":0.1,"targets":{"groups":["block_input"]}}]}})
            }
            BlockKind::Action => {
                json!({"triggers":[{"kind":"manual","id":"probe_trigger"}],"program":{"kind":"native","steps":expander.steps(&body,"/body","",0)?}})
            }
        };
        if let Err(report) = super::compile::compile_definition_value(&definition, &probe) {
            // Required helper inputs acquire their concrete helper type at the
            // caller. Other structural, reference and limit errors still fail.
            if let Some(issue) = report.errors.iter().find(|e| {
                !(e.code == "invalid_helper_value" && e.message.contains("'block_input'"))
            }) {
                return Err(error(
                    &issue.path,
                    format!("Block '{}': {}", block.name, issue.message),
                ));
            }
        }
    }
    Ok(())
}
