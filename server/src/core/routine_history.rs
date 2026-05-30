use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::Utc;
use once_cell::sync::Lazy;

use crate::types::{
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
        recent_routine_history, record_force_trigger, record_rule_match, write_history_buffer,
        MAX_ROUTINE_HISTORY_ENTRIES,
    };
    use crate::core::integrations::PLUGIN_DUMMY;
    use crate::types::{
        device::{DeviceId, DeviceKey},
        integration::IntegrationId,
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
        };
        for index in 0..(MAX_ROUTINE_HISTORY_ENTRIES + 3) {
            record_rule_match(
                &RoutineId(format!("routine-{index}")),
                "Routine",
                Some(&DeviceKey::new(
                    IntegrationId::from(PLUGIN_DUMMY.to_string()),
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
