//! Supervised out-of-process JavaScript execution (P06).
//!
//! This module proves the worker architecture that later packages use to move
//! routine and scene scripts off the state actor:
//!
//! * [`protocol`] defines the bounded length-prefixed JSON IPC.
//! * [`engine`] is the pinned Boa 0.20 adapter executed inside the worker.
//! * [`supervisor`] owns the worker process pool: timeout, kill, reap,
//!   replacement, rlimits, diagnostics caps, and request bookkeeping.
//! * the `script-worker` binary (same crate) hosts the engine and speaks the
//!   protocol on stdin/stdout; it never links into the server's live state.
//!
//! No existing script call site is migrated in P06: `core::scripting` (v1) and
//! the v2 compiler still validate in-process, and routine/scene integration
//! follows in P07/P08. The supervisor is async-only and never runs user code
//! on the caller's thread.
//!
//! See [`supervisor`] for the full containment model and the distinction
//! between fault containment and security isolation.

pub mod engine;
pub mod protocol;
pub mod supervisor;

pub use engine::{
    execute_legacy_rule_script, execute_script, validate_script, MAX_SCRIPT_RESULT_BYTES,
};
pub use protocol::{
    FrameError, RequestKind, ScriptRequest, ScriptResponse, TestMode, MAX_CONTEXT_BYTES,
    MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, MAX_RESULT_BYTES, MAX_SCRIPT_BYTES,
    SUPPORTED_LEGACY_API_VERSION, SUPPORTED_SCRIPT_API_VERSION,
};
pub use supervisor::{
    JsWorkerPool, SupervisorConfig, WorkerError, DEFAULT_ADDRESS_SPACE_LIMIT_BYTES,
    DEFAULT_CPU_TIME_LIMIT_SECS, DEFAULT_INVOCATION_TIMEOUT, DEFAULT_MAX_DIAGNOSTICS_BYTES,
    DEFAULT_MAX_OUTSTANDING_REQUESTS, DEFAULT_WORKERS,
};
