//! Injected clock abstraction (P09).
//!
//! The scheduler separates UTC wall time (persisted due times, calendar
//! schedules) from monotonic elapsed time (relative deadlines that must not
//! move when the wall clock jumps). Tests replace the system clock with
//! [`ManualClock`] and advance wall and monotonic time independently.

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Wall and monotonic time source used by scheduling code.
pub trait Clock: Send + Sync {
    /// Current UTC time in milliseconds since the Unix epoch.
    fn wall_ms(&self) -> i64;
    /// Monotonic milliseconds since process start. Never moves backwards and
    /// is not persisted.
    fn monotonic_ms(&self) -> u64;
}

/// Production clock backed by the process wall clock and an `Instant` epoch.
#[derive(Debug)]
pub struct SystemClock {
    epoch: Instant,
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            epoch: Instant::now(),
        }
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn wall_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0)
    }

    fn monotonic_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }
}

/// Deterministic clock for tests: wall and monotonic time advance only when
/// the test says so.
#[derive(Debug)]
pub struct ManualClock {
    wall_ms: AtomicI64,
    monotonic_ms: AtomicU64,
}

impl ManualClock {
    pub fn new(wall_ms: i64) -> Self {
        Self {
            wall_ms: AtomicI64::new(wall_ms),
            monotonic_ms: AtomicU64::new(0),
        }
    }

    pub fn set_wall_ms(&self, wall_ms: i64) {
        self.wall_ms.store(wall_ms, Ordering::SeqCst);
    }

    pub fn set_monotonic_ms(&self, monotonic_ms: u64) {
        self.monotonic_ms.store(monotonic_ms, Ordering::SeqCst);
    }

    pub fn advance_wall_ms(&self, delta_ms: i64) {
        self.wall_ms.fetch_add(delta_ms, Ordering::SeqCst);
    }

    pub fn advance_monotonic_ms(&self, delta_ms: u64) {
        self.monotonic_ms.fetch_add(delta_ms, Ordering::SeqCst);
    }
}

impl Default for ManualClock {
    fn default() -> Self {
        Self::new(0)
    }
}

impl Clock for ManualClock {
    fn wall_ms(&self) -> i64 {
        self.wall_ms.load(Ordering::SeqCst)
    }

    fn monotonic_ms(&self) -> u64 {
        self.monotonic_ms.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_clock_advances_wall_and_monotonic_independently() {
        let clock = ManualClock::new(1_000);
        clock.advance_monotonic_ms(500);
        clock.set_wall_ms(250_000);

        assert_eq!(clock.monotonic_ms(), 500);
        assert_eq!(clock.wall_ms(), 250_000);
    }

    #[test]
    fn system_clock_is_monotonic_across_wall_changes() {
        let clock = SystemClock::new();
        let first = clock.monotonic_ms();
        let second = clock.monotonic_ms();
        assert!(second >= first);
    }
}
