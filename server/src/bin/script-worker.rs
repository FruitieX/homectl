//! Supervised JavaScript worker process.
//!
//! This binary is spawned by [`homectl_server::core::js_worker::JsWorkerPool`]
//! and speaks the bounded length-prefixed JSON protocol from
//! [`homectl_server::core::js_worker::protocol`] on stdin/stdout. stdout is
//! protocol-only; diagnostics belong on stderr.
//!
//! It owns no server state, opens no database handles, performs no network or
//! filesystem I/O on behalf of scripts, and constructs a fresh Boa realm for
//! every invocation.
//!
//! A hidden `--test-mode` flag enables deterministic fault injection for the
//! process-level containment tests (`hang`, `alloc`, `crash`, `truncate`,
//! `garbage`, `stderr_hang`, `echo`, `env`). Without the flag, requests that
//! ask for a test mode are protocol violations.

use homectl_server::core::js_worker::engine;
use homectl_server::core::js_worker::protocol::{
    self, RequestKind, ScriptRequest, ScriptResponse, TestMode,
};

use std::io::{BufReader, BufWriter, Write};

fn main() {
    let mut test_modes_enabled = false;
    for argument in std::env::args().skip(1) {
        match argument.as_str() {
            "--test-mode" => test_modes_enabled = true,
            _ => std::process::exit(2),
        }
    }

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());

    loop {
        let frame = match protocol::read_frame_blocking(&mut reader, protocol::MAX_REQUEST_BYTES) {
            Ok(Some(frame)) => frame,
            // Clean EOF at a frame boundary: the supervisor closed the pool.
            Ok(None) => return,
            // Framing violation: exit so the supervisor replaces us.
            Err(_) => std::process::exit(2),
        };

        let request: ScriptRequest = match serde_json::from_slice(&frame) {
            Ok(request) => request,
            Err(_) => std::process::exit(2),
        };

        if request.generation == 0 {
            std::process::exit(2);
        }
        if request.test_mode.is_some() && !test_modes_enabled {
            std::process::exit(2);
        }

        match request.test_mode {
            Some(mode) => handle_test_mode(mode, &request, &mut writer),
            None => handle_script(&request, &mut writer),
        }
    }
}

fn handle_script(request: &ScriptRequest, writer: &mut impl Write) {
    let result = match request.kind {
        RequestKind::Execute => engine::execute_script(
            &request.script,
            &request.context,
            engine::MAX_SCRIPT_RESULT_BYTES,
        ),
        RequestKind::Validate => {
            engine::validate_script(&request.script).map(|()| serde_json::Value::Null)
        }
        RequestKind::ExecuteLegacy => {
            engine::execute_legacy_rule_script(&request.script, &request.context)
        }
    };

    let response = match result {
        Ok(value) => ScriptResponse::success(request.request_id, request.generation, value),
        Err(message) => ScriptResponse::failure(request.request_id, request.generation, message),
    };
    respond(writer, &response);
}

/// Deterministic fault injection, selected per request by the supervisor.
fn handle_test_mode(mode: TestMode, request: &ScriptRequest, writer: &mut impl Write) {
    match mode {
        TestMode::Echo => respond(
            writer,
            &ScriptResponse::success(
                request.request_id,
                request.generation,
                serde_json::json!({"echo": request.request_id}),
            ),
        ),
        TestMode::Env => {
            let mut names: Vec<String> = std::env::vars().map(|(name, _)| name).collect();
            names.sort();
            respond(
                writer,
                &ScriptResponse::success(
                    request.request_id,
                    request.generation,
                    serde_json::json!({ "env": names }),
                ),
            );
        }
        TestMode::Hang => spin_forever(),
        TestMode::Alloc => allocation_probe(request, writer),
        TestMode::Crash => std::process::abort(),
        TestMode::Truncate => {
            let _ = writer.write_all(&64u32.to_be_bytes());
            let _ = writer.write_all(&[0u8, 1u8]);
            let _ = writer.flush();
            std::process::exit(0);
        }
        TestMode::Garbage => {
            let _ = protocol::write_frame_blocking(
                writer,
                br#"{"not":"a response"}"#,
                protocol::MAX_RESPONSE_BYTES,
            );
        }
        TestMode::StderrHang => {
            let mut stderr = std::io::stderr().lock();
            let line = b"homectl-script-worker diagnostics flood\n";
            for _ in 0..80_000 {
                if stderr.write_all(line).is_err() {
                    break;
                }
            }
            let _ = stderr.flush();
            spin_forever();
        }
    }
}

fn respond(writer: &mut impl Write, response: &ScriptResponse) {
    let payload = match serde_json::to_vec(response) {
        Ok(payload) => payload,
        Err(_) => std::process::exit(2),
    };
    if protocol::write_frame_blocking(writer, &payload, protocol::MAX_RESPONSE_BYTES).is_err() {
        std::process::exit(2);
    }
}

fn spin_forever() -> ! {
    loop {
        std::hint::spin_loop();
    }
}

/// Allocate until the kernel refuses, then report how many bytes were held.
///
/// `try_reserve` keeps allocation failure recoverable so the process can
/// report the measured bound instead of aborting.
fn allocation_probe(request: &ScriptRequest, writer: &mut impl Write) {
    const CHUNK_BYTES: usize = 1024 * 1024;
    let mut held: Vec<u8> = Vec::new();

    loop {
        if held.try_reserve(CHUNK_BYTES).is_err() {
            let reached = held.len();
            drop(held);
            respond(
                writer,
                &ScriptResponse::failure(
                    request.request_id,
                    request.generation,
                    format!("allocation limit reached after {reached} bytes"),
                ),
            );
            return;
        }
        held.resize(held.len() + CHUNK_BYTES, 0);
    }
}
