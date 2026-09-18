//! P07 script output contracts.
//!
//! Scripts are data producers, never side-effectful callers: every invocation
//! returns JSON that must match one of the four contracts from the plan
//! (condition/filter, routine handler, scene materializer, computed source).
//! Parsing is strict. A nonempty string, a Promise, an array, or a
//! wrong-shaped object is an error, not a truthy success; the only accepted
//! unknown result is the explicit `{ "kind": "unknown", ... }` shape.
//!
//! Contract parsing runs in the server process (the worker already rejected
//! non-JSON and non-finite results). Handler actions are normalized to the
//! same typed [`NativeAction`] used by native programs, so script and native
//! fixtures share one plan/trace path (X05/A09).

use std::collections::BTreeMap;

use serde_json::Value;

use crate::types::automation_definition::NativeAction;
use crate::types::automation_trace::{TruthValue, UnknownReason};

use super::compile::MAX_PROGRAM_ACTIONS;

/// Maximum total action nodes in one script result (including `choose`
/// branches), matching the compiler's stored-program bound.
pub const MAX_SCRIPT_ACTION_NODES: usize = 128;

/// Maximum serialized owner `next_state` accepted from one invocation.
pub const MAX_SCRIPT_STATE_BYTES: usize = 64 * 1024;

/// Maximum device entries in one scene materialization result.
pub const MAX_SCENE_MATERIALIZED_DEVICES: usize = 256;

/// The four invocation contracts. The ABI is shared; the expected result
/// shape depends on which contract invoked the script.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ScriptOutputContract {
    /// Strict boolean or explicit unknown; no commands or state writes.
    Condition,
    /// `{ actions, next_state? }` for a routine program.
    RoutineHandler,
    /// Typed scene device overrides for scene materialization.
    SceneMaterializer,
    /// One value matching the source's declared output schema.
    ComputedSource,
}

impl ScriptOutputContract {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Condition => "condition",
            Self::RoutineHandler => "routine_handler",
            Self::SceneMaterializer => "scene_materializer",
            Self::ComputedSource => "computed_source",
        }
    }
}

/// Three-valued condition result. `Known(false)` and `Unknown` both refuse
/// execution; they are never conflated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConditionOutcome {
    Known(bool),
    Unknown(UnknownReason),
}

impl ConditionOutcome {
    pub fn truth(&self) -> TruthValue {
        match self {
            Self::Known(true) => TruthValue::True,
            Self::Known(false) => TruthValue::False,
            Self::Unknown(_) => TruthValue::Unknown,
        }
    }

    pub fn authorizes_execution(&self) -> bool {
        matches!(self, Self::Known(true))
    }
}

/// A routine handler result: typed actions plus an optional bounded state
/// update.
#[derive(Clone, Debug, PartialEq)]
pub struct RoutineHandlerOutcome {
    pub actions: Vec<NativeAction>,
    pub next_state: Option<Value>,
}

/// A scene materializer result: per-device scene configuration overrides.
#[derive(Clone, Debug, PartialEq)]
pub struct SceneMaterializerOutcome {
    pub devices: BTreeMap<String, Value>,
}

/// A computed source result: one declared value plus an optional state update.
#[derive(Clone, Debug, PartialEq)]
pub struct ComputedSourceOutcome {
    pub value: Value,
    pub next_state: Option<Value>,
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn reject_unknown_fields(
    map: &serde_json::Map<String, Value>,
    allowed: &[&str],
    what: &str,
) -> Result<(), String> {
    for key in map.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(format!(
                "{what} contains unexpected field '{key}'; allowed: {}",
                allowed.join(", ")
            ));
        }
    }
    Ok(())
}

/// Parse a condition/filter result.
///
/// Accepted: `true`, `false`, or `{ "kind": "unknown" }` with an optional
/// structured `reason` (a serialized [`UnknownReason`]).
pub fn parse_condition_outcome(value: &Value) -> Result<ConditionOutcome, String> {
    match value {
        Value::Bool(result) => Ok(ConditionOutcome::Known(*result)),
        Value::Object(map) => {
            if map.get("kind").and_then(Value::as_str) != Some("unknown") {
                return Err(
                    "condition object results must be explicit `{kind: \"unknown\"}`".to_string(),
                );
            }
            reject_unknown_fields(map, &["kind", "reason"], "unknown condition result")?;
            let reason = match map.get("reason") {
                None | Some(Value::Null) => UnknownReason::UnknownSourceValue {
                    source: "script".to_string(),
                },
                Some(reason) => serde_json::from_value(reason.clone())
                    .map_err(|error| format!("invalid unknown reason: {error}"))?,
            };
            Ok(ConditionOutcome::Unknown(reason))
        }
        other => Err(format!(
            "condition results must be a strict boolean or an explicit unknown object, got {}",
            json_kind(other)
        )),
    }
}

/// Parse and type-check a routine handler result.
pub fn parse_routine_handler_outcome(
    value: &Value,
    max_state_bytes: usize,
) -> Result<RoutineHandlerOutcome, String> {
    let Value::Object(map) = value else {
        return Err(format!(
            "routine handler results must be an object with an 'actions' array, got {}",
            json_kind(value)
        ));
    };
    reject_unknown_fields(map, &["actions", "next_state"], "routine handler result")?;

    let Some(Value::Array(actions)) = map.get("actions") else {
        return Err("routine handler results require an 'actions' array".to_string());
    };
    if actions.len() > MAX_PROGRAM_ACTIONS {
        return Err(format!(
            "routine handler returned {} actions; the limit is {MAX_PROGRAM_ACTIONS}",
            actions.len()
        ));
    }

    let mut parsed = Vec::with_capacity(actions.len());
    let mut nodes = 0usize;
    for (index, action) in actions.iter().enumerate() {
        let normalized = normalize_script_action(action, index)?;
        nodes += count_action_nodes(&normalized);
        if nodes > MAX_SCRIPT_ACTION_NODES {
            return Err(format!(
                "routine handler actions exceed {MAX_SCRIPT_ACTION_NODES} total nodes"
            ));
        }
        parsed.push(normalized);
    }

    let next_state = match map.get("next_state") {
        None | Some(Value::Null) => None,
        Some(state) => {
            let bytes = serde_json::to_vec(state)
                .map_err(|error| format!("next_state is not JSON-serializable: {error}"))?;
            if bytes.len() > max_state_bytes {
                return Err(format!(
                    "next_state is {} bytes; the limit is {max_state_bytes}",
                    bytes.len()
                ));
            }
            Some(state.clone())
        }
    };

    Ok(RoutineHandlerOutcome {
        actions: parsed,
        next_state,
    })
}

/// Parse and type-check a scene materializer result.
pub fn parse_scene_materializer_outcome(value: &Value) -> Result<SceneMaterializerOutcome, String> {
    let Value::Object(map) = value else {
        return Err(format!(
            "scene materializer results must be an object, got {}",
            json_kind(value)
        ));
    };
    reject_unknown_fields(map, &["devices"], "scene materializer result")?;

    let Some(Value::Object(devices)) = map.get("devices") else {
        return Err("scene materializer results require a 'devices' object".to_string());
    };
    if devices.len() > MAX_SCENE_MATERIALIZED_DEVICES {
        return Err(format!(
            "scene materializer returned {} devices; the limit is {MAX_SCENE_MATERIALIZED_DEVICES}",
            devices.len()
        ));
    }

    let mut parsed = BTreeMap::new();
    for (key, config) in devices {
        let Some((integration_id, device_id)) = key.split_once('/') else {
            return Err(format!(
                "scene materializer device key '{key}' must be '<integration>/<device>'"
            ));
        };
        if integration_id.is_empty() || device_id.is_empty() {
            return Err(format!(
                "scene materializer device key '{key}' has an empty segment"
            ));
        }
        if !config.is_object() {
            return Err(format!(
                "scene materializer device '{key}' must map to a configuration object"
            ));
        }
        parsed.insert(key.clone(), config.clone());
    }

    Ok(SceneMaterializerOutcome { devices: parsed })
}

/// Parse and type-check a computed source result.
pub fn parse_computed_source_outcome(
    value: &Value,
    max_state_bytes: usize,
) -> Result<ComputedSourceOutcome, String> {
    let Value::Object(map) = value else {
        return Err(format!(
            "computed source results must be an object with a 'value' field, got {}",
            json_kind(value)
        ));
    };
    reject_unknown_fields(map, &["value", "next_state"], "computed source result")?;

    let Some(value) = map.get("value") else {
        return Err("computed source results require a 'value' field".to_string());
    };

    let next_state = match map.get("next_state") {
        None | Some(Value::Null) => None,
        Some(state) => {
            let bytes = serde_json::to_vec(state)
                .map_err(|error| format!("next_state is not JSON-serializable: {error}"))?;
            if bytes.len() > max_state_bytes {
                return Err(format!(
                    "next_state is {} bytes; the limit is {max_state_bytes}",
                    bytes.len()
                ));
            }
            Some(state.clone())
        }
    };

    Ok(ComputedSourceOutcome {
        value: value.clone(),
        next_state,
    })
}

/// Give every script action a stable node ID and deserialize it into the
/// shared typed action model.
fn normalize_script_action(action: &Value, index: usize) -> Result<NativeAction, String> {
    let Value::Object(map) = action else {
        return Err(format!(
            "actions/{index} must be an object, got {}",
            json_kind(action)
        ));
    };
    if map.get("action").and_then(Value::as_str).is_none() {
        return Err(format!("actions/{index} is missing an 'action' tag"));
    }

    let mut normalized = map.clone();
    let has_id = normalized
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.is_empty());
    if !has_id {
        normalized.insert("id".to_string(), Value::String(format!("script/{index}")));
    }

    serde_json::from_value::<NativeAction>(Value::Object(normalized))
        .map_err(|error| format!("actions/{index} is not a valid action: {error}"))
}

fn count_action_nodes(action: &NativeAction) -> usize {
    match action {
        NativeAction::Choose { branches, .. } => {
            1 + branches
                .iter()
                .map(|branch| branch.steps.iter().map(count_action_nodes).sum::<usize>())
                .sum::<usize>()
        }
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn s10_condition_contract_is_strict() {
        assert_eq!(
            parse_condition_outcome(&json!(true)).unwrap(),
            ConditionOutcome::Known(true)
        );
        assert_eq!(
            parse_condition_outcome(&json!(false)).unwrap(),
            ConditionOutcome::Known(false)
        );
        assert_eq!(
            parse_condition_outcome(&json!({"kind": "unknown"})).unwrap(),
            ConditionOutcome::Unknown(UnknownReason::UnknownSourceValue {
                source: "script".to_string()
            })
        );
        assert_eq!(
            parse_condition_outcome(
                &json!({"kind": "unknown", "reason": {"kind": "missing_entity", "entity": "lamp"}})
            )
            .unwrap(),
            ConditionOutcome::Unknown(UnknownReason::MissingEntity {
                entity: "lamp".to_string()
            })
        );

        for rejected in [
            json!("yes"),
            json!(1),
            json!([]),
            json!({}),
            json!({"kind": "unknown", "reason": "missing"}),
            json!({"kind": "known", "value": true}),
            json!({"kind": "unknown", "extra": 1}),
            json!(null),
        ] {
            assert!(
                parse_condition_outcome(&rejected).is_err(),
                "{rejected} should be rejected"
            );
        }

        assert!(!ConditionOutcome::Unknown(UnknownReason::NotInitialized {
            entity: "x".to_string()
        })
        .authorizes_execution());
    }

    #[test]
    fn handler_contract_normalizes_actions() {
        let outcome = parse_routine_handler_outcome(
            &json!({
                "actions": [
                    {"action": "set_power", "device": {"integration_id": "dummy", "device_id": "lamp"}, "power": true},
                    {"action": "activate_scene", "id": "keep", "scene_id": "evening", "targets": {"groups": ["room"]}}
                ],
                "next_state": {"step": 2}
            }),
            MAX_SCRIPT_STATE_BYTES,
        )
        .unwrap();

        assert_eq!(outcome.actions.len(), 2);
        assert_eq!(outcome.actions[0].id().as_str(), "script/0");
        assert_eq!(outcome.actions[1].id().as_str(), "keep");
        assert_eq!(outcome.next_state, Some(json!({"step": 2})));
    }

    #[test]
    fn handler_contract_rejects_wrong_shapes() {
        for rejected in [
            json!(true),
            json!([]),
            json!({}),
            json!({"actions": "nope"}),
            json!({"actions": [{"action": "set_power"}]}),
            json!({"actions": [], "extra": 1}),
        ] {
            assert!(
                parse_routine_handler_outcome(&rejected, MAX_SCRIPT_STATE_BYTES).is_err(),
                "{rejected} should be rejected"
            );
        }

        let too_many = (0..=MAX_PROGRAM_ACTIONS)
            .map(|_| json!({"action": "cancel_timer", "timer": "t"}))
            .collect::<Vec<_>>();
        assert!(parse_routine_handler_outcome(
            &json!({"actions": too_many}),
            MAX_SCRIPT_STATE_BYTES
        )
        .is_err());

        let too_large_state =
            json!({"actions": [], "next_state": {"blob": "x".repeat(MAX_SCRIPT_STATE_BYTES + 1)}});
        assert!(parse_routine_handler_outcome(&too_large_state, MAX_SCRIPT_STATE_BYTES).is_err());
    }

    #[test]
    fn nested_choose_nodes_are_counted() {
        let mut steps = Vec::new();
        for _ in 0..MAX_SCRIPT_ACTION_NODES {
            steps.push(json!({"action": "cancel_timer", "timer": "t"}));
        }
        let nested = json!({
            "actions": [{
                "action": "choose",
                "branches": [{ "id": "b", "condition": {"kind": "literal", "value": true}, "steps": steps }]
            }]
        });
        assert!(parse_routine_handler_outcome(&nested, MAX_SCRIPT_STATE_BYTES).is_err());
    }

    #[test]
    fn scene_and_source_contracts_validate_shapes() {
        let scene = parse_scene_materializer_outcome(&json!({
            "devices": {"dummy/lamp": {"power": true}}
        }))
        .unwrap();
        assert_eq!(scene.devices.len(), 1);
        assert!(parse_scene_materializer_outcome(&json!({
            "devices": {"no-slash": {"power": true}}
        }))
        .is_err());
        assert!(parse_scene_materializer_outcome(&json!({"devices": {"a/b": 1}})).is_err());

        let source = parse_computed_source_outcome(
            &json!({"value": {"color": "#fff"}, "next_state": {"n": 1}}),
            MAX_SCRIPT_STATE_BYTES,
        )
        .unwrap();
        assert_eq!(source.value, json!({"color": "#fff"}));
        assert!(parse_computed_source_outcome(&json!({}), MAX_SCRIPT_STATE_BYTES).is_err());
    }
}
