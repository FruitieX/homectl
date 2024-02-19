use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};

use evalexpr::*;
use eyre::{OptionExt, Result};
use jsonptr::Assign;
use serde_json_path::{JsonPath, NormalizedPath};

use crate::types::{
    action::Action,
    device::{Device, DeviceKey, DevicesState},
    event::{Event, TxEventChannel},
    group::{FlattenedGroupsConfig, GroupId},
    integration::{CustomActionDescriptor, IntegrationActionPayload, IntegrationId},
    rule::{ForceTriggerRoutineDescriptor, RoutineId},
    scene::{ActivateSceneDescriptor, FlattenedScenesConfig, SceneDeviceConfig, SceneId},
};

use super::{
    groups::{flattened_groups_to_eval_context_values, Groups},
    scenes::Scenes,
};

pub type EvalContext = HashMapContext;

fn value_kv_pairs_deep(
    value: &serde_json::Value,
    prefix: &str,
) -> Vec<(String, serde_json::Value)> {
    match value {
        serde_json::Value::Object(object) => object
            .iter()
            .flat_map(|(key, value)| {
                let key = format!("{prefix}.{key}");
                value_kv_pairs_deep(value, &key)
            })
            .collect(),
        serde_json::Value::Array(array) => array
            .iter()
            .enumerate()
            .flat_map(|(i, value)| {
                let key = format!("{prefix}.{i}");
                value_kv_pairs_deep(value, &key)
            })
            .collect(),
        _ => vec![(prefix.to_string(), value.clone())],
    }
}

fn serde_value_to_evalexpr(value: &serde_json::Value) -> Result<Value> {
    match value {
        serde_json::Value::Bool(b) => Ok(Value::Boolean(*b)),
        serde_json::Value::Number(n) => {
            Ok(Value::Float(n.as_f64().ok_or_else(|| {
                eyre!("Failed to convert serde number to evalexpr float")
            })?))
        }
        serde_json::Value::String(s) => Ok(Value::String(s.clone())),
        serde_json::Value::Null => Ok(Value::Empty),
        serde_json::Value::Array(_) => Err(eyre!("Arrays are not supported for rule evaluation")),
        serde_json::Value::Object(_) => Err(eyre!("Objects are not supported for rule evaluation")),
    }
}

fn evalexpr_value_to_serde(value: &Value) -> Result<serde_json::Value> {
    match value {
        Value::Boolean(b) => Ok(serde_json::Value::Bool(*b)),
        Value::Float(f) => Ok(serde_json::Value::Number(
            serde_json::Number::from_f64(*f)
                .ok_or_else(|| eyre!("Failed to convert evalexpr float to serde number"))?,
        )),
        Value::String(s) => Ok(serde_json::Value::String(s.clone())),
        Value::Empty => Ok(serde_json::Value::Null),
        Value::Tuple(a) => Ok(serde_json::Value::Array(
            a.iter()
                .map(evalexpr_value_to_serde)
                .collect::<Result<Vec<_>>>()?,
        )),
        Value::Int(i) => Ok(serde_json::Value::Number(serde_json::Number::from(*i))),
    }
}

fn name_to_evalexpr(device_name: &str) -> String {
    device_name.to_lowercase().replace(' ', "_")
}

pub fn state_to_eval_context(
    devices: &DevicesState,
    flattened_scenes: &FlattenedScenesConfig,
    flattened_groups: &FlattenedGroupsConfig,
) -> Result<HashMapContext> {
    let mut context = HashMapContext::new();
    context.set_type_safety_checks_disabled(true)?;

    let mut set_values = |prefix: &str, root: &serde_json::Value| {
        let values = value_kv_pairs_deep(root, prefix);

        for (key, value) in values {
            let value = serde_value_to_evalexpr(&value)?;
            context.set_value(key, value)?;
        }

        Ok::<(), eyre::Error>(())
    };

    for device in devices.0.values() {
        let prefix = format!(
            "devices.{}.{}",
            device.integration_id,
            name_to_evalexpr(&device.name)
        );

        set_values(&prefix, &device.get_value())?;
        if let Some(raw_value) = device.get_raw_value() {
            let raw_prefix = format!("{prefix}.raw");
            set_values(&raw_prefix, raw_value)?;
        }
    }

    for (scene_id, scene) in &flattened_scenes.0 {
        let prefix = format!("scenes.{}", name_to_evalexpr(&scene_id.to_string()));

        for (device_key, state) in &scene.devices.0 {
            let device = devices.0.get(device_key);

            let Some(device) = device else {
                continue;
            };

            let integration_id = &device.integration_id;
            let name = name_to_evalexpr(&device.name.to_lowercase());
            let prefix = format!("{prefix}.{integration_id}.{name}");

            let value = serde_json::to_value(state)?;
            let values = value_kv_pairs_deep(&value, &prefix.clone());

            for (key, value) in values {
                let value = serde_value_to_evalexpr(&value)?;
                context.set_value(key, value)?;
            }
        }
    }

    let group_eval_context_values =
        flattened_groups_to_eval_context_values(flattened_groups, devices);

    for (key, value) in group_eval_context_values {
        let value = serde_value_to_evalexpr(&value)?;
        context.set_value(key, value)?;
    }

    context.set_function("dbg".into(), {
        let context = context.clone();

        Function::new(move |argument| {
            if argument.is_empty() {
                debug_print_context(&context)
            } else {
                dbg!(&argument);
            }
            Ok(Value::Empty)
        })
    })?;

    Ok(context)
}

fn tuple_value_to_vec_string(value: &Value) -> EvalexprResult<Vec<String>> {
    let tuple = value.as_tuple()?;
    let vec: Vec<String> = tuple
        .into_iter()
        .map(|k| k.as_string())
        .collect::<EvalexprResult<Vec<_>>>()?;

    Ok(vec)
}

fn find_device_by_expr_path<'a>(
    devices: &'a DevicesState,
    path: &NormalizedPath<'a>,
) -> Option<&'a Device> {
    let integration_id = path.get(1)?.to_string();
    let name = path.get(2)?.to_string();

    devices.0.values().find(|device| {
        device.integration_id.to_string() == integration_id
            && name_to_evalexpr(&device.name) == name
    })
}

fn context_write_vars_obj(expr: &Node, context: &HashMapContext) -> Result<serde_json::Value> {
    let mut obj = serde_json::Value::default();

    for var in expr.iter_write_variable_identifiers() {
        let value = context.get_value(var).ok_or_eyre(
            "Could not find value of expr variable that we're currently looping over",
        )?;
        let json_pointer = jsonptr::Pointer::try_from(format!("/{}", var.replace('.', "/")))?;
        let new_value = evalexpr_value_to_serde(value)?;
        obj.assign(&json_pointer, new_value)?;
    }

    Ok(obj)
}
pub fn eval_scene_expr(
    expr: &Node,
    context: &EvalContext,
    devices: &DevicesState,
) -> Result<HashMap<DeviceKey, SceneDeviceConfig>> {
    let mut context = context.clone();

    expr.eval_with_context_mut(&mut context)?;

    let write_vars_obj = context_write_vars_obj(expr, &context)?;

    let state_path = JsonPath::parse("$.devices.*.*.state").unwrap();
    let state_diff = state_path.query_located(&write_vars_obj);

    let mut result = HashMap::new();
    for q in state_diff {
        let path = q.location();
        let state = q.node();

        let Some(device) = find_device_by_expr_path(devices, path) else {
            warn!("Could not find device by expression path: {path}");
            continue;
        };
        let device = match device.set_value(state) {
            Ok(device) => device,
            Err(e) => {
                error!("Could not set value on device: {device}, {state}:\n{e}");
                continue;
            }
        };
        let Some(controllable_state) = device.get_controllable_state() else {
            continue;
        };

        let scene_device_config = SceneDeviceConfig::DeviceState(controllable_state.clone().into());
        result.insert(device.get_device_key(), scene_device_config);
    }

    Ok(result)
}

pub fn eval_action_expr(
    expr: &Node,
    context: &EvalContext,
    devices: &DevicesState,
    event_tx: &TxEventChannel,
) -> Result<()> {
    let mut context = context.clone();
    context.set_type_safety_checks_disabled(true)?;
    let actions = Arc::new(RwLock::new(Vec::<EvalExprAction>::new()));

    #[derive(Clone)]
    enum EvalExprAction {
        ActivateScene(SceneId),
        Custom(IntegrationId, IntegrationActionPayload),
        ForceTriggerRoutine(RoutineId),
    }

    {
        let actions = actions.clone();
        context.set_function(
            "activate_scene".into(),
            Function::new(move |argument| {
                let scene_id = argument.as_string()?.into();
                actions
                    .write()
                    .unwrap()
                    .push(EvalExprAction::ActivateScene(scene_id));
                Ok(Value::Empty)
            }),
        )?;
    }

    {
        let actions = actions.clone();
        context.set_function(
            "custom_action".into(),
            Function::new(move |argument| {
                let arguments = argument.as_tuple()?;
                let integration_id = arguments[0].as_string()?.into();
                let payload = tuple_value_to_vec_string(&arguments[1])?.join("").into();
                actions
                    .write()
                    .unwrap()
                    .push(EvalExprAction::Custom(integration_id, payload));
                Ok(Value::Empty)
            }),
        )?;
    }

    {
        let actions = actions.clone();
        context.set_function(
            "trigger_routine".into(),
            Function::new(move |argument| {
                let arguments = argument.as_tuple()?;
                let routine_id = arguments[0].as_string()?.into();
                actions
                    .write()
                    .unwrap()
                    .push(EvalExprAction::ForceTriggerRoutine(routine_id));
                Ok(Value::Empty)
            }),
        )?;
    }

    let result = expr.eval_with_context_mut(&mut context)?;

    // Skip actions dispatch if expression evaluated to false
    if let Value::Boolean(false) = result {
        return Ok(());
    }

    for action in actions.read().unwrap().iter() {
        let action = match action.clone() {
            EvalExprAction::ActivateScene(scene_id) => {
                let group_keys = context.get_value("group_keys").map_or(Ok(None), |v| {
                    let group_ids = tuple_value_to_vec_string(v)
                        .map(|vec| vec.into_iter().map(GroupId).collect());

                    Some(group_ids).transpose()
                })?;

                Action::ActivateScene(ActivateSceneDescriptor {
                    scene_id,
                    device_keys: None,
                    group_keys,
                })
            }
            EvalExprAction::Custom(integration_id, payload) => {
                Action::Custom(CustomActionDescriptor {
                    integration_id,
                    payload,
                })
            }
            EvalExprAction::ForceTriggerRoutine(routine_id) => {
                Action::ForceTriggerRoutine(ForceTriggerRoutineDescriptor { routine_id })
            }
        };

        event_tx.send(Event::Action(action));
    }

    let scenes_path = JsonPath::parse("$.devices.*.*.scene").unwrap();
    let state_path = JsonPath::parse("$.devices.*.*.state").unwrap();

    let write_vars_obj = context_write_vars_obj(expr, &context)?;

    let scenes_diff = scenes_path.query_located(&write_vars_obj);
    let state_diff = state_path.query_located(&write_vars_obj);

    for q in scenes_diff {
        let path = q.location();
        let scene_id = q.node();

        let Some(device) = find_device_by_expr_path(devices, path) else {
            continue;
        };

        let scene_id = scene_id.as_str().map(|s| SceneId::new(s.to_string()));

        if let Some(scene_id) = scene_id {
            event_tx.send(Event::Action(Action::ActivateScene(
                ActivateSceneDescriptor {
                    scene_id,
                    device_keys: Some(vec![device.get_device_key()]),
                    group_keys: None,
                },
            )));
        }
    }

    for q in state_diff {
        let path = q.location();
        let state = q.node();

        let Some(device) = find_device_by_expr_path(devices, path) else {
            continue;
        };

        match device.set_value(state) {
            Ok(device) => {
                event_tx.send(Event::Action(Action::SetDeviceState(device)));
            }
            Err(e) => {
                error!(
                    "Could not set value on device: {name:?},\ndata: {state}:\n{e}",
                    name = device.name
                );
            }
        }
    }

    Ok(())
}

pub fn debug_print_context(context: &HashMapContext) {
    let mut vars_sorted = context
        .iter_variables()
        .map(|(name, value)| format!("{name} = {value}"))
        .collect::<Vec<_>>();
    vars_sorted.sort();

    dbg!(&vars_sorted);
}

#[derive(Clone)]
pub struct Expr {
    context: HashMapContext,
}

impl Expr {
    pub fn new() -> Self {
        Expr {
            context: HashMapContext::new(),
        }
    }

    pub fn get_context(&self) -> &HashMapContext {
        &self.context
    }

    pub fn recompute(
        &self,
        devices_state: &DevicesState,
        groups: &Groups,
        scenes: &Scenes,
    ) -> HashMapContext {
        // TODO: decide whether we want to support scene expressions that reference
        // other scenes with expressions

        // let flattened_scenes = self.scenes.compute_flattened_scenes(devices, Some(scene_id));
        let flattened_scenes = scenes.get_flattened_scenes();
        let flattened_groups = groups.get_flattened_groups();

        state_to_eval_context(devices_state, flattened_scenes, flattened_groups)
            .expect("Failed to create eval context")
    }

    pub fn invalidate(&mut self, devices_state: &DevicesState, groups: &Groups, scenes: &Scenes) {
        let context = self.recompute(devices_state, groups, scenes);
        self.context = context;
    }
}

pub fn get_expr_device_deps(expr: &Node, devices: &DevicesState) -> HashSet<DeviceKey> {
    expr.iter_read_variable_identifiers()
        .filter_map(|name| {
            let path = name.split('.').collect::<Vec<_>>();

            if path.first() != Some(&"devices") {
                return None;
            }

            let integration_id = path.get(1)?;
            let name = path.get(2)?;

            devices.0.values().find(|device| {
                &device.integration_id.to_string() == integration_id
                    && &name_to_evalexpr(&device.name) == name
            })
        })
        .map(|device| device.get_device_key())
        .collect()
}

pub fn get_expr_group_device_deps(
    expr: &Node,
    groups: &FlattenedGroupsConfig,
) -> HashSet<DeviceKey> {
    expr.iter_read_variable_identifiers()
        .filter_map(|name| {
            let path = name.split('.').collect::<Vec<_>>();

            if path.first() != Some(&"groups") {
                return None;
            }

            let group_id = path.get(1)?;

            groups.0.get(&GroupId(group_id.to_string()))
        })
        .flat_map(|group| group.device_keys.clone())
        .collect()
}

pub fn get_expr_scene_deps(expr: &Node) -> HashSet<SceneId> {
    expr.iter_read_variable_identifiers()
        .filter_map(|name| {
            let path = name.split('.').collect::<Vec<_>>();

            if path.first() != Some(&"scenes") {
                return None;
            }

            let scene_id = path.get(1)?;
            Some(SceneId::new(scene_id.to_string()))
        })
        .collect()
}
