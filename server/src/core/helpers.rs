//! Runtime registry for typed helper values (P05).
//!
//! Definitions and durable current values live in the database; the actor owns
//! this in-memory projection. Every write is validated against the definition,
//! so a helper can never hold an illegal value. Session helpers are never
//! persisted.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::types::automation_definition::HelperId;
use crate::types::automation_value::{
    HelperComputeStatus, HelperDefinition, HelperPersistence, HelperRuntimeStatus, HelperValueState,
};

#[derive(Debug, Clone, PartialEq)]
pub enum HelperWriteError {
    UnknownHelper(HelperId),
    InvalidValue { helper: HelperId, message: String },
}

impl std::fmt::Display for HelperWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownHelper(id) => write!(formatter, "Unknown helper '{id}'."),
            Self::InvalidValue { helper, message } => {
                write!(
                    formatter,
                    "Value is invalid for helper '{helper}': {message}"
                )
            }
        }
    }
}

impl std::error::Error for HelperWriteError {}

#[derive(Clone, Debug, Default)]
pub struct Helpers {
    definitions: BTreeMap<HelperId, HelperDefinition>,
    values: BTreeMap<HelperId, HelperValueState>,
    pub(crate) computations: BTreeMap<HelperId, ComputationCursor>,
    pub(crate) changed: bool,
    before_frame: Option<Box<Helpers>>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ComputationCursor {
    pub fingerprint: String,
    pub dispatched_at_ms: i64,
    pub request_id: Option<u64>,
    pub status: Option<HelperComputeStatus>,
}

impl Helpers {
    pub fn begin_frame(&mut self) {
        self.before_frame = None;
    }
    pub fn capture_before(&mut self) {
        if self.before_frame.is_none() {
            let mut before = self.clone();
            before.before_frame = None;
            self.before_frame = Some(Box::new(before));
        }
    }
    pub fn before_frame(&self) -> &Helpers {
        self.before_frame.as_deref().unwrap_or(self)
    }
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace definitions and durable values from the database projection.
    /// Existing session and computed last-good values survive a reload when
    /// still valid. Removed definitions lose their values; durable manual
    /// helpers are restored from the database projection.
    pub fn load_rows(
        &mut self,
        definitions: Vec<HelperDefinition>,
        durable_values: Vec<(HelperId, Value, i64)>,
    ) {
        self.definitions = definitions
            .into_iter()
            .map(|definition| (definition.id.clone(), definition))
            .collect();
        self.computations.clear();
        self.before_frame = None;
        self.values.retain(|id, state| {
            self.definitions.get(id).is_some_and(|definition| {
                (definition.persistence == HelperPersistence::Session
                    || definition.compute.is_some())
                    && definition.kind.validate_value(&state.value).is_ok()
            })
        });
        for (id, value, revision) in durable_values {
            if self
                .definitions
                .get(&id)
                .is_none_or(|definition| definition.persistence != HelperPersistence::Durable)
            {
                continue;
            }
            if self
                .values
                .get(&id)
                .is_none_or(|current| current.revision <= revision)
            {
                self.values.insert(id, HelperValueState { value, revision });
            }
        }
    }

    pub fn definitions(&self) -> &BTreeMap<HelperId, HelperDefinition> {
        &self.definitions
    }

    pub fn definition(&self, id: &HelperId) -> Option<&HelperDefinition> {
        self.definitions.get(id)
    }

    /// Current value, falling back to the definition's initial value.
    pub fn value(&self, id: &HelperId) -> Option<&Value> {
        if let Some(state) = self.values.get(id) {
            return Some(&state.value);
        }
        self.definitions
            .get(id)
            .map(|definition| &definition.initial_value)
    }

    pub fn revision(&self, id: &HelperId) -> i64 {
        self.values.get(id).map(|state| state.revision).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty()
    }

    /// Validated write used by `SetHelper` actions and the API. Returns the
    /// new state so callers can persist it.
    pub fn set_value(
        &mut self,
        id: &HelperId,
        value: Value,
    ) -> Result<HelperValueState, HelperWriteError> {
        let Some(definition) = self.definitions.get(id) else {
            return Err(HelperWriteError::UnknownHelper(id.clone()));
        };
        if definition.compute.is_some() {
            return Err(HelperWriteError::InvalidValue {
                helper: id.clone(),
                message: "Computed helpers are read-only.".into(),
            });
        }
        self.write_value(id, value)
    }

    pub(crate) fn write_value(
        &mut self,
        id: &HelperId,
        value: Value,
    ) -> Result<HelperValueState, HelperWriteError> {
        self.capture_before();
        let definition = self
            .definitions
            .get(id)
            .ok_or_else(|| HelperWriteError::UnknownHelper(id.clone()))?;
        definition.kind.validate_value(&value).map_err(|message| {
            HelperWriteError::InvalidValue {
                helper: id.clone(),
                message,
            }
        })?;
        let revision = self.revision(id) + 1;
        self.changed |= self.value(id) != Some(&value);
        let state = HelperValueState { value, revision };
        self.values.insert(id.clone(), state.clone());
        Ok(state)
    }

    pub fn statuses(&self) -> Vec<HelperRuntimeStatus> {
        self.definitions
            .values()
            .map(|definition| HelperRuntimeStatus {
                id: definition.id.clone(),
                name: definition.name.clone(),
                kind: definition.kind.clone(),
                value: self.value(&definition.id).cloned().unwrap_or(Value::Null),
                initial_value: definition.initial_value.clone(),
                revision: self.revision(&definition.id),
                persistence: definition.persistence,
                hidden: definition.hidden,
                compute: definition.compute.clone(),
                compute_status: definition.compute.as_ref().map(|compute| {
                    self.computations
                        .get(&definition.id)
                        .and_then(|cursor| cursor.status.clone())
                        .unwrap_or(HelperComputeStatus {
                            state: if compute.enabled {
                                "pending"
                            } else {
                                "disabled"
                            }
                            .into(),
                            evaluated_at_ms: None,
                            error: None,
                        })
                }),
            })
            .collect()
    }

    /// Validate and insert/replace a definition. A current value that no longer
    /// fits the new kind is reset to the initial value.
    pub fn upsert_definition(&mut self, definition: HelperDefinition) -> Result<(), String> {
        definition.validate()?;
        if let Some(state) = self.values.get(&definition.id) {
            if definition.kind.validate_value(&state.value).is_err() {
                self.values.remove(&definition.id);
            }
        }
        self.computations.remove(&definition.id);
        self.definitions.insert(definition.id.clone(), definition);
        Ok(())
    }

    pub fn remove_definition(&mut self, id: &HelperId) -> bool {
        let removed = self.definitions.remove(id).is_some();
        self.values.remove(id);
        self.computations.remove(id);
        removed
    }

    pub fn value_is_known(&self, id: &HelperId) -> bool {
        self.definition(id).is_some_and(|definition| {
            definition.compute.is_none()
                || self
                    .computations
                    .get(id)
                    .and_then(|cursor| cursor.status.as_ref())
                    .is_some_and(|status| matches!(status.state.as_str(), "fresh" | "updating"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::automation_value::HelperKind;
    use serde_json::json;

    #[test]
    fn option_edits_preserve_valid_current_values_and_reset_removed_choices() {
        let mut helpers = Helpers::new();
        let mut definition = HelperDefinition::new(
            "mode",
            "Mode",
            HelperKind::Enum {
                options: vec!["on".into(), "off".into(), "away".into()],
            },
        );
        definition.initial_value = json!("off");
        helpers.upsert_definition(definition.clone()).unwrap();
        helpers.set_value(&definition.id, json!("away")).unwrap();
        definition.kind = HelperKind::Enum {
            options: vec!["on".into(), "away".into()],
        };
        assert!(
            helpers.upsert_definition(definition.clone()).is_err(),
            "removing the initial choice requires repair"
        );
        assert_eq!(helpers.value(&definition.id), Some(&json!("away")));
        definition.initial_value = json!("on");
        helpers.upsert_definition(definition.clone()).unwrap();
        assert_eq!(helpers.value(&definition.id), Some(&json!("away")));
        definition.kind = HelperKind::Enum {
            options: vec!["on".into()],
        };
        helpers.upsert_definition(definition.clone()).unwrap();
        assert_eq!(helpers.value(&definition.id), Some(&json!("on")));
        for options in [vec![], vec!["".into()], vec!["on".into(), "on".into()]] {
            definition.kind = HelperKind::Enum { options };
            assert!(helpers.upsert_definition(definition.clone()).is_err());
            assert_eq!(helpers.value(&definition.id), Some(&json!("on")));
        }
    }

    #[test]
    fn scalar_initial_values_and_numeric_bounds_follow_the_editor_contract() {
        for (kind, value) in [
            (HelperKind::Boolean, json!(false)),
            (HelperKind::String, json!("")),
            (
                HelperKind::Number {
                    min: Some(-10.0),
                    max: Some(10.0),
                },
                json!(0),
            ),
        ] {
            let mut definition = HelperDefinition::new("value", "Value", kind);
            definition.initial_value = value;
            assert!(definition.validate().is_ok());
            definition.initial_value = json!(null);
            assert!(definition.validate().is_err());
        }
        assert!(HelperKind::Number {
            min: None,
            max: None
        }
        .validate_value(&json!(-12.5))
        .is_ok());
        assert!(HelperKind::Number {
            min: Some(11.0),
            max: Some(10.0)
        }
        .validate()
        .is_err());
    }
}
