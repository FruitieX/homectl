//! Process supervisor for the JavaScript worker.
//!
//! # Containment model
//!
//! The supervisor runs a small pool of worker *processes*. Each worker handles
//! one invocation at a time (one process == one concurrent script), and the
//! supervisor never runs user JavaScript in the server process. Faults are
//! contained as follows:
//!
//! * **Time:** every invocation has a wall-clock budget (default
//!   [`DEFAULT_INVOCATION_TIMEOUT`]). On expiry the child is `SIGKILL`ed and
//!   reaped, never merely abandoned; `spawn_blocking` + timeout is explicitly
//!   not used anywhere in this path.
//! * **CPU:** the child is spawned with `RLIMIT_CPU` of
//!   [`SupervisorConfig::cpu_time_limit_secs`] seconds, so a runaway script is
//!   also terminated by the kernel if the supervisor is stalled for any reason.
//! * **Memory:** the child is spawned with `RLIMIT_AS` of
//!   [`SupervisorConfig::address_space_limit_bytes`] (default 256 MiB), which
//!   the kernel enforces on address-space growth; allocation failures surface
//!   as bounded errors or a crash that the supervisor replaces.
//! * **Protocol:** frame lengths are validated against the direction's cap
//!   before allocating, request/response ids must match, and stdout is
//!   protocol-only. Garbage, truncation, oversize frames, and premature exit
//!   all produce a bounded [`WorkerError`] and a replacement worker.
//! * **Diagnostics:** stderr is drained continuously and capped at
//!   [`SupervisorConfig::max_diagnostics_bytes`], so a worker cannot deadlock
//!   the supervisor on a full stderr pipe or grow server memory with logs.
//! * **Environment:** children are spawned with an empty environment, no DB
//!   handles, no sockets, and no live state. Boa 0.20 core exposes no
//!   filesystem, network, process, or secret APIs to scripts.
//!
//! This is **fault containment**, not a hostile-code security sandbox: a
//! worker is a child process with the same uid as the server. The deployment
//! platform (NixOS/Linux) provides the rlimits above; the worker is not
//! advertised as a sandbox for adversarial code.
//!
//! Fresh realms are constructed per invocation inside the worker
//! ([`super::engine`]), so global/prototype mutations never leak between
//! invocations.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;

use super::protocol::{
    self, FrameError, ScriptRequest, ScriptResponse, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};

/// Default worker pool size (one invocation per worker).
pub const DEFAULT_WORKERS: usize = 2;
/// Default per-invocation planning budget.
pub const DEFAULT_INVOCATION_TIMEOUT: Duration = Duration::from_millis(200);
/// Default bound on outstanding requests (running plus waiting).
pub const DEFAULT_MAX_OUTSTANDING_REQUESTS: usize = 32;
/// Default per-worker stderr retention.
pub const DEFAULT_MAX_DIAGNOSTICS_BYTES: usize = 64 * 1024;
/// Default kernel-enforced address-space cap per worker.
pub const DEFAULT_ADDRESS_SPACE_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
/// Default kernel-enforced CPU-time cap per worker.
pub const DEFAULT_CPU_TIME_LIMIT_SECS: u64 = 5;
/// Diagnostics included inline in an error message.
const ERROR_DIAGNOSTICS_BYTES: usize = 4 * 1024;

/// Supervisor tuning. Defaults are operational starting points from the
/// automation plan, not measured optima.
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    /// Worker executable. `None` resolves to `script-worker` next to the
    /// running server binary.
    pub worker_binary: Option<PathBuf>,
    /// Number of worker processes; one invocation runs per worker at a time.
    pub workers: usize,
    /// Wall-clock budget for one invocation, including IPC.
    pub invocation_timeout: Duration,
    /// Maximum outstanding requests (running plus waiting).
    pub max_outstanding_requests: usize,
    /// Frame cap for requests written by the supervisor.
    pub max_request_bytes: usize,
    /// Frame cap for responses read by the supervisor.
    pub max_response_bytes: usize,
    /// Maximum retained stderr bytes per worker.
    pub max_diagnostics_bytes: usize,
    /// Kernel `RLIMIT_AS` for each worker.
    pub address_space_limit_bytes: u64,
    /// Kernel `RLIMIT_CPU` (seconds) for each worker.
    pub cpu_time_limit_secs: u64,
    /// Extra worker arguments; only used by tests (e.g. `--test-mode`).
    pub extra_args: Vec<String>,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            worker_binary: None,
            workers: DEFAULT_WORKERS,
            invocation_timeout: DEFAULT_INVOCATION_TIMEOUT,
            max_outstanding_requests: DEFAULT_MAX_OUTSTANDING_REQUESTS,
            max_request_bytes: MAX_REQUEST_BYTES,
            max_response_bytes: MAX_RESPONSE_BYTES,
            max_diagnostics_bytes: DEFAULT_MAX_DIAGNOSTICS_BYTES,
            address_space_limit_bytes: DEFAULT_ADDRESS_SPACE_LIMIT_BYTES,
            cpu_time_limit_secs: DEFAULT_CPU_TIME_LIMIT_SECS,
            extra_args: Vec::new(),
        }
    }
}

impl SupervisorConfig {
    fn validate(&self) -> Result<(), WorkerError> {
        if self.workers == 0 {
            return Err(WorkerError::Spawn {
                message: "worker pool size must be at least 1".to_string(),
            });
        }
        if self.invocation_timeout.is_zero() {
            return Err(WorkerError::Spawn {
                message: "invocation timeout must be positive".to_string(),
            });
        }
        if self.max_request_bytes == 0 || self.max_response_bytes == 0 {
            return Err(WorkerError::Spawn {
                message: "frame caps must be positive".to_string(),
            });
        }
        if self.address_space_limit_bytes == 0 || self.cpu_time_limit_secs == 0 {
            return Err(WorkerError::Spawn {
                message: "resource limits must be positive".to_string(),
            });
        }
        Ok(())
    }
}

/// Bounded failure taxonomy for supervised script work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerError {
    /// Request rejected because the outstanding-request bound was reached.
    QueueFull { limit: usize },
    /// The pool has been shut down.
    Shutdown,
    /// The worker process could not be started.
    Spawn { message: String },
    /// The request was rejected before any worker was used.
    InvalidRequest { message: String },
    /// The invocation exceeded its wall-clock budget; the worker was killed,
    /// reaped, and replaced.
    Timeout {
        request_id: u64,
        timeout_ms: u64,
        diagnostics: String,
    },
    /// The worker exited or truncated a frame; it was killed (if needed),
    /// reaped, and replaced.
    Crash {
        request_id: u64,
        message: String,
        diagnostics: String,
    },
    /// The worker violated the framed protocol; it was killed, reaped, and
    /// replaced.
    Protocol {
        request_id: u64,
        message: String,
        diagnostics: String,
    },
    /// The script itself failed. This is a bounded worker-reported failure and
    /// the worker stays healthy.
    Script { request_id: u64, message: String },
}

impl WorkerError {
    /// Whether the worker must be retired (fault) or can be reused (bounded
    /// script failure or caller error).
    pub fn is_worker_fault(&self) -> bool {
        matches!(
            self,
            WorkerError::Timeout { .. } | WorkerError::Crash { .. } | WorkerError::Protocol { .. }
        )
    }

    /// Diagnostics attached to a fault, if any.
    pub fn diagnostics(&self) -> Option<&str> {
        match self {
            WorkerError::Timeout { diagnostics, .. }
            | WorkerError::Crash { diagnostics, .. }
            | WorkerError::Protocol { diagnostics, .. } => Some(diagnostics),
            _ => None,
        }
    }
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkerError::QueueFull { limit } => {
                write!(f, "script worker queue is full (limit {limit})")
            }
            WorkerError::Shutdown => write!(f, "script worker pool is shut down"),
            WorkerError::Spawn { message } => write!(f, "script worker spawn failed: {message}"),
            WorkerError::InvalidRequest { message } => {
                write!(f, "invalid script request: {message}")
            }
            WorkerError::Timeout {
                request_id,
                timeout_ms,
                ..
            } => write!(
                f,
                "script invocation {request_id} exceeded its {timeout_ms} ms budget; worker killed and replaced"
            ),
            WorkerError::Crash {
                request_id,
                message,
                ..
            } => write!(
                f,
                "script worker crashed during invocation {request_id}: {message}"
            ),
            WorkerError::Protocol {
                request_id,
                message,
                ..
            } => write!(
                f,
                "script worker protocol error during invocation {request_id}: {message}"
            ),
            WorkerError::Script {
                request_id,
                message,
            } => write!(f, "script invocation {request_id} failed: {message}"),
        }
    }
}

impl std::error::Error for WorkerError {}

/// Ring buffer of retained stderr bytes.
#[derive(Debug, Default)]
struct DiagnosticBuffer {
    bytes: VecDeque<u8>,
}

impl DiagnosticBuffer {
    fn push(&mut self, chunk: &[u8], cap: usize) {
        if cap == 0 {
            return;
        }
        for &byte in chunk {
            if self.bytes.len() == cap {
                self.bytes.pop_front();
            }
            self.bytes.push_back(byte);
        }
    }

    fn to_lossy_string(&self) -> String {
        let (first, second) = self.bytes.as_slices();
        let mut output = String::from_utf8_lossy(first).into_owned();
        output.push_str(&String::from_utf8_lossy(second));
        output
    }
}

/// One supervised worker process.
struct Worker {
    generation: u64,
    child: tokio::process::Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    diagnostics: Arc<StdMutex<DiagnosticBuffer>>,
    stderr_task: JoinHandle<()>,
}

/// A worker checked out of the pool.
///
/// If the future using the lease is dropped mid-flight, [`Drop`] kills the
/// worker (via `kill_on_drop`), releases its slot, and wakes a waiter so the
/// pool can spawn a replacement. Without this, cancelling an invocation would
/// permanently shrink the effective pool.
struct WorkerLease<'a> {
    pool: &'a JsWorkerPool,
    worker: Option<Worker>,
}

impl<'a> WorkerLease<'a> {
    fn take(mut self) -> Worker {
        self.worker
            .take()
            .expect("worker lease was already consumed")
    }
}

impl Drop for WorkerLease<'_> {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            let generation = worker.generation;
            // `kill_on_drop` sends SIGKILL and tokio reaps the orphan.
            drop(worker);
            self.pool.unregister_pid(generation);
            self.pool.busy.fetch_sub(1, Ordering::SeqCst);
            self.pool.notify.notify_one();
        }
    }
}

impl Worker {
    fn diagnostics_text(&self) -> String {
        let guard = self
            .diagnostics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut text = guard.to_lossy_string();
        if text.len() > ERROR_DIAGNOSTICS_BYTES {
            let mut boundary = ERROR_DIAGNOSTICS_BYTES;
            while !text.is_char_boundary(boundary) {
                boundary -= 1;
            }
            text.truncate(boundary);
            text.push_str("... (truncated)");
        }
        text
    }

    /// `SIGKILL` and reap the worker, then stop its diagnostics reader.
    async fn terminate(mut self) -> Option<u32> {
        let pid = self.child.id();
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
        self.stderr_task.abort();
        pid
    }
}

/// Supervised worker pool.
pub struct JsWorkerPool {
    config: SupervisorConfig,
    idle: Mutex<Vec<Worker>>,
    busy: AtomicUsize,
    outstanding: AtomicUsize,
    next_request_id: AtomicU64,
    next_generation: AtomicU64,
    closed: AtomicBool,
    live_pids: StdMutex<HashMap<u64, u32>>,
    notify: Notify,
}

impl JsWorkerPool {
    /// Spawn the configured number of workers.
    pub async fn new(config: SupervisorConfig) -> Result<Self, WorkerError> {
        config.validate()?;
        let pool = Self {
            config,
            idle: Mutex::new(Vec::new()),
            busy: AtomicUsize::new(0),
            outstanding: AtomicUsize::new(0),
            next_request_id: AtomicU64::new(0),
            next_generation: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            live_pids: StdMutex::new(HashMap::new()),
            notify: Notify::new(),
        };

        let mut spawned = Vec::new();
        for _ in 0..pool.config.workers {
            match pool.spawn_worker().await {
                Ok(worker) => spawned.push(worker),
                Err(error) => {
                    for worker in spawned {
                        let generation = worker.generation;
                        let _ = worker.terminate().await;
                        pool.unregister_pid(generation);
                    }
                    return Err(error);
                }
            }
        }
        *pool.idle.lock().await = spawned;
        Ok(pool)
    }

    /// Pool configuration.
    pub fn config(&self) -> &SupervisorConfig {
        &self.config
    }

    /// Allocate the next request id for the convenience helpers.
    pub fn next_request_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Pids of live worker processes (idle and busy), for diagnostics/tests.
    pub fn worker_pids(&self) -> Vec<u32> {
        let mut pids: Vec<u32> = self
            .live_pids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .copied()
            .collect();
        pids.sort_unstable();
        pids
    }

    /// Execute a function body and return its strictly parsed JSON result.
    pub async fn execute(
        &self,
        script: &str,
        context: serde_json::Value,
    ) -> Result<serde_json::Value, WorkerError> {
        let request = ScriptRequest::execute(self.next_request_id(), script, context);
        self.run_request(request).await
    }

    /// Syntax-check a function body without executing it.
    pub async fn validate(&self, script: &str) -> Result<(), WorkerError> {
        let request = ScriptRequest::validate(self.next_request_id(), script);
        self.run_request(request).await.map(|_| ())
    }

    /// Execute a legacy (v1) rule expression and return its boolean result.
    pub async fn execute_legacy(
        &self,
        script: &str,
        context: serde_json::Value,
    ) -> Result<serde_json::Value, WorkerError> {
        let request = ScriptRequest::execute_legacy(self.next_request_id(), script, context);
        self.run_request(request).await
    }

    /// Run one request, returning its JSON value or a bounded error.
    ///
    /// This future is cancellation-safe with respect to the pool: dropping it
    /// while a worker is checked out drops that worker (which is killed on
    /// drop). It never runs script work on the caller's thread.
    pub async fn run_request(
        &self,
        request: ScriptRequest,
    ) -> Result<serde_json::Value, WorkerError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(WorkerError::Shutdown);
        }
        if let Err(message) = protocol::validate_request(&request) {
            return Err(WorkerError::InvalidRequest { message });
        }
        let outstanding = self.outstanding.fetch_add(1, Ordering::SeqCst) + 1;
        if outstanding > self.config.max_outstanding_requests {
            self.outstanding.fetch_sub(1, Ordering::SeqCst);
            return Err(WorkerError::QueueFull {
                limit: self.config.max_outstanding_requests,
            });
        }
        let result = self.run_inner(request).await;
        self.outstanding.fetch_sub(1, Ordering::SeqCst);
        result
    }

    async fn run_inner(
        &self,
        mut request: ScriptRequest,
    ) -> Result<serde_json::Value, WorkerError> {
        let mut lease = self.acquire().await?;
        let generation = lease
            .worker
            .as_ref()
            .map(|worker| worker.generation)
            .unwrap_or(0);
        request.generation = generation;

        let outcome = {
            let worker = lease
                .worker
                .as_mut()
                .expect("worker lease always holds a worker");
            self.exchange(worker, &request).await
        };

        match outcome {
            Ok(response) => {
                let result = response.into_result();
                self.release(lease.take()).await;
                result.map_err(|message| WorkerError::Script {
                    request_id: request.request_id,
                    message,
                })
            }
            Err(error) if error.is_worker_fault() => {
                self.retire(lease.take()).await;
                Err(error)
            }
            Err(error) => {
                self.release(lease.take()).await;
                Err(error)
            }
        }
    }

    async fn exchange(
        &self,
        worker: &mut Worker,
        request: &ScriptRequest,
    ) -> Result<ScriptResponse, WorkerError> {
        let request_id = request.request_id;
        let payload = serde_json::to_vec(request).map_err(|error| WorkerError::InvalidRequest {
            message: format!("request serialization failed: {error}"),
        })?;
        if payload.len() > self.config.max_request_bytes {
            return Err(WorkerError::InvalidRequest {
                message: format!(
                    "request frame is {} bytes, exceeding the {} byte cap",
                    payload.len(),
                    self.config.max_request_bytes
                ),
            });
        }

        if let Err(error) =
            protocol::write_frame(&mut worker.stdin, &payload, self.config.max_request_bytes).await
        {
            return Err(self.crash_error(
                worker,
                request_id,
                format!("failed to write request frame: {error}"),
            ));
        }

        let response = tokio::time::timeout(
            self.config.invocation_timeout,
            protocol::read_frame(&mut worker.stdout, self.config.max_response_bytes),
        )
        .await;

        let bytes = match response {
            Err(_elapsed) => {
                return Err(WorkerError::Timeout {
                    request_id,
                    timeout_ms: self.config.invocation_timeout.as_millis() as u64,
                    diagnostics: worker.diagnostics_text(),
                });
            }
            Ok(Ok(None)) => {
                return Err(self.crash_error(
                    worker,
                    request_id,
                    "worker exited without producing a response".to_string(),
                ));
            }
            Ok(Ok(Some(bytes))) => bytes,
            Ok(Err(FrameError::Truncated { part })) => {
                return Err(self.crash_error(
                    worker,
                    request_id,
                    format!("worker response truncated in {part}"),
                ));
            }
            Ok(Err(FrameError::TooLarge { length, limit })) => {
                return Err(WorkerError::Protocol {
                    request_id,
                    message: format!(
                        "worker response frame of {length} bytes exceeds the {limit} byte cap"
                    ),
                    diagnostics: worker.diagnostics_text(),
                });
            }
            Ok(Err(error @ FrameError::EmptyFrame)) => {
                return Err(WorkerError::Protocol {
                    request_id,
                    message: error.to_string(),
                    diagnostics: worker.diagnostics_text(),
                });
            }
            Ok(Err(FrameError::Io(error))) => {
                return Err(self.crash_error(
                    worker,
                    request_id,
                    format!("worker response I/O error: {error}"),
                ));
            }
        };

        let response: ScriptResponse =
            serde_json::from_slice(&bytes).map_err(|error| WorkerError::Protocol {
                request_id,
                message: format!("worker response is not valid JSON: {error}"),
                diagnostics: worker.diagnostics_text(),
            })?;

        if response.request_id != request.request_id || response.generation != request.generation {
            return Err(WorkerError::Protocol {
                request_id,
                message: format!(
                    "worker response ids (request {}, generation {}) do not match request (request {}, generation {})",
                    response.request_id, response.generation, request.request_id, request.generation
                ),
                diagnostics: worker.diagnostics_text(),
            });
        }

        Ok(response)
    }

    fn crash_error(&self, worker: &Worker, request_id: u64, message: String) -> WorkerError {
        WorkerError::Crash {
            request_id,
            message,
            diagnostics: worker.diagnostics_text(),
        }
    }

    async fn acquire(&self) -> Result<WorkerLease<'_>, WorkerError> {
        loop {
            if self.closed.load(Ordering::SeqCst) {
                return Err(WorkerError::Shutdown);
            }

            let mut idle = self.idle.lock().await;
            if let Some(worker) = idle.pop() {
                self.busy.fetch_add(1, Ordering::SeqCst);
                return Ok(WorkerLease {
                    pool: self,
                    worker: Some(worker),
                });
            }
            if idle.len() + self.busy.load(Ordering::SeqCst) < self.config.workers {
                match self.spawn_worker().await {
                    Ok(worker) => {
                        self.busy.fetch_add(1, Ordering::SeqCst);
                        return Ok(WorkerLease {
                            pool: self,
                            worker: Some(worker),
                        });
                    }
                    Err(error) => return Err(error),
                }
            }
            drop(idle);
            self.notify.notified().await;
        }
    }

    async fn release(&self, worker: Worker) {
        self.busy.fetch_sub(1, Ordering::SeqCst);
        if self.closed.load(Ordering::SeqCst) {
            let generation = worker.generation;
            let _ = worker.terminate().await;
            self.unregister_pid(generation);
        } else {
            self.idle.lock().await.push(worker);
        }
        self.notify.notify_one();
    }

    /// Kill and reap a faulted worker, then eagerly replace it.
    async fn retire(&self, worker: Worker) {
        let generation = worker.generation;
        let _ = worker.terminate().await;
        self.unregister_pid(generation);
        self.busy.fetch_sub(1, Ordering::SeqCst);

        let mut idle = self.idle.lock().await;
        if idle.len() + self.busy.load(Ordering::SeqCst) < self.config.workers {
            if let Ok(replacement) = self.spawn_worker().await {
                idle.push(replacement);
            }
        }
        drop(idle);
        self.notify.notify_one();
    }

    /// Stop all idle workers and reject future requests.
    pub async fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let workers = {
            let mut idle = self.idle.lock().await;
            std::mem::take(&mut *idle)
        };
        for worker in workers {
            let generation = worker.generation;
            let _ = worker.terminate().await;
            self.unregister_pid(generation);
        }
        self.notify.notify_waiters();
    }

    async fn spawn_worker(&self) -> Result<Worker, WorkerError> {
        let generation = self.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let binary = match &self.config.worker_binary {
            Some(path) => path.clone(),
            None => default_worker_binary()?,
        };

        let mut command = tokio::process::Command::new(&binary);
        command
            .args(&self.config.extra_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .kill_on_drop(true);

        #[cfg(unix)]
        configure_resource_limits(&mut command, &self.config);

        let mut child = command.spawn().map_err(|error| WorkerError::Spawn {
            message: format!("failed to spawn {}: {error}", binary.display()),
        })?;

        let Some(stdin) = child.stdin.take() else {
            return Err(WorkerError::Spawn {
                message: "worker stdin pipe was not created".to_string(),
            });
        };
        let Some(stdout) = child.stdout.take() else {
            return Err(WorkerError::Spawn {
                message: "worker stdout pipe was not created".to_string(),
            });
        };
        let Some(stderr) = child.stderr.take() else {
            return Err(WorkerError::Spawn {
                message: "worker stderr pipe was not created".to_string(),
            });
        };

        if let Some(pid) = child.id() {
            self.live_pids
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(generation, pid);
        }

        let (stderr_task, diagnostics) =
            spawn_diagnostics_reader(stderr, self.config.max_diagnostics_bytes);

        Ok(Worker {
            generation,
            child,
            stdin,
            stdout: BufReader::new(stdout),
            diagnostics,
            stderr_task,
        })
    }

    fn unregister_pid(&self, generation: u64) {
        self.live_pids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&generation);
    }
}

fn default_worker_binary() -> Result<PathBuf, WorkerError> {
    let current = std::env::current_exe().map_err(|error| WorkerError::Spawn {
        message: format!("cannot locate the current executable: {error}"),
    })?;
    let directory = current.parent().ok_or_else(|| WorkerError::Spawn {
        message: "current executable has no parent directory".to_string(),
    })?;
    Ok(directory.join(format!("script-worker{}", std::env::consts::EXE_SUFFIX)))
}

/// Continuously drain stderr into a capped ring buffer.
///
/// Draining is what prevents a chatty or hostile worker from blocking forever
/// on a full stderr pipe; the cap keeps server memory bounded.
fn spawn_diagnostics_reader(
    mut stderr: ChildStderr,
    cap: usize,
) -> (JoinHandle<()>, Arc<StdMutex<DiagnosticBuffer>>) {
    let buffer = Arc::new(StdMutex::new(DiagnosticBuffer::default()));
    let task_buffer = Arc::clone(&buffer);
    let handle = tokio::spawn(async move {
        let mut chunk = [0u8; 8192];
        loop {
            match stderr.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let mut guard = task_buffer
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    guard.push(&chunk[..read], cap);
                }
            }
        }
    });
    (handle, buffer)
}

#[cfg(unix)]
fn configure_resource_limits(command: &mut tokio::process::Command, config: &SupervisorConfig) {
    let address_space = config.address_space_limit_bytes;
    let cpu_seconds = config.cpu_time_limit_secs;

    // SAFETY: the closure runs in the forked child before exec and calls only
    // async-signal-safe `setrlimit`/`io::Error` operations.
    unsafe {
        command.pre_exec(move || {
            set_rlimit(libc::RLIMIT_AS as libc::c_int, address_space)?;
            set_rlimit(libc::RLIMIT_CPU as libc::c_int, cpu_seconds)?;
            set_rlimit(libc::RLIMIT_CORE as libc::c_int, 0)?;
            Ok(())
        });
    }
}

#[cfg(unix)]
fn set_rlimit(resource: libc::c_int, value: u64) -> std::io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: value,
        rlim_max: value,
    };
    // SAFETY: `limit` is a valid rlimit struct for the duration of the call.
    if unsafe { libc::setrlimit(resource as _, &limit) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_bounded() {
        let config = SupervisorConfig::default();
        assert_eq!(config.workers, DEFAULT_WORKERS);
        assert_eq!(config.invocation_timeout, DEFAULT_INVOCATION_TIMEOUT);
        assert_eq!(config.invocation_timeout, Duration::from_millis(200));
        assert_eq!(
            config.max_outstanding_requests,
            DEFAULT_MAX_OUTSTANDING_REQUESTS
        );
        assert_eq!(config.address_space_limit_bytes, 256 * 1024 * 1024);
        assert_eq!(config.cpu_time_limit_secs, 5);
        assert!(config.max_diagnostics_bytes > 0);
        assert!(config.max_request_bytes >= protocol::MAX_CONTEXT_BYTES);
    }

    #[test]
    fn diagnostics_ring_keeps_the_tail() {
        let mut buffer = DiagnosticBuffer::default();
        buffer.push(b"hello world", 5);
        assert_eq!(buffer.to_lossy_string(), "world");
        buffer.push(b"!", 5);
        assert_eq!(buffer.to_lossy_string(), "orld!");
    }

    #[test]
    fn config_validation_rejects_unbounded_settings() {
        let config = SupervisorConfig {
            workers: 0,
            ..SupervisorConfig::default()
        };
        assert!(config.validate().is_err());

        let config = SupervisorConfig {
            invocation_timeout: Duration::ZERO,
            ..SupervisorConfig::default()
        };
        assert!(config.validate().is_err());

        let config = SupervisorConfig {
            address_space_limit_bytes: 0,
            ..SupervisorConfig::default()
        };
        assert!(config.validate().is_err());

        assert!(SupervisorConfig::default().validate().is_ok());
    }

    #[test]
    fn worker_error_classifies_faults() {
        assert!(WorkerError::Timeout {
            request_id: 1,
            timeout_ms: 200,
            diagnostics: String::new()
        }
        .is_worker_fault());
        assert!(!WorkerError::Script {
            request_id: 1,
            message: "boom".to_string()
        }
        .is_worker_fault());
        assert!(!WorkerError::QueueFull { limit: 1 }.is_worker_fault());
    }
}
