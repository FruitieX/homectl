//! User-facing timers. Definitions and execution checkpoints are database backed.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export)]
pub enum UserTimerAction {
    Device { device_key: String, power: bool },
    Group { group_id: String, power: bool },
    Scene { scene_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export)]
pub enum UserTimerSchedule {
    Countdown {
        minutes: u32,
    },
    Scheduled {
        time: String,
        timezone: String,
        /// A date for a one-off timer; otherwise weekdays must be nonempty.
        date: Option<String>,
        /// ISO weekday numbers: Monday = 1, Sunday = 7.
        weekdays: Vec<u8>,
        duration_minutes: Option<u32>,
    },
    ReadyBy {
        time: String,
        timezone: String,
        date: Option<String>,
        weekdays: Vec<u8>,
        /// Fixed warm-up, and the fallback when the temperature is unknown.
        warmup_minutes: u32,
        /// Start early enough to reach a target temperature instead of a
        /// fixed warm-up. The start time follows the live reading.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        temperature: Option<ReadyByTemperature>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct ReadyByTemperature {
    /// `integration_id/device_id` of the sensor measuring what is heated.
    pub sensor_key: String,
    /// Numeric reading of a multi-reading sensor; ignored for single values.
    #[serde(default = "default_reading")]
    pub reading: String,
    /// Temperature (°C) to reach by the ready-by time.
    pub target: f64,
    /// Upper bound for the warm-up, however cold it is.
    pub max_warmup_minutes: u32,
}

fn default_reading() -> String {
    "temperature".into()
}

/// How fast a device heats what a sensor measures, learned from the
/// device's own runs: nothing for `lag_minutes`, then `rate_per_minute`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct HeatingModel {
    pub device_key: String,
    pub sensor_key: String,
    pub reading: String,
    /// °C per minute once heating is under way.
    pub rate_per_minute: f64,
    pub lag_minutes: f64,
    /// Runs that contributed; 0 means the built-in default.
    pub runs: u32,
    #[ts(type = "number | null")]
    pub updated_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct UserTimerDefinition {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub enabled: bool,
    pub schedule: UserTimerSchedule,
    pub action: UserTimerAction,
    pub finish_action: Option<UserTimerAction>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, TS)]
#[serde(default, deny_unknown_fields)]
#[ts(export)]
pub struct UserTimerRuntime {
    #[ts(type = "number | null")]
    pub next_start_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub finish_ms: Option<i64>,
    pub active: bool,
    /// Durable intent, retried after an interrupted command. Commands are
    /// idempotent state assignments; integration delivery is not acknowledged.
    pub pending: Option<String>,
    pub last_message: Option<String>,
    #[ts(type = "number | null")]
    pub last_run_ms: Option<i64>,
    /// How a temperature-based warm-up was planned, e.g. the reading,
    /// target and estimate behind `next_start_ms`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plan: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct UserTimerEntry {
    pub definition: UserTimerDefinition,
    #[serde(default)]
    pub runtime: UserTimerRuntime,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, TS)]
#[serde(default, deny_unknown_fields)]
#[ts(export)]
pub struct UserTimers {
    pub timers: Vec<UserTimerEntry>,
    pub legacy_migrated: bool,
    /// Learned warm-up rates for temperature-based ready-by timers.
    pub heating_models: Vec<HeatingModel>,
}
