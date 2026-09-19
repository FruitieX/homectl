//! Read-only runtime projection of live timer jobs (P09).
//!
//! The state actor publishes lifecycle changes (create/replace/cancel/consume)
//! through `RuntimeSnapshot.timers`; `remaining_ms` is a sampled monotonic
//! estimate, while `due_wall_ms` is the persisted UTC deadline estimate.
//! Elapsed-time authority always stays with the monotonic clock.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{automation_definition::TimerId, rule::RoutineId};

/// Current lifecycle state of one live job.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TimerJobStatus {
    /// Waiting for its deadline.
    Pending,
}

/// How the job survives process lifetime (P10 adds durable jobs).
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TimerPersistence {
    /// Session timer: restart cancels it (a database was unavailable, so the
    /// best-effort P10 write-through is not expected to restore it).
    Session,
    /// Best-effort durable named timer: scheduled/replaced/cancelled through
    /// the database and restored on restart when the deadline is still in the
    /// future. Deliberately not an exactly-once guarantee.
    Durable,
}

/// One live timer job as published to readers.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct TimerRuntimeStatus {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub timer: TimerId,
    pub generation: u64,
    pub status: TimerJobStatus,
    /// UTC deadline estimate in milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub due_wall_ms: i64,
    /// Sampled remaining monotonic duration at publish time.
    #[ts(type = "number")]
    pub remaining_ms: u64,
    pub persistence: TimerPersistence,
}
