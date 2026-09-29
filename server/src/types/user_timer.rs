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
        warmup_minutes: u32,
    },
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
}
