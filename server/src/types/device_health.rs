use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Stored in widget_settings under reporting/{scope}/{id}. Missing rows inherit.
#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[ts(export)]
pub enum ReportingPolicy {
    #[default]
    Inherit,
    Ignore,
    Custom {
        expected_interval_seconds: u32,
    },
}
impl ReportingPolicy {
    /// Reserved rows travel through ordinary backup exports. Reject malformed
    /// policies before applying an import rather than silently using defaults.
    pub fn validate_setting(key: &str, value: &serde_json::Value) -> Result<(), String> {
        if !key.starts_with("reporting/") {
            return Ok(());
        }
        let valid_key = key.strip_prefix("reporting/device/").is_some_and(|id| {
            id.split_once('/')
                .is_some_and(|(integration, device)| !integration.is_empty() && !device.is_empty())
        }) || key
            .strip_prefix("reporting/integration/")
            .is_some_and(|id| !id.is_empty());
        if !valid_key {
            return Err(format!("Invalid reporting policy key: {key}"));
        }
        let policy: Self = serde_json::from_value(value.clone())
            .map_err(|error| format!("Invalid reporting policy {key}: {error}"))?;
        policy
            .validate()
            .map_err(|error| format!("Invalid reporting policy {key}: {error}"))
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if let Self::Custom {
            expected_interval_seconds,
        } = self
        {
            if !(1..=31_536_000).contains(expected_interval_seconds) {
                return Err("Expected reporting interval must be between one second and one year.");
            }
        }
        Ok(())
    }
}
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct EffectiveReportingPolicy {
    pub source: String,
    pub policy: ReportingPolicy,
    pub description: String,
    pub scheduling_grace_seconds: u32,
}
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct DeviceHealthIssue {
    pub code: String,
    pub message: String,
}
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct DeviceHealth {
    pub device_key: String,
    pub integration_id: String,
    pub name: String,
    pub status: String,
    pub effective_policy: EffectiveReportingPolicy,
    #[ts(type = "number | null")]
    pub last_fresh_report_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub last_cached_report_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub expected_by_ms: Option<i64>,
    pub issues: Vec<DeviceHealthIssue>,
}
#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct DeviceHealthSnapshot {
    #[ts(type = "number")]
    pub evaluated_at_ms: i64,
    pub warming_up: bool,
    pub devices: BTreeMap<String, DeviceHealth>,
    /// Sorted and deduplicated across every health issue on a device.
    pub attention_device_keys: Vec<String>,
}
