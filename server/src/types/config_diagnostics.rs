use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Serialize, TS, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DiagnosticSeverity {
    Warning,
    Info,
}

#[derive(Clone, Copy, Debug, Serialize, TS, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DiagnosticEntity {
    Group,
    Scene,
    Device,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ConfigDiagnostic {
    pub id: String,
    pub severity: DiagnosticSeverity,
    pub entity: DiagnosticEntity,
    pub entity_id: String,
    pub name: String,
    pub code: String,
    pub message: String,
    pub suggestion: String,
}

/// Read-only inspection of one immutable runtime snapshot. Scripts are not executed.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ConfigDiagnostics {
    pub warming_up: bool,
    pub issues: Vec<ConfigDiagnostic>,
}
