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
    HelperDefinition, HelperPersistence, HelperRuntimeStatus, HelperValueState,
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
}

impl Helpers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace definitions and durable values from the database projection.
    /// Existing session values survive a reload; values for removed or
    /// non-durable helpers are dropped in favor of the initial value.
    pub fn load_rows(
        &mut self,
        definitions: Vec<HelperDefinition>,
        durable_values: Vec<(HelperId, Value, i64)>,
    ) {
        self.definitions = definitions
            .into_iter()
            .map(|definition| (definition.id.clone(), definition))
            .collect();
        self.values.retain(|id, _| {
            self.definitions
                .get(id)
                .is_some_and(|definition| definition.persistence == HelperPersistence::Session)
        });
        for (id, value, revision) in durable_values {
            if self
                .definitions
                .get(&id)
                .is_none_or(|definition| definition.persistence != HelperPersistence::Durable)
            {
                continue;
            }
            self.values.insert(id, HelperValueState { value, revision });
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
        definition.kind.validate_value(&value).map_err(|message| {
            HelperWriteError::InvalidValue {
                helper: id.clone(),
                message,
            }
        })?;
        let revision = self.revision(id) + 1;
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
        self.definitions.insert(definition.id.clone(), definition);
        Ok(())
    }

    pub fn remove_definition(&mut self, id: &HelperId) -> bool {
        let removed = self.definitions.remove(id).is_some();
        self.values.remove(id);
        removed
    }
}
