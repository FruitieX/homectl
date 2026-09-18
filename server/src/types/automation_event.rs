//! Automation event identity and coherent frames (P02).
//!
//! Automation v2 distinguishes received reports, desired-state commands,
//! internal derivations, and startup/reload seeding. Every domain event carries
//! an [`EventId`] that is unique within a process lifetime, and every device
//! mutation is representable as a before/after [`AutomationFrame`] so a queued
//! event can be evaluated against its own transaction rather than whatever
//! snapshot happens to be latest.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::device::{Device, DeviceKey};

/// Unique identity of an event within one process (boot) lifetime.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[ts(export)]
pub struct EventId {
    pub boot_id: u64,
    pub sequence: u64,
}

/// Where an event came from. Automation v2 uses this to keep raw physical
/// evidence separate from desired-state commands and internal derivations.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EventOrigin {
    /// A raw report received from an integration (physical evidence).
    Report,
    /// A desired-state command or its acknowledgment.
    Command,
    /// An internal derivation such as scene/group/source materialization.
    Derived,
    /// Startup or configuration reload seeding.
    Startup,
}

/// Allocates monotonically increasing event IDs. Cloning is shared, so the
/// sequence is process-wide.
#[derive(Debug)]
pub struct EventSequencer {
    boot_id: u64,
    next_sequence: AtomicU64,
}

impl Default for EventSequencer {
    fn default() -> Self {
        Self::new()
    }
}

impl EventSequencer {
    pub fn new() -> Self {
        Self {
            boot_id: rand::random::<u64>(),
            next_sequence: AtomicU64::new(1),
        }
    }

    pub fn boot_id(&self) -> u64 {
        self.boot_id
    }

    pub fn next(&self) -> EventId {
        EventId {
            boot_id: self.boot_id,
            sequence: self.next_sequence.fetch_add(1, Ordering::Relaxed),
        }
    }
}

/// One device mutation within an actor transaction.
#[derive(Clone, Debug)]
pub struct DeviceMutation {
    pub device_key: DeviceKey,
    pub before: Option<Device>,
    pub after: Device,
    pub origin: EventOrigin,
}

/// Coherent before/after frame for one domain event.
#[derive(Clone, Debug)]
pub struct AutomationFrame {
    pub event_id: EventId,
    pub origin: EventOrigin,
    pub mutation: DeviceMutation,
}
