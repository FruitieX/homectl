use std::collections::VecDeque;
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::Utc;
use env_logger::Logger;
use log::{Level, Log, Metadata, Record, SetLoggerError};
use once_cell::sync::Lazy;

use crate::types::logs::{LogLevel, UiLogEntry};

const MAX_LOG_ENTRIES: usize = 500;

static LOG_BUFFER: Lazy<RwLock<VecDeque<UiLogEntry>>> =
    Lazy::new(|| RwLock::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)));

pub fn init_logging() -> Result<(), SetLoggerError> {
    let mut builder = pretty_env_logger::formatted_builder();
    if let Ok(filters) = std::env::var("RUST_LOG") {
        builder.parse_filters(&filters);
    }

    let env_logger = builder.build();
    let max_level = env_logger.filter();
    let logger = BufferedLogger { inner: env_logger };

    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(max_level);
    Ok(())
}

pub fn recent_logs() -> Vec<UiLogEntry> {
    read_log_buffer().iter().cloned().collect()
}

struct BufferedLogger {
    inner: Logger,
}

impl Log for BufferedLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &Record<'_>) {
        if !self.inner.matches(record) {
            return;
        }

        self.inner.log(record);
        push_log_entry(UiLogEntry {
            timestamp: Utc::now().to_rfc3339(),
            level: map_level(record.level()),
            target: record.target().to_string(),
            message: record.args().to_string(),
        });
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

fn map_level(level: Level) -> LogLevel {
    match level {
        Level::Error => LogLevel::Error,
        Level::Warn => LogLevel::Warn,
        Level::Info => LogLevel::Info,
        Level::Debug => LogLevel::Debug,
        Level::Trace => LogLevel::Trace,
    }
}

fn push_log_entry(entry: UiLogEntry) {
    let mut buffer = write_log_buffer();
    if buffer.len() == MAX_LOG_ENTRIES {
        buffer.pop_front();
    }
    buffer.push_back(entry);
}

fn read_log_buffer() -> RwLockReadGuard<'static, VecDeque<UiLogEntry>> {
    match LOG_BUFFER.read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn write_log_buffer() -> RwLockWriteGuard<'static, VecDeque<UiLogEntry>> {
    match LOG_BUFFER.write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use super::{map_level, push_log_entry, recent_logs, write_log_buffer, MAX_LOG_ENTRIES};
    use crate::types::logs::{LogLevel, UiLogEntry};

    fn clear_logs() {
        write_log_buffer().clear();
    }

    #[test]
    fn recent_logs_drop_oldest_entries_when_buffer_is_full() {
        clear_logs();

        for index in 0..(MAX_LOG_ENTRIES + 3) {
            push_log_entry(UiLogEntry {
                timestamp: format!("2026-01-01T00:00:{index:02}Z"),
                level: LogLevel::Error,
                target: "homectl_server::tests".to_string(),
                message: format!("entry-{index}"),
            });
        }

        let logs = recent_logs();
        assert_eq!(logs.len(), MAX_LOG_ENTRIES);
        assert_eq!(
            logs.first().map(|entry| entry.message.as_str()),
            Some("entry-3")
        );
        let expected_last = format!("entry-{}", MAX_LOG_ENTRIES + 2);
        assert_eq!(
            logs.last().map(|entry| entry.message.as_str()),
            Some(expected_last.as_str()),
        );
    }

    #[test]
    fn log_level_mapping_matches_log_crate_levels() {
        assert_eq!(map_level(log::Level::Error), LogLevel::Error);
        assert_eq!(map_level(log::Level::Warn), LogLevel::Warn);
        assert_eq!(map_level(log::Level::Info), LogLevel::Info);
        assert_eq!(map_level(log::Level::Debug), LogLevel::Debug);
        assert_eq!(map_level(log::Level::Trace), LogLevel::Trace);
    }
}
