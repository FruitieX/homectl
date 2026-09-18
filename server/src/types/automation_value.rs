//! Typed helper values (P05).
//!
//! Helpers are the native, DB-backed state primitives used by v2 routines:
//! boolean, enum, bounded number, and string. The staircase mode is an enum
//! helper, not derived scene unanimity. Definitions and current values live in
//! the database; only user-visible names/options are exported configuration,
//! while live values follow the explicit export policy.
//!
//! Validation is identical at save/enable/import and at runtime writes so a
//! helper can never hold a value its definition does not allow.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::automation_definition::HelperId;

/// Declared type and constraints of a helper.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum HelperKind {
    Boolean,
    Enum {
        options: Vec<String>,
    },
    Number {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        min: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max: Option<f64>,
    },
    String,
}

impl HelperKind {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Boolean => "boolean",
            Self::Enum { .. } => "enum",
            Self::Number { .. } => "number",
            Self::String => "string",
        }
    }

    /// Structural validation independent of a concrete value.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Boolean | Self::String => Ok(()),
            Self::Enum { options } => {
                if options.is_empty() {
                    return Err("An enum helper requires at least one option.".to_string());
                }
                let mut seen = BTreeSet::new();
                for option in options {
                    if option.trim().is_empty() {
                        return Err("Enum options must not be empty.".to_string());
                    }
                    if !seen.insert(option) {
                        return Err(format!("Duplicate enum option '{option}'."));
                    }
                }
                Ok(())
            }
            Self::Number { min, max } => {
                if let (Some(min), Some(max)) = (min, max) {
                    if min > max {
                        return Err("Number helper minimum exceeds its maximum.".to_string());
                    }
                }
                for bound in [min, max].into_iter().flatten() {
                    if !bound.is_finite() {
                        return Err("Number helper bounds must be finite.".to_string());
                    }
                }
                Ok(())
            }
        }
    }

    pub fn validate_value(&self, value: &Value) -> Result<(), String> {
        match self {
            Self::Boolean => {
                if !value.is_boolean() {
                    return Err("Expected a boolean value.".to_string());
                }
            }
            Self::String => {
                if !value.is_string() {
                    return Err("Expected a string value.".to_string());
                }
            }
            Self::Enum { options } => {
                let Some(option) = value.as_str() else {
                    return Err("Expected an enum option string.".to_string());
                };
                if !options.iter().any(|candidate| candidate == option) {
                    return Err(format!("'{option}' is not one of the declared options."));
                }
            }
            Self::Number { min, max } => {
                let Some(number) = value.as_f64() else {
                    return Err("Expected a number value.".to_string());
                };
                if !number.is_finite() {
                    return Err("Number values must be finite.".to_string());
                }
                if let Some(min) = min {
                    if number < *min {
                        return Err(format!("Value is below the minimum {min}."));
                    }
                }
                if let Some(max) = max {
                    if number > *max {
                        return Err(format!("Value is above the maximum {max}."));
                    }
                }
            }
        }
        Ok(())
    }
}

/// How a helper's current value survives restarts.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HelperPersistence {
    /// Current value is stored in the database (default).
    #[default]
    Durable,
    /// Current value lives only for this process lifetime.
    Session,
}

/// A helper definition plus its initial value.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct HelperDefinition {
    pub id: HelperId,
    pub name: String,
    pub kind: HelperKind,
    /// Value used before any durable/current value exists.
    #[serde(default)]
    pub initial_value: Value,
    #[serde(default)]
    pub persistence: HelperPersistence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hidden: Option<bool>,
}

impl HelperDefinition {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: HelperKind) -> Self {
        let kind_for_initial = kind.clone();
        Self {
            id: HelperId(id.into()),
            name: name.into(),
            kind,
            initial_value: default_value_for(&kind_for_initial),
            persistence: HelperPersistence::default(),
            hidden: None,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.id.as_str().trim().is_empty() {
            return Err("A helper ID must not be empty.".to_string());
        }
        if self.name.trim().is_empty() {
            return Err("A helper name must not be empty.".to_string());
        }
        self.kind.validate()?;
        self.kind
            .validate_value(&self.initial_value)
            .map_err(|error| format!("Initial value is invalid: {error}"))
    }
}

fn default_value_for(kind: &HelperKind) -> Value {
    match kind {
        HelperKind::Boolean => Value::Bool(false),
        HelperKind::Enum { options } => options
            .first()
            .cloned()
            .map(Value::String)
            .unwrap_or(Value::Null),
        HelperKind::Number { min, .. } => Value::from(min.unwrap_or(0.0)),
        HelperKind::String => Value::String(String::new()),
    }
}

/// Current value of a helper plus its optimistic revision. Values persist in
/// `automation_value_state` for durable helpers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HelperValueState {
    pub value: Value,
    pub revision: i64,
}

/// API/runtime view of one helper.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct HelperRuntimeStatus {
    pub id: HelperId,
    pub name: String,
    pub kind: HelperKind,
    pub value: Value,
    pub initial_value: Value,
    pub revision: i64,
    pub persistence: HelperPersistence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hidden: Option<bool>,
}
