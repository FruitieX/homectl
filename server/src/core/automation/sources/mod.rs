//! Computed source implementations (P11).
//!
//! A computed source owns a typed output and publishes it through a
//! read-only synthetic device adapter. The implementations here are pure:
//! they take an injected civil time and validated parameters and return a
//! [`crate::types::automation_source::LightProfile`]; the runtime owner is
//! responsible for cadence, freshness, and publication.

pub mod circadian_compat;
pub mod presets;
pub mod registry;

pub use circadian_compat::{
    CircadianCompatCurve, CIRCADIAN_COMPAT_PRESET_VERSION, CIRCADIAN_COMPAT_TRANSITION_MS,
};
pub use presets::{
    preset_infos, resolve_source_body, validate_script_compute, SourcePreset,
    MAX_SOURCE_SCRIPT_BYTES,
};
pub use registry::{
    evaluate_due_sources, evaluate_source, local_time_label, script_context, source_device_key,
    synthetic_device, SourceEvaluation, Sources, COMPUTED_SOURCE_INTEGRATION_ID,
};
