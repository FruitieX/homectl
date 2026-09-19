//! Computed source implementations (P11).
//!
//! A computed source owns a typed output and publishes it through a
//! read-only synthetic device adapter. The implementations here are pure:
//! they take an injected civil time and validated parameters and return a
//! [`crate::types::automation_source::LightProfile`]; the runtime owner is
//! responsible for cadence, freshness, and publication.

pub mod circadian_compat;

pub use circadian_compat::{
    CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION, CIRCADIAN_COMPAT_TRANSITION_MS,
};
