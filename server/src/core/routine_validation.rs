//! Shared routine validation (P01).
//!
//! This module centralizes structural validation of legacy (v1) routine
//! definitions so save/enable paths and the runtime loader agree. It never
//! mutates live state and never executes user JavaScript: script sources are
//! parsed only, and only from the off-actor save path.
//!
//! The report shape (`path`, `code`, `message`) is the precursor of the v2
//! `ValidationReport` described in the automation plan.

use boa_engine::{script::Script, Context, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::{
    action::{Action, Actions},
    rule::Rule,
};

/// One validation problem, addressable by JSON path.
///
/// `node_id` and `related_entity` are optional v2 compiler metadata; v1
/// validation leaves them empty.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutineValidationError {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub related_entity: Option<String>,
}

/// Ordered set of validation problems.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutineValidationReport {
    pub errors: Vec<RoutineValidationError>,
}

impl RoutineValidationReport {
    pub fn error(
        &mut self,
        path: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.errors.push(RoutineValidationError {
            path: path.into(),
            node_id: None,
            code: code.into(),
            message: message.into(),
            related_entity: None,
        });
    }

    /// Record an error tied to a stable definition node ID.
    pub fn error_at_node(
        &mut self,
        path: impl Into<String>,
        node_id: impl std::fmt::Display,
        code: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.errors.push(RoutineValidationError {
            path: path.into(),
            node_id: Some(node_id.to_string()),
            code: code.into(),
            message: message.into(),
            related_entity: None,
        });
    }

    /// Record an error with an optional node ID and a related entity.
    pub fn error_with_entity(
        &mut self,
        path: impl Into<String>,
        node_id: Option<&str>,
        code: impl Into<String>,
        message: impl Into<String>,
        related_entity: impl Into<String>,
    ) {
        self.errors.push(RoutineValidationError {
            path: path.into(),
            node_id: node_id.map(ToOwned::to_owned),
            code: code.into(),
            message: message.into(),
            related_entity: Some(related_entity.into()),
        });
    }

    pub fn merge(&mut self, other: Self) {
        self.errors.extend(other.errors);
    }

    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    /// Flatten to a single operator-facing string for the legacy v1 API.
    pub fn summary(&self) -> String {
        self.errors
            .iter()
            .map(|error| format!("{}: {}", error.path, error.message))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

/// A routine row that decoded and validated successfully.
#[derive(Clone, Debug)]
pub struct ValidatedRoutine {
    pub id: String,
    pub name: String,
    pub rules: Vec<Rule>,
    pub actions: Actions,
}

/// Validate and decode legacy `rules` JSON. Empty rule lists are rejected so an
/// enabled routine can never silently become an always-false empty definition.
pub fn validate_rules_value(rules: &Value) -> Result<Vec<Rule>, RoutineValidationReport> {
    let mut report = RoutineValidationReport::default();

    let parsed: Vec<Rule> = match serde_json::from_value(rules.clone()) {
        Ok(parsed) => parsed,
        Err(error) => {
            report.error(
                "/rules",
                "invalid_rules",
                format!("Rules are not a valid rule list: {error}"),
            );
            return Err(report);
        }
    };

    if parsed.is_empty() {
        report.error(
            "/rules",
            "empty_rules",
            "A routine must define at least one rule.",
        );
    }

    for (index, rule) in parsed.iter().enumerate() {
        validate_rule(rule, &format!("/rules/{index}"), &mut report);
    }

    if report.is_valid() {
        Ok(parsed)
    } else {
        Err(report)
    }
}

/// Validate and decode legacy `actions` JSON.
pub fn validate_actions_value(actions: &Value) -> Result<Actions, RoutineValidationReport> {
    let mut report = RoutineValidationReport::default();

    let parsed: Actions = match serde_json::from_value(actions.clone()) {
        Ok(parsed) => parsed,
        Err(error) => {
            report.error(
                "/actions",
                "invalid_actions",
                format!("Actions are not a valid action list: {error}"),
            );
            return Err(report);
        }
    };

    for (index, action) in parsed.iter().enumerate() {
        if let Some(message) = non_finite_action(action) {
            report.error(
                format!("/actions/{index}"),
                "nonfinite_action_value",
                message,
            );
        }
    }

    if report.is_valid() {
        Ok(parsed)
    } else {
        Err(report)
    }
}

/// Validate and decode a full legacy routine definition.
pub fn validate_definition(
    rules: &Value,
    actions: &Value,
) -> Result<ValidatedRoutine, RoutineValidationReport> {
    let mut report = RoutineValidationReport::default();

    let parsed_rules = match validate_rules_value(rules) {
        Ok(rules) => rules,
        Err(rules_report) => {
            report.errors.extend(rules_report.errors);
            Vec::new()
        }
    };

    let parsed_actions = match validate_actions_value(actions) {
        Ok(actions) => actions,
        Err(actions_report) => {
            report.errors.extend(actions_report.errors);
            Vec::new()
        }
    };

    if !report.is_valid() {
        return Err(report);
    }

    Ok(ValidatedRoutine {
        id: String::new(),
        name: String::new(),
        rules: parsed_rules,
        actions: parsed_actions,
    })
}

/// Parse (never execute) every script source reachable from the given rules.
/// Intended for the off-actor save/enable path only.
pub fn validate_script_syntax(rules: &[Rule]) -> RoutineValidationReport {
    let mut report = RoutineValidationReport::default();
    validate_script_syntax_inner(rules, "/rules", &mut report);
    report
}

fn validate_script_syntax_inner(
    rules: &[Rule],
    prefix: &str,
    report: &mut RoutineValidationReport,
) {
    for (index, rule) in rules.iter().enumerate() {
        let path = format!("{prefix}/{index}");
        match rule {
            Rule::Script(script) => {
                if let Err(message) = parse_script(&script.script) {
                    report.error(format!("{path}/script"), "invalid_script_syntax", message);
                }
            }
            Rule::Any(any) => {
                validate_script_syntax_inner(&any.any, &format!("{path}/any"), report);
            }
            _ => {}
        }
    }
}

pub(crate) fn parse_script(source: &str) -> Result<(), String> {
    let mut context = Context::default();
    Script::parse(Source::from_bytes(source), None, &mut context)
        .map(|_| ())
        .map_err(|error| format!("Script failed to parse: {error}"))
}

fn validate_rule(rule: &Rule, path: &str, report: &mut RoutineValidationReport) {
    match rule {
        Rule::EvalExpr(_) => report.error(
            path,
            "unsupported_legacy_rule",
            "Legacy evalexpr rules are no longer supported.",
        ),
        Rule::Any(any) => {
            for (index, child) in any.any.iter().enumerate() {
                validate_rule(child, &format!("{path}/any/{index}"), report);
            }
        }
        _ => {}
    }
}

fn non_finite_action(action: &Action) -> Option<String> {
    match action {
        Action::Dim(descriptor) => descriptor
            .step
            .filter(|step| !step.is_finite())
            .map(|step| format!("Dim step must be finite, got {step}")),
        Action::RandomizeColor(descriptor) => {
            for (name, value) in [
                ("min_saturation", descriptor.min_saturation),
                ("max_saturation", descriptor.max_saturation),
            ] {
                if let Some(value) = value {
                    if !value.is_finite() {
                        return Some(format!("RandomizeColor {name} must be finite, got {value}"));
                    }
                }
            }
            descriptor
                .transition
                .filter(|transition| !transition.is_finite())
                .map(|transition| {
                    format!("RandomizeColor transition must be finite, got {transition}")
                })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_rule() -> Value {
        json!([{
            "state": { "value": true },
            "integration_id": "test",
            "device_id": "sensor"
        }])
    }

    fn valid_action() -> Value {
        json!([{
            "action": "Dim",
            "device_keys": null,
            "group_keys": null,
            "step": -0.1
        }])
    }

    #[test]
    fn v01_malformed_rules_report_a_path_specific_error() {
        let report = validate_rules_value(&json!({ "not": "a rule list" })).unwrap_err();
        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.errors[0].path, "/rules");
        assert_eq!(report.errors[0].code, "invalid_rules");
    }

    #[test]
    fn v01_empty_rule_list_is_rejected() {
        let report = validate_rules_value(&json!([])).unwrap_err();
        assert_eq!(report.errors[0].code, "empty_rules");
    }

    #[test]
    fn v01_legacy_evalexpr_rule_is_rejected_with_a_path() {
        let report = validate_rules_value(&json!(["a + b"])).unwrap_err();
        assert_eq!(report.errors[0].path, "/rules/0");
        assert_eq!(report.errors[0].code, "unsupported_legacy_rule");
    }

    #[test]
    fn v02_invalid_script_syntax_is_reported_without_execution() {
        let rules = validate_rules_value(&json!([{ "script": "if (" }])).unwrap();
        let report = validate_script_syntax(&rules);
        assert!(!report.is_valid());
        assert_eq!(report.errors[0].code, "invalid_script_syntax");
        assert_eq!(report.errors[0].path, "/rules/0/script");
    }

    #[test]
    fn v03_nonfinite_action_values_are_rejected() {
        let actions = json!([{
            "action": "Dim",
            "device_keys": null,
            "group_keys": null,
            "step": 1e39
        }]);
        // serde_json may decode 1e39 to f32::INFINITY; if it errors first the
        // action is rejected just the same.
        match validate_actions_value(&actions) {
            Ok(_) => panic!("nonfinite dim step must not validate"),
            Err(report) => assert!(report
                .errors
                .iter()
                .any(|error| error.code == "nonfinite_action_value")),
        }
    }

    #[test]
    fn valid_definition_passes_both_checks() {
        let validated = validate_definition(&valid_rule(), &valid_action()).unwrap();
        assert_eq!(validated.rules.len(), 1);
        assert_eq!(validated.actions.len(), 1);
        assert!(validate_script_syntax(&validated.rules).is_valid());
    }
}
