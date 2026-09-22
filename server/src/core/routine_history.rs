use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::Utc;
use once_cell::sync::Lazy;
use tokio::sync::mpsc;

use crate::types::{
    automation_trace::{RoutineV2RuntimeStatus, StepDisposition},
    device::DeviceKey,
    routine_history::{RoutineHistoryEntry, RoutineHistoryTriggerKind},
    routine_status::RoutineRuntimeStatus,
    rule::RoutineId,
};

const MAX_ROUTINE_HISTORY_ENTRIES: usize = 500;

/// How often the persistence worker re-prunes the table while writing.
const PRUNE_EVERY_ENTRIES: u64 = 100;

static ROUTINE_HISTORY_BUFFER: Lazy<RwLock<VecDeque<RoutineHistoryEntry>>> =
    Lazy::new(|| RwLock::new(VecDeque::with_capacity(MAX_ROUTINE_HISTORY_ENTRIES)));
static NEXT_ROUTINE_HISTORY_ID: AtomicU64 = AtomicU64::new(1);
static HISTORY_PERSISTENCE: OnceLock<mpsc::UnboundedSender<RoutineHistoryEntry>> = OnceLock::new();

pub fn recent_routine_history() -> Vec<RoutineHistoryEntry> {
    read_history_buffer().iter().cloned().collect()
}

/// Restore the newest persisted entries into the in-memory ring and continue
/// the entry id counter past them, so history survives a server restart. The
/// table is pruned back to the ring bound. Errors are returned for the caller
/// to log; the server keeps running with an empty history.
pub async fn hydrate_from_db() -> Result<usize, String> {
    let entries = crate::db::config_queries::db_list_routine_history(
        crate::db::config_queries::ROUTINE_HISTORY_PERSIST_LIMIT,
    )
    .await
    .map_err(|error| error.to_string())?;
    let loaded = entries.len();
    hydrate_entries(entries);

    if let Err(error) = crate::db::config_queries::db_prune_routine_history(
        crate::db::config_queries::ROUTINE_HISTORY_PERSIST_LIMIT,
    )
    .await
    {
        log::warn!("Failed to prune persisted routine history: {error}");
    }

    Ok(loaded)
}

/// Fill the ring from newest-first entries and advance the id counter. Split
/// from the database access so the ordering and id logic is unit-testable.
fn hydrate_entries(entries: Vec<RoutineHistoryEntry>) {
    let mut buffer = write_history_buffer();
    hydrate_into(&mut buffer, entries);
}

fn hydrate_into(buffer: &mut VecDeque<RoutineHistoryEntry>, entries: Vec<RoutineHistoryEntry>) {
    for entry in entries.into_iter().rev() {
        if let Ok(id) = entry.id.parse::<u64>() {
            NEXT_ROUTINE_HISTORY_ID.fetch_max(id.saturating_add(1), Ordering::Relaxed);
        }
        push_bounded(buffer, entry);
    }
}

/// Spawn the background writer that mirrors recorded entries into the
/// database. Called once at startup, after `hydrate_from_db`.
pub fn spawn_persistence_worker() {
    let (sender, mut receiver) = mpsc::unbounded_channel::<RoutineHistoryEntry>();
    if HISTORY_PERSISTENCE.set(sender).is_err() {
        return;
    }

    tokio::spawn(async move {
        let mut written: u64 = 0;
        while let Some(entry) = receiver.recv().await {
            if let Err(error) =
                crate::db::config_queries::db_save_routine_history_entry(&entry).await
            {
                log::warn!(
                    "Failed to persist routine history entry {}: {error}",
                    entry.id
                );
                continue;
            }
            written += 1;
            if written.is_multiple_of(PRUNE_EVERY_ENTRIES) {
                if let Err(error) = crate::db::config_queries::db_prune_routine_history(
                    crate::db::config_queries::ROUTINE_HISTORY_PERSIST_LIMIT,
                )
                .await
                {
                    log::warn!("Failed to prune persisted routine history: {error}");
                }
            }
        }
    });
}

pub fn record_rule_match(
    routine_id: &RoutineId,
    routine_name: &str,
    event_source_device_key: Option<&DeviceKey>,
    action_count: usize,
    status: &RoutineRuntimeStatus,
) {
    push_history_entry(RoutineHistoryEntry {
        id: next_history_id(),
        timestamp: Utc::now().to_rfc3339(),
        routine_id: routine_id.clone(),
        routine_name: routine_name.to_string(),
        trigger_kind: RoutineHistoryTriggerKind::RuleMatch,
        event_source_device_key: event_source_device_key.cloned(),
        action_count,
        status: Some(status.clone()),
        v2: None,
    });
}

pub fn record_force_trigger(
    routine_id: &RoutineId,
    routine_name: &str,
    action_count: usize,
    status: Option<&RoutineRuntimeStatus>,
) {
    push_history_entry(RoutineHistoryEntry {
        id: next_history_id(),
        timestamp: Utc::now().to_rfc3339(),
        routine_id: routine_id.clone(),
        routine_name: routine_name.to_string(),
        trigger_kind: RoutineHistoryTriggerKind::ForceTrigger,
        event_source_device_key: None,
        action_count,
        status: status.cloned(),
        v2: None,
    });
}

/// Record one completed v2 run: matched triggers, condition trace, and the
/// planned step dispositions. Called after the run outcome is written to the
/// routine's status, so the snapshot's `last_run` is this run (X03/P12).
pub fn record_v2_run(routine_id: &RoutineId, routine_name: &str, status: &RoutineV2RuntimeStatus) {
    let action_count = status
        .last_run
        .as_ref()
        .map(|run| {
            run.steps
                .iter()
                .filter(|step| matches!(step.disposition, StepDisposition::Dispatched))
                .count()
        })
        .unwrap_or(0);
    push_history_entry(RoutineHistoryEntry {
        id: next_history_id(),
        timestamp: Utc::now().to_rfc3339(),
        routine_id: routine_id.clone(),
        routine_name: routine_name.to_string(),
        trigger_kind: RoutineHistoryTriggerKind::V2Run,
        event_source_device_key: None,
        action_count,
        status: None,
        v2: Some(status.clone()),
    });
}

fn next_history_id() -> String {
    NEXT_ROUTINE_HISTORY_ID
        .fetch_add(1, Ordering::Relaxed)
        .to_string()
}

fn push_history_entry(entry: RoutineHistoryEntry) {
    if let Some(sender) = HISTORY_PERSISTENCE.get() {
        let _ = sender.send(entry.clone());
    }

    let mut buffer = write_history_buffer();
    push_bounded(&mut buffer, entry);
}

fn push_bounded(buffer: &mut VecDeque<RoutineHistoryEntry>, entry: RoutineHistoryEntry) {
    if buffer.len() == MAX_ROUTINE_HISTORY_ENTRIES {
        buffer.pop_front();
    }
    buffer.push_back(entry);
}

fn read_history_buffer() -> RwLockReadGuard<'static, VecDeque<RoutineHistoryEntry>> {
    match ROUTINE_HISTORY_BUFFER.read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn write_history_buffer() -> RwLockWriteGuard<'static, VecDeque<RoutineHistoryEntry>> {
    match ROUTINE_HISTORY_BUFFER.write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use once_cell::sync::Lazy;

    use super::{
        hydrate_into, next_history_id, push_bounded, recent_routine_history, record_force_trigger,
        record_v2_run, write_history_buffer, MAX_ROUTINE_HISTORY_ENTRIES,
    };
    use crate::types::{
        automation_definition::NodeId,
        automation_trace::{
            ConditionEvaluation, PlannedRunStatus, PlannedStepStatus, RoutineV2RuntimeStatus,
            StepDisposition,
        },
        routine_history::{RoutineHistoryEntry, RoutineHistoryTriggerKind},
        rule::RoutineId,
    };

    fn test_entry(routine_id: &str) -> RoutineHistoryEntry {
        RoutineHistoryEntry {
            id: routine_id.to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            routine_id: RoutineId(routine_id.to_string()),
            routine_name: "Routine".to_string(),
            trigger_kind: RoutineHistoryTriggerKind::RuleMatch,
            event_source_device_key: None,
            action_count: 1,
            status: None,
            v2: None,
        }
    }

    static TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn clear_history() {
        write_history_buffer().clear();
    }

    fn test_entry_with_id(id: &str) -> RoutineHistoryEntry {
        let mut entry = test_entry("routine");
        entry.id = id.to_string();
        entry
    }

    #[test]
    fn hydrate_into_restores_order_and_continues_the_id_counter() {
        // The id counter is process-global and monotonic, so probe it instead
        // of asserting absolute values.
        let before = next_history_id().parse::<u64>().unwrap();
        let newest = (before + 100).to_string();
        let older = (before + 99).to_string();

        let mut buffer = VecDeque::new();
        // Newest first, as returned by the database query.
        hydrate_into(
            &mut buffer,
            vec![test_entry_with_id(&newest), test_entry_with_id(&older)],
        );

        let ids: Vec<String> = buffer.iter().map(|entry| entry.id.clone()).collect();
        assert_eq!(ids, vec![older, newest]);
        // Other tests record history concurrently, so the counter only has to
        // be at least past the hydrated ids.
        assert!(next_history_id().parse::<u64>().unwrap() >= before + 101);
    }

    #[test]
    fn hydrate_into_keeps_only_the_ring_bound() {
        let entries: Vec<RoutineHistoryEntry> = (0..MAX_ROUTINE_HISTORY_ENTRIES + 5)
            .rev()
            .map(|index| test_entry_with_id(&index.to_string()))
            .collect();

        let mut buffer = VecDeque::new();
        hydrate_into(&mut buffer, entries);

        assert_eq!(buffer.len(), MAX_ROUTINE_HISTORY_ENTRIES);
        assert_eq!(buffer.front().map(|entry| entry.id.as_str()), Some("5"));
        let expected_last = format!("{}", MAX_ROUTINE_HISTORY_ENTRIES + 4);
        assert_eq!(
            buffer.back().map(|entry| entry.id.as_str()),
            Some(expected_last.as_str())
        );
    }

    #[test]
    fn recent_routine_history_drops_oldest_entries_when_buffer_is_full() {
        let mut buffer = VecDeque::with_capacity(MAX_ROUTINE_HISTORY_ENTRIES);
        for index in 0..(MAX_ROUTINE_HISTORY_ENTRIES + 3) {
            push_bounded(&mut buffer, test_entry(&format!("routine-{index}")));
        }

        assert_eq!(buffer.len(), MAX_ROUTINE_HISTORY_ENTRIES);
        assert_eq!(
            buffer.front().map(|entry| entry.routine_id.0.as_str()),
            Some("routine-3")
        );
        let expected_last = format!("routine-{}", MAX_ROUTINE_HISTORY_ENTRIES + 2);
        assert_eq!(
            buffer.back().map(|entry| entry.routine_id.0.as_str()),
            Some(expected_last.as_str()),
        );
    }

    #[test]
    fn records_v2_run_with_evaluation_snapshot_and_dispatched_step_count() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        clear_history();

        let status = RoutineV2RuntimeStatus {
            definition_revision: 3,
            fingerprint: "fingerprint".to_string(),
            matched_trigger_ids: vec![NodeId("trig_report".to_string())],
            triggers: Vec::new(),
            condition: ConditionEvaluation::default(),
            will_trigger: true,
            execution_pending: false,
            last_run: Some(PlannedRunStatus {
                run_id: 7,
                definition_revision: 3,
                accepted: true,
                steps: vec![
                    PlannedStepStatus {
                        action_id: NodeId("step_power".to_string()),
                        kind: "set_power".to_string(),
                        targets: vec!["dummy/lamp1".to_string()],
                        disposition: StepDisposition::Dispatched,
                        reason: None,
                    },
                    PlannedStepStatus {
                        action_id: NodeId("step_scene".to_string()),
                        kind: "activate_scene".to_string(),
                        targets: vec!["evening".to_string()],
                        disposition: StepDisposition::Suppressed,
                        reason: Some("transition_limited".to_string()),
                    },
                ],
                dropped: 1,
            }),
        };

        record_v2_run(
            &RoutineId("routine-v2-snapshot".to_string()),
            "Routine",
            &status,
        );

        let history = recent_routine_history();
        let entry = history
            .iter()
            .find(|entry| entry.routine_id.0 == "routine-v2-snapshot")
            .expect("v2 run recorded");
        assert_eq!(entry.trigger_kind, RoutineHistoryTriggerKind::V2Run);
        assert_eq!(entry.routine_name, "Routine");
        assert_eq!(entry.action_count, 1);
        assert!(entry.status.is_none());
        assert_eq!(entry.v2.as_ref(), Some(&status));
    }

    #[test]
    fn records_force_trigger_without_event_source() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        clear_history();

        record_force_trigger(
            &RoutineId("routine-force-trigger".to_string()),
            "Routine",
            2,
            None,
        );

        let history = recent_routine_history();
        let entry = history
            .iter()
            .find(|entry| entry.routine_id.0 == "routine-force-trigger")
            .expect("force trigger recorded");
        assert_eq!(entry.event_source_device_key, None);
        assert_eq!(entry.action_count, 2);
        assert!(entry.status.is_none());
    }
}
