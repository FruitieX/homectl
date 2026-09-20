use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::Utc;
use once_cell::sync::Lazy;

use crate::types::{
    automation_trace::{RoutineV2RuntimeStatus, StepDisposition},
    device::DeviceKey,
    routine_history::{RoutineHistoryEntry, RoutineHistoryTriggerKind},
    routine_status::RoutineRuntimeStatus,
    rule::RoutineId,
};

const MAX_ROUTINE_HISTORY_ENTRIES: usize = 500;

static ROUTINE_HISTORY_BUFFER: Lazy<RwLock<VecDeque<RoutineHistoryEntry>>> =
    Lazy::new(|| RwLock::new(VecDeque::with_capacity(MAX_ROUTINE_HISTORY_ENTRIES)));
static NEXT_ROUTINE_HISTORY_ID: AtomicU64 = AtomicU64::new(1);

pub fn recent_routine_history() -> Vec<RoutineHistoryEntry> {
    read_history_buffer().iter().cloned().collect()
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
    let mut buffer = write_history_buffer();
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
    use std::sync::Mutex;

    use once_cell::sync::Lazy;

    use super::{
        recent_routine_history, record_force_trigger, record_rule_match, record_v2_run,
        write_history_buffer, MAX_ROUTINE_HISTORY_ENTRIES,
    };
    use crate::types::{
        automation_definition::NodeId,
        automation_trace::{
            ConditionEvaluation, PlannedRunStatus, PlannedStepStatus, RoutineV2RuntimeStatus,
            StepDisposition,
        },
        device::{DeviceId, DeviceKey},
        integration::IntegrationId,
        routine_history::RoutineHistoryTriggerKind,
        routine_status::RoutineRuntimeStatus,
        rule::RoutineId,
    };

    static TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn clear_history() {
        write_history_buffer().clear();
    }

    #[test]
    fn recent_routine_history_drops_oldest_entries_when_buffer_is_full() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        clear_history();

        let status = RoutineRuntimeStatus {
            all_conditions_match: true,
            will_trigger: true,
            rules: Vec::new(),
            v2: None,
        };
        for index in 0..(MAX_ROUTINE_HISTORY_ENTRIES + 3) {
            record_rule_match(
                &RoutineId(format!("routine-{index}")),
                "Routine",
                Some(&DeviceKey::new(
                    IntegrationId::from("dummy".to_string()),
                    DeviceId::from(index.to_string()),
                )),
                1,
                &status,
            );
        }

        let history = recent_routine_history();
        assert_eq!(history.len(), MAX_ROUTINE_HISTORY_ENTRIES);
        assert_eq!(
            history.first().map(|entry| entry.routine_id.0.as_str()),
            Some("routine-3")
        );
        let expected_last = format!("routine-{}", MAX_ROUTINE_HISTORY_ENTRIES + 2);
        assert_eq!(
            history.last().map(|entry| entry.routine_id.0.as_str()),
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

        record_v2_run(&RoutineId("routine".to_string()), "Routine", &status);

        let history = recent_routine_history();
        assert_eq!(history.len(), 1);
        let entry = &history[0];
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

        record_force_trigger(&RoutineId("routine".to_string()), "Routine", 2, None);

        let history = recent_routine_history();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].event_source_device_key, None);
        assert_eq!(history[0].action_count, 2);
        assert!(history[0].status.is_none());
    }
}
