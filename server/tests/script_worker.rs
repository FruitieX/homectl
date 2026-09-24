//! Process-level containment tests for the P06 JavaScript worker (S01–S09).
//!
//! These tests spawn the real `script-worker` binary and drive it through
//! [`JsWorkerPool`]. The hidden `--test-mode` flag provides deterministic
//! fault injection (hanging, allocation abuse, crashes, frame truncation)
//! instead of sleeps and races inside script source.
//!
//! The suite asserts:
//! * S01–S03: infinite loop, deep recursion, and long computation terminate
//!   within bounds and cannot stall async progress.
//! * S04: memory and output abuse stay within the documented platform limits.
//! * S05: crashes and protocol truncation produce bounded failures and a
//!   working replacement worker.
//! * S06: globals and prototype mutations never leak between invocations.
//! * S07: scripts get no ambient process/network/filesystem capability and
//!   workers inherit no environment.
//! * S08: timed-out workers are killed and reaped, not abandoned.
//! * S09: validation/preview work uses the same supervision limits.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use homectl_server::core::js_worker::protocol::{ScriptRequest, TestMode, MAX_SCRIPT_BYTES};
use homectl_server::core::js_worker::{JsWorkerPool, SupervisorConfig, WorkerError};
use serde_json::json;

fn worker_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_script-worker"))
}

fn test_config(workers: usize) -> SupervisorConfig {
    SupervisorConfig {
        worker_binary: Some(worker_binary()),
        workers,
        invocation_timeout: Duration::from_millis(500),
        extra_args: vec!["--test-mode".to_string()],
        ..SupervisorConfig::default()
    }
}

async fn test_pool(workers: usize) -> JsWorkerPool {
    JsWorkerPool::new(test_config(workers))
        .await
        .expect("spawn worker pool")
}

fn test_request(id: u64, mode: TestMode) -> ScriptRequest {
    let mut request = ScriptRequest::execute(id, "return null;", serde_json::Value::Null);
    request.test_mode = Some(mode);
    request
}

async fn run_legacy(
    pool: &JsWorkerPool,
    script: &str,
    context: &serde_json::Value,
) -> Result<serde_json::Value, WorkerError> {
    pool.execute_legacy(script, context.clone()).await
}

fn proc_entry_exists(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

#[tokio::test]
async fn default_budget_serves_trivial_scripts() {
    let mut config = test_config(2);
    config.invocation_timeout = homectl_server::core::js_worker::DEFAULT_INVOCATION_TIMEOUT;
    let pool = JsWorkerPool::new(config).await.unwrap();

    let start = Instant::now();
    let value = pool
        .execute("return ctx.n + 1;", json!({"n": 41}))
        .await
        .unwrap();
    let elapsed = start.elapsed();
    eprintln!(
        "measured trivial script invocation latency (fresh realm + IPC): {elapsed:?} \
         with the default {:?} budget",
        homectl_server::core::js_worker::DEFAULT_INVOCATION_TIMEOUT
    );
    assert_eq!(value, json!(42));
    assert!(
        elapsed < homectl_server::core::js_worker::DEFAULT_INVOCATION_TIMEOUT,
        "default budget is too tight: {elapsed:?}"
    );

    pool.shutdown().await;
}

#[tokio::test]
async fn executes_and_validates_scripts_through_the_worker() {
    let pool = test_pool(2).await;

    let value = pool
        .execute("return { power: true, ctx_n: ctx.n };", json!({"n": 7}))
        .await
        .expect("script succeeds");
    assert_eq!(value, json!({"power": true, "ctx_n": 7}));

    pool.validate("return 1;").await.expect("valid syntax");
    let error = pool.validate("return (;").await.unwrap_err();
    assert!(matches!(error, WorkerError::Script { .. }), "{error:?}");

    pool.shutdown().await;
}

// Section 6.4: the legacy (v1) invocation format keeps its own globals, raw
// expression completion, and JavaScript truthiness, and is versioned
// separately from the v2 ABI.
#[tokio::test]
async fn legacy_rule_scripts_keep_v1_semantics_through_the_worker() {
    use homectl_server::core::js_worker::protocol::{
        RequestKind, SUPPORTED_LEGACY_API_VERSION, SUPPORTED_SCRIPT_API_VERSION,
    };

    let pool = test_pool(2).await;
    let context = json!({
        "devices": { "mqtt/lamp": { "name": "Lamp" } },
        "groups": { "room": { "name": "Room", "power": true, "scene_id": "night" } }
    });
    assert_eq!(
        run_legacy(&pool, "true", &context).await.unwrap(),
        json!(true)
    );
    assert_eq!(
        run_legacy(&pool, "''", &context).await.unwrap(),
        json!(false)
    );
    assert_eq!(
        run_legacy(&pool, "'0'", &context).await.unwrap(),
        json!(true)
    );
    assert_eq!(
        run_legacy(&pool, "groups['room'].scene_id === 'night'", &context)
            .await
            .unwrap(),
        json!(true)
    );
    assert_eq!(
        run_legacy(&pool, "devices['mqtt/lamp'].name === 'Lamp'", &context)
            .await
            .unwrap(),
        json!(true)
    );
    assert!(
        run_legacy(&pool, "return true;", &context).await.is_err(),
        "the v2 body ABI must not be accepted by the legacy format"
    );
    assert!(run_legacy(&pool, "while (true) {}", &context)
        .await
        .is_err());

    // A v2-versioned request must not be accepted as legacy.
    let mut mismatched = ScriptRequest::execute_legacy(1, "true", context.clone());
    assert_eq!(mismatched.kind, RequestKind::ExecuteLegacy);
    assert_eq!(mismatched.api_version, SUPPORTED_LEGACY_API_VERSION);
    mismatched.api_version = SUPPORTED_SCRIPT_API_VERSION + 1;
    let error = pool.run_request(mismatched).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    pool.shutdown().await;
}

// P08/Section 6.4: the legacy scene invocation format keeps the scene helper
// prelude, the `devices`/`groups` globals, and the raw JSON output, versioned
// separately from both the v2 ABI and legacy rule truthiness.
#[tokio::test]
async fn legacy_scene_scripts_keep_v1_json_semantics_through_the_worker() {
    use homectl_server::core::js_worker::protocol::{
        RequestKind, SUPPORTED_LEGACY_SCENE_API_VERSION, SUPPORTED_SCRIPT_API_VERSION,
    };

    let pool = test_pool(2).await;
    let context = json!({
        "devices": { "mqtt/lamp": { "name": "Lamp" } },
        "groups": { "room": { "name": "Room", "power": true, "scene_id": "night" } }
    });
    let script = "defineSceneScript(function () { return { \
                  'mqtt/lamp': deviceState({ power: true }), \
                  'mqtt/other': deviceLink({ device_ref: { integration_id: 'mqtt', device_id: 'lamp' } }) }; })";
    let value = pool
        .execute_legacy_scene(script, context.clone())
        .await
        .unwrap();
    assert_eq!(value["mqtt/lamp"]["power"], json!(true));
    assert_eq!(
        value["mqtt/other"]["device_ref"]["device_id"],
        json!("lamp")
    );

    // Raw JSON completions are returned as-is; the server-side merge treats
    // non-objects as an empty device map.
    assert_eq!(
        pool.execute_legacy_scene("42", context.clone())
            .await
            .unwrap(),
        json!(42)
    );
    assert!(pool
        .execute_legacy_scene("return {};", context.clone())
        .await
        .is_err());
    assert!(pool
        .execute_legacy_scene("while (true) {}", context.clone())
        .await
        .is_err());

    let mut mismatched = ScriptRequest::execute_legacy_scene(1, script, context.clone());
    assert_eq!(mismatched.kind, RequestKind::ExecuteLegacyScene);
    assert_eq!(mismatched.api_version, SUPPORTED_LEGACY_SCENE_API_VERSION);
    mismatched.api_version = SUPPORTED_SCRIPT_API_VERSION + 1;
    let error = pool.run_request(mismatched).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    pool.shutdown().await;
}

#[tokio::test]
async fn s01_hanging_worker_times_out_and_is_replaced() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_millis(250);
    let pool = JsWorkerPool::new(config).await.unwrap();

    let hang_id = pool.next_request_id();
    let start = Instant::now();
    let error = pool
        .run_request(test_request(hang_id, TestMode::Hang))
        .await
        .unwrap_err();
    let elapsed = start.elapsed();
    match &error {
        WorkerError::Timeout {
            request_id,
            timeout_ms,
            ..
        } => {
            assert_eq!(*request_id, hang_id);
            assert_eq!(*timeout_ms, 250);
        }
        other => panic!("expected timeout, got {other:?}"),
    }
    assert!(elapsed < Duration::from_secs(5), "timeout took {elapsed:?}");

    let echo_id = pool.next_request_id();
    let echo = pool
        .run_request(test_request(echo_id, TestMode::Echo))
        .await
        .expect("replacement worker serves the pool");
    assert_eq!(echo["echo"], echo_id);

    pool.shutdown().await;
}

#[tokio::test]
async fn s01_hang_does_not_stall_async_progress() {
    // Runs on a current-thread runtime: if the pool blocked its thread while
    // waiting for the worker, the ticker below could not advance at all.
    let mut config = test_config(2);
    config.invocation_timeout = Duration::from_millis(400);
    let pool = JsWorkerPool::new(config).await.unwrap();

    let ticks = Arc::new(AtomicUsize::new(0));
    let ticker = {
        let ticks = Arc::clone(&ticks);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(20)).await;
                ticks.fetch_add(1, Ordering::SeqCst);
            }
        })
    };

    let error = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Hang))
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Timeout { .. }));

    let observed = ticks.load(Ordering::SeqCst);
    assert!(
        observed >= 8,
        "only {observed} scheduler ticks while a worker hung for 400 ms"
    );

    ticker.abort();
    pool.shutdown().await;
}

#[tokio::test]
async fn s02_deep_recursion_terminates_without_blocking() {
    let pool = test_pool(1).await;

    let start = Instant::now();
    let error = pool
        .execute(
            "function recurse() { return recurse(); } return recurse();",
            serde_json::Value::Null,
        )
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Script { .. }), "{error:?}");
    assert!(start.elapsed() < Duration::from_secs(5));

    let error = pool
        .execute(
            "function recurse(n) { return recurse(n + 1); } return recurse(0);",
            serde_json::Value::Null,
        )
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Script { .. }), "{error:?}");

    // In-engine termination keeps the worker healthy.
    pool.validate("return 1;").await.unwrap();
    pool.shutdown().await;
}

#[tokio::test]
async fn s03_long_computation_terminates_and_pool_stays_fair() {
    let mut config = test_config(2);
    config.invocation_timeout = Duration::from_millis(800);
    let pool = Arc::new(JsWorkerPool::new(config).await.unwrap());

    // A tight loop is bounded by the invocation timeout rather than by the
    // in-engine loop budget: that budget has to stay large enough for
    // `String.prototype.repeat` to build a result of MAX_RESULT_BYTES (Boa
    // counts one loop iteration per repeated byte), which is more iterations
    // than a wall-clock budget can afford. Either way the computation
    // terminates and the worker is replaced, which is what this case pins.
    let start = Instant::now();
    let error = pool
        .execute(
            "let x = 0; while (true) { x += 1; }",
            serde_json::Value::Null,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            error,
            WorkerError::Script { .. } | WorkerError::Timeout { .. }
        ),
        "{error:?}"
    );
    assert!(start.elapsed() < Duration::from_secs(5));

    // A natively hung worker must not block the other pool member.
    let pool_for_hang = Arc::clone(&pool);
    let hang = tokio::spawn(async move {
        pool_for_hang
            .run_request(test_request(
                pool_for_hang.next_request_id(),
                TestMode::Hang,
            ))
            .await
    });
    tokio::task::yield_now().await;

    let echo_start = Instant::now();
    let echo = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Echo))
        .await
        .expect("second worker serves while the first hangs");
    let echo_elapsed = echo_start.elapsed();
    assert!(echo.get("echo").is_some());
    assert!(
        echo_elapsed < Duration::from_millis(500),
        "echo waited {echo_elapsed:?} behind a hanging worker"
    );

    let hang_result = hang.await.unwrap();
    assert!(matches!(hang_result, Err(WorkerError::Timeout { .. })));

    pool.shutdown().await;
}

#[tokio::test]
async fn s04_allocation_abuse_is_contained_by_the_address_space_limit() {
    const LIMIT: u64 = 256 * 1024 * 1024;
    let mut config = test_config(1);
    config.address_space_limit_bytes = LIMIT;
    // The probe touches every allocated page; debug builds on slow CI runners
    // need more than the default 500ms to reach the bound.
    config.invocation_timeout = Duration::from_secs(10);
    let pool = JsWorkerPool::new(config).await.unwrap();

    let start = Instant::now();
    let error = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Alloc))
        .await
        .unwrap_err();
    let message = match &error {
        WorkerError::Script { message, .. } => message.clone(),
        other => panic!("expected a bounded allocation failure, got {other:?}"),
    };
    let measured: u64 = message
        .rsplit("after ")
        .next()
        .and_then(|value| value.split(' ').next())
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| panic!("unexpected allocation message: {message}"));
    eprintln!("measured worker address-space allocation bound: {measured} bytes (limit {LIMIT})");
    assert!(measured <= LIMIT, "allocation exceeded the rlimit");
    assert!(measured >= 16 * 1024 * 1024, "probe failed too early");
    assert!(start.elapsed() < Duration::from_secs(20));

    pool.validate("return 1;").await.unwrap();
    pool.shutdown().await;
}

#[tokio::test]
async fn s04_output_abuse_is_bounded_and_keeps_the_worker() {
    let mut config = test_config(1);
    // Building the oversized string in a debug build on a slow CI runner can
    // exceed the default 500ms budget before the output cap is reached.
    config.invocation_timeout = Duration::from_secs(10);
    let pool = JsWorkerPool::new(config).await.unwrap();
    let before = pool.worker_pids();

    let error = pool
        .execute(
            "return 'x'.repeat(4 * 1024 * 1024);",
            serde_json::Value::Null,
        )
        .await
        .unwrap_err();
    match &error {
        WorkerError::Script { message, .. } => {
            assert!(message.contains("limit"), "unexpected message: {message}")
        }
        other => panic!("expected a bounded output failure, got {other:?}"),
    }

    assert_eq!(pool.worker_pids(), before, "worker should stay healthy");
    pool.execute("return 'ok';", serde_json::Value::Null)
        .await
        .unwrap();
    pool.shutdown().await;
}

#[tokio::test]
async fn s05_crash_truncation_and_garbage_replace_the_worker() {
    for mode in [TestMode::Crash, TestMode::Truncate, TestMode::Garbage] {
        let pool = test_pool(1).await;
        let before = pool.worker_pids();
        assert_eq!(before.len(), 1, "{mode:?}: expected one worker");

        let error = pool
            .run_request(test_request(pool.next_request_id(), mode))
            .await
            .unwrap_err();
        assert!(
            matches!(
                error,
                WorkerError::Crash { .. } | WorkerError::Protocol { .. }
            ),
            "{mode:?}: expected bounded failure, got {error:?}"
        );

        let after = pool.worker_pids();
        assert_eq!(after.len(), 1, "{mode:?}: replacement worker missing");
        assert_ne!(after[0], before[0], "{mode:?}: worker was not replaced");
        assert!(
            !proc_entry_exists(before[0]),
            "{mode:?}: faulted worker {} is still present",
            before[0]
        );

        let echo = pool
            .run_request(test_request(pool.next_request_id(), TestMode::Echo))
            .await
            .unwrap_or_else(|error| panic!("{mode:?}: replacement unusable: {error:?}"));
        assert!(echo.get("echo").is_some(), "{mode:?}: echo succeeded");

        pool.shutdown().await;
    }
}

#[tokio::test]
async fn s06_globals_and_prototypes_do_not_leak_between_invocations() {
    let pool = test_pool(1).await;

    pool.execute(
        "globalThis.__homectl_leak = 42; Object.prototype.__homectl_polluted = 'x'; return true;",
        serde_json::Value::Null,
    )
    .await
    .unwrap();

    let value = pool
        .execute(
            "return { leak: typeof globalThis.__homectl_leak, polluted: typeof ({}).__homectl_polluted };",
            serde_json::Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(value, json!({"leak": "undefined", "polluted": "undefined"}));

    pool.shutdown().await;
}

#[tokio::test]
async fn s07_no_ambient_capabilities_and_no_inherited_environment() {
    let pool = test_pool(1).await;

    let value = pool
        .execute(
            r#"return {
                process: typeof process,
                require: typeof require,
                fetch: typeof fetch,
                XMLHttpRequest: typeof XMLHttpRequest,
                WebSocket: typeof WebSocket,
                Deno: typeof Deno,
                Bun: typeof Bun,
                fs: typeof globalThis.fs,
                readFile: typeof globalThis.readFile,
                child_process: typeof globalThis.child_process,
                env: typeof globalThis.env
            };"#,
            serde_json::Value::Null,
        )
        .await
        .unwrap();
    for (capability, kind) in value.as_object().unwrap() {
        assert_eq!(
            kind, "undefined",
            "ambient capability {capability} is exposed"
        );
    }

    let env = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Env))
        .await
        .unwrap();
    assert_eq!(
        env["env"],
        json!([]),
        "worker inherited environment variables"
    );

    pool.shutdown().await;
}

#[tokio::test]
async fn s08_timed_out_worker_is_killed_and_reaped() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_millis(250);
    let pool = JsWorkerPool::new(config).await.unwrap();

    let before = pool.worker_pids();
    assert_eq!(before.len(), 1);
    let pid = before[0];

    let error = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Hang))
        .await
        .unwrap_err();
    assert!(matches!(error, WorkerError::Timeout { .. }));

    assert!(
        !proc_entry_exists(pid),
        "worker {pid} was not reaped after the timeout"
    );
    let after = pool.worker_pids();
    assert_eq!(after.len(), 1);
    assert_ne!(after[0], pid, "expected a fresh worker incarnation");

    pool.shutdown().await;
}

#[tokio::test]
async fn s09_validation_and_preview_work_uses_the_same_limits() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_millis(250);
    let pool = JsWorkerPool::new(config).await.unwrap();
    let before = pool.worker_pids();

    // A validation invocation cannot bypass the timeout/kill path.
    let mut hang = ScriptRequest::validate(pool.next_request_id(), "return 1;");
    hang.test_mode = Some(TestMode::Hang);
    let error = pool.run_request(hang).await.unwrap_err();
    assert!(matches!(error, WorkerError::Timeout { .. }));
    let replacement = pool.worker_pids();
    assert_eq!(replacement.len(), 1);
    assert_ne!(
        replacement[0], before[0],
        "validation timeout did not replace the worker"
    );

    // Oversize input is rejected before a worker is even used.
    let oversized =
        ScriptRequest::validate(pool.next_request_id(), "x".repeat(MAX_SCRIPT_BYTES + 1));
    let error = pool.run_request(oversized).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );
    assert_eq!(pool.worker_pids(), replacement);

    pool.validate("return 1;").await.unwrap();
    pool.shutdown().await;
}

#[tokio::test]
async fn script_errors_keep_the_worker_healthy() {
    let pool = test_pool(1).await;
    let before = pool.worker_pids();

    for script in [
        "return undefined;",
        "return function () {};",
        "return 1 / 0;",
        "return (;",
        "throw new Error('boom');",
        "var a = {}; a.self = a; return a;",
    ] {
        let error = pool
            .execute(script, serde_json::Value::Null)
            .await
            .unwrap_err();
        assert!(
            matches!(error, WorkerError::Script { .. }),
            "{script}: expected a script error, got {error:?}"
        );
    }

    assert_eq!(
        pool.worker_pids(),
        before,
        "bounded script errors must not retire the worker"
    );
    pool.shutdown().await;
}

#[tokio::test]
async fn queue_bound_is_visible_and_bounded() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_millis(400);
    config.max_outstanding_requests = 2;
    let pool = Arc::new(JsWorkerPool::new(config).await.unwrap());

    // Drive the first request into the worker without awaiting it.
    let hang_request = test_request(pool.next_request_id(), TestMode::Hang);
    let hang = pool.run_request(hang_request);
    tokio::pin!(hang);
    assert!(futures::poll!(hang.as_mut()).is_pending());

    // The second request waits for the worker without being rejected.
    let queued_request = test_request(pool.next_request_id(), TestMode::Echo);
    let queued = pool.run_request(queued_request);
    tokio::pin!(queued);
    assert!(futures::poll!(queued.as_mut()).is_pending());

    // The third is rejected immediately and visibly.
    let error = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Echo))
        .await
        .unwrap_err();
    assert!(
        matches!(error, WorkerError::QueueFull { limit: 2 }),
        "{error:?}"
    );

    let hang_result = hang.await;
    assert!(matches!(hang_result, Err(WorkerError::Timeout { .. })));
    assert!(
        queued.await.is_ok(),
        "queued request completes after replacement"
    );

    pool.shutdown().await;
}

#[tokio::test]
async fn request_limits_are_enforced_before_workers() {
    let pool = test_pool(1).await;
    let before = pool.worker_pids();

    let mut wrong_version =
        ScriptRequest::execute(pool.next_request_id(), "return 1;", json!(null));
    wrong_version.api_version = 99;
    let error = pool.run_request(wrong_version).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    let oversize_script = ScriptRequest::execute(
        pool.next_request_id(),
        "x".repeat(MAX_SCRIPT_BYTES + 1),
        json!(null),
    );
    let error = pool.run_request(oversize_script).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    let oversize_context = ScriptRequest::execute(
        pool.next_request_id(),
        "return 1;",
        json!({"blob": "x".repeat(8 * 1024 * 1024 + 1)}),
    );
    let error = pool.run_request(oversize_context).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    let mut long_run_id = ScriptRequest::execute(pool.next_request_id(), "return 1;", json!(null));
    long_run_id.run_id = Some("r".repeat(300));
    let error = pool.run_request(long_run_id).await.unwrap_err();
    assert!(
        matches!(error, WorkerError::InvalidRequest { .. }),
        "{error:?}"
    );

    assert_eq!(
        pool.worker_pids(),
        before,
        "rejected requests use no worker"
    );
    pool.validate("return 1;").await.unwrap();
    pool.shutdown().await;
}

#[tokio::test]
async fn cancelled_invocation_releases_its_pool_slot() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_secs(30);
    let pool = Arc::new(JsWorkerPool::new(config).await.unwrap());
    let before = pool.worker_pids();
    assert_eq!(before.len(), 1);

    let mut hang = Box::pin(pool.run_request(test_request(pool.next_request_id(), TestMode::Hang)));
    assert!(futures::poll!(hang.as_mut()).is_pending());

    // Cancelling the caller must kill the worker and free the slot so the pool
    // can spawn a replacement instead of deadlocking.
    drop(hang);

    let echo = pool
        .run_request(test_request(pool.next_request_id(), TestMode::Echo))
        .await
        .expect("pool recovers after cancellation");
    assert!(echo.get("echo").is_some());
    let after = pool.worker_pids();
    assert_eq!(after.len(), 1);
    assert_ne!(after, before, "cancelled worker was not replaced");
    assert!(!proc_entry_exists(before[0]));

    pool.shutdown().await;
}

#[tokio::test]
async fn stderr_flood_is_capped_and_drained() {
    let mut config = test_config(1);
    config.invocation_timeout = Duration::from_millis(500);
    config.max_diagnostics_bytes = 8 * 1024;
    let pool = JsWorkerPool::new(config).await.unwrap();

    let error = pool
        .run_request(test_request(pool.next_request_id(), TestMode::StderrHang))
        .await
        .unwrap_err();
    let WorkerError::Timeout { diagnostics, .. } = &error else {
        panic!("expected timeout, got {error:?}");
    };
    assert!(!diagnostics.is_empty(), "stderr diagnostics were lost");
    assert!(
        diagnostics.len() <= 8 * 1024,
        "diagnostics exceeded the cap: {} bytes",
        diagnostics.len()
    );

    // The flood did not deadlock supervision and the replacement works.
    pool.validate("return 1;").await.unwrap();
    pool.shutdown().await;
}
