//! Automation event identity, coherent frames, and lifecycle metadata (P02).
//!
//! Automation v2 distinguishes received reports, desired-state commands,
//! internal derivations, and startup/reload seeding. Every domain event carries
//! an [`EventId`] that is unique within a process lifetime, and every device
//! mutation is collected into an [`AutomationFrame`] so a queued event can be
//! evaluated against its own transaction rather than whatever snapshot happens
//! to be latest.
//!
//! Frames also carry causation metadata. A routine evaluation that dispatches
//! actions stamps them with the originating frame id and a bounded depth, so a
//! loop of routine effects terminates visibly instead of growing without limit.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::device::{Device, DeviceKey};

/// Maximum causal depth (in dispatched action hops) that may still evaluate
/// routines. A frame evaluated at this depth still records and evaluates, but
/// the actions it dispatches are rejected instead of creating another hop.
pub const MAX_CAUSATION_DEPTH: u16 = 16;

/// Maximum number of native derivation steps (group/scene invalidation work)
/// inside a single actor command before further derivation is suppressed.
pub const MAX_DERIVATION_STEPS: usize = 256;

/// Number of recent [`AutomationFrame`]s kept for diagnostics and tests.
pub const FRAME_LOG_CAPACITY: usize = 256;

/// Unique identity of an event within one process (boot) lifetime.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[ts(export)]
pub struct EventId {
    pub boot_id: u64,
    pub sequence: u64,
}

impl EventId {
    pub fn is_unset(&self) -> bool {
        self.boot_id == 0 && self.sequence == 0
    }
}

/// Where an event came from. Automation v2 uses this to keep raw physical
/// evidence separate from desired-state commands and internal derivations.
#[derive(TS, Default, Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EventOrigin {
    /// A raw report received from an integration (physical evidence).
    Report,
    /// A desired-state command or its acknowledgment.
    Command,
    /// An internal derivation such as scene/group/source materialization.
    ///
    /// This is the default because `Devices::set_state` historically meant
    /// "derived internal change".
    #[default]
    Derived,
    /// Startup or configuration reload seeding.
    Startup,
}

/// Causation metadata carried by derived commands and recorded on frames.
///
/// `depth` counts action dispatch hops since the root event. `parent_event_id`
/// points at the frame that directly emitted the command. `cause_id` points at
/// the root frame of the chain and is preserved across hops for tracing.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[ts(export)]
pub struct EventCausation {
    pub depth: u16,
    pub parent_event_id: Option<EventId>,
    pub cause_id: Option<EventId>,
}

impl EventCausation {
    /// Causation for an action dispatched while evaluating `frame_id`, given
    /// the causation that reached that frame.
    pub fn child_of(frame_id: EventId, parent: Self) -> Self {
        Self {
            depth: parent.depth.saturating_add(1),
            parent_event_id: Some(frame_id),
            cause_id: parent
                .cause_id
                .or(parent.parent_event_id)
                .or(Some(frame_id)),
        }
    }

    pub fn is_within_limit(&self) -> bool {
        self.depth <= MAX_CAUSATION_DEPTH
    }
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
    /// Identity of the internal state update this mutation produced.
    pub event_id: EventId,
    pub device_key: DeviceKey,
    pub before: Option<Device>,
    pub after: Device,
    pub origin: EventOrigin,
}

/// Why a frame did not evaluate routines.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameDisposition {
    /// Routines were evaluated for this frame.
    Evaluated,
    /// The server was still warming up; state was seeded but routines were not
    /// evaluated and no history was written.
    WarmingUp,
    /// The frame exceeded [`MAX_CAUSATION_DEPTH`]; further dispatch was
    /// suppressed to bound feedback loops.
    CausationLimited,
    /// Native group/scene derivation exceeded [`MAX_DERIVATION_STEPS`].
    DerivationLimited,
}

/// Coherent before/after frame for one actor transaction.
#[derive(Clone, Debug)]
pub struct AutomationFrame {
    pub frame_id: EventId,
    /// Origin of the transaction's first mutation.
    pub origin: EventOrigin,
    /// Causation that reached this transaction.
    pub causation: EventCausation,
    /// Every device mutation applied in the transaction, in application order.
    pub mutations: Vec<DeviceMutation>,
    pub evaluated: bool,
    pub disposition: FrameDisposition,
}

impl AutomationFrame {
    pub fn mutation_for(&self, device_key: &DeviceKey) -> Option<&DeviceMutation> {
        self.mutations
            .iter()
            .find(|mutation| &mutation.device_key == device_key)
    }

    /// Whether this frame both contains the given device and represents an
    /// actual state transition for it.
    pub fn changed(&self, device_key: &DeviceKey) -> bool {
        self.mutations
            .iter()
            .any(|mutation| &mutation.device_key == device_key)
    }
}

/// Bounded ring of recent frames kept for diagnostics and tests.
#[derive(Debug, Default)]
pub struct FrameLog {
    frames: VecDeque<AutomationFrame>,
    total: u64,
    suppressed: u64,
}

impl FrameLog {
    pub fn record(&mut self, frame: AutomationFrame) {
        self.total = self.total.saturating_add(1);
        if matches!(
            frame.disposition,
            FrameDisposition::CausationLimited | FrameDisposition::DerivationLimited
        ) {
            self.suppressed = self.suppressed.saturating_add(1);
        }
        if self.frames.len() == FRAME_LOG_CAPACITY {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
    }

    pub fn frames(&self) -> impl DoubleEndedIterator<Item = &AutomationFrame> {
        self.frames.iter()
    }

    pub fn recent(&self, limit: usize) -> Vec<&AutomationFrame> {
        self.frames.iter().rev().take(limit).collect()
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn suppressed(&self) -> u64 {
        self.suppressed
    }

    pub fn clear(&mut self) {
        self.frames.clear();
    }
}
