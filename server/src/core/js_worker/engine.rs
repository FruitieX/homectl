//! Pinned Boa adapter executed *inside* the worker process.
//!
//! Every invocation builds a fresh [`Context`] (fresh realm), so globals and
//! prototype mutations from one script cannot affect the next. The worker
//! never shares a context with the server process: the state actor only ever
//! talks to the supervisor over the framed protocol.
//!
//! Boa 0.20 is the pinned engine. Runtime limits mirror the legacy
//! in-process engine (10k loop iterations, recursion depth 64, 4 KiB stack)
//! and remain the in-engine guardrail; the supervisor's process timeout and
//! kernel rlimits are the outer bounds.

use boa_engine::{Context, Source};

use super::protocol::{MAX_CONTEXT_BYTES, MAX_RESULT_BYTES, MAX_SCRIPT_BYTES};
use crate::core::scripting::SCENE_SCRIPT_HELPERS;

/// In-engine loop iteration limit. Boa 0.22 counts `String.prototype.repeat`
/// and other intrinsics toward this budget, so it must comfortably exceed
/// [`MAX_RESULT_BYTES`] for a legitimate script to be able to build a
/// maximum-size result; the supervisor's invocation timeout remains the
/// primary guard against runaway scripts.
pub const LOOP_ITERATION_LIMIT: u64 = 4 * 1024 * 1024;
/// In-engine recursion limit (legacy limit, kept until compatibility review).
pub const RECURSION_LIMIT: usize = 64;
/// In-engine VM stack size limit (legacy limit, kept until compatibility review).
pub const STACK_SIZE_LIMIT: usize = 4096;

/// Fixed, versioned script ABI asset: deterministic time/randomness, immutable
/// `ctx`, three-valued helpers, and pure action/timer builders. It performs no
/// I/O and is injected into every fresh invocation realm.
const SCRIPT_PRELUDE: &str = include_str!("../automation/script_prelude.js");

fn fresh_context() -> Context {
    let mut context = Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(LOOP_ITERATION_LIMIT);
    context
        .runtime_limits_mut()
        .set_recursion_limit(RECURSION_LIMIT);
    context
        .runtime_limits_mut()
        .set_stack_size_limit(STACK_SIZE_LIMIT);
    context
}

/// The v2 ABI unit: a function body with an unambiguous `return`.
fn body_wrapper(script: &str) -> String {
    format!("(function __homectl_v2_body() {{\n{script}\n}})")
}

/// Evaluate the body and strictly serialize its return value to JSON.
///
/// Strictness means: `undefined`, functions, symbols, `BigInt`, non-finite
/// numbers, cyclic structures, and oversize results are errors, not silently
/// coerced values.
fn strict_evaluation_source(script: &str) -> String {
    format!(
        "(function () {{\n\
         var __homectl_value = (function __homectl_v2_body() {{\n{script}\n}})();\n\
         if (__homectl_value === undefined) {{\n\
         throw new Error(\"homectl script returned undefined\");\n\
         }}\n\
         var __homectl_json = JSON.stringify(__homectl_value, function (__homectl_key, __homectl_replacer_value) {{\n\
         if (typeof __homectl_replacer_value === \"number\" && !Number.isFinite(__homectl_replacer_value)) {{\n\
         throw new Error(\"homectl script result contains a non-finite number\");\n\
         }}\n\
         return __homectl_replacer_value;\n\
         }});\n\
         if (typeof __homectl_json !== \"string\") {{\n\
         throw new Error(\"homectl script result is not JSON-serializable\");\n\
         }}\n\
         return __homectl_json;\n\
         }})()"
    )
}

fn check_script_size(script: &str) -> Result<(), String> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err(format!("script exceeds the {MAX_SCRIPT_BYTES} byte limit"));
    }
    Ok(())
}

/// Parse a v2 function body without executing it.
pub fn validate_script(script: &str) -> Result<(), String> {
    check_script_size(script)?;
    let wrapped = body_wrapper(script);
    crate::core::routine_validation::parse_script(&wrapped)
}

/// Execute a v2 function body against a fresh realm with `ctx` injected.
pub fn execute_script(
    script: &str,
    context: &serde_json::Value,
    max_result_bytes: usize,
) -> Result<serde_json::Value, String> {
    check_script_size(script)?;

    let context_json = serde_json::to_string(context)
        .map_err(|error| format!("invocation context is not JSON-serializable: {error}"))?;
    if context_json.len() > MAX_CONTEXT_BYTES {
        return Err(format!(
            "invocation context exceeds the {MAX_CONTEXT_BYTES} byte limit"
        ));
    }

    let mut context = fresh_context();
    context
        .eval(Source::from_bytes(&format!("var ctx = {context_json};")))
        .map_err(|error| format!("failed to inject invocation context: {error}"))?;
    context
        .eval(Source::from_bytes(SCRIPT_PRELUDE))
        .map_err(|error| format!("failed to install the script ABI prelude: {error}"))?;

    let value = context
        .eval(Source::from_bytes(&strict_evaluation_source(script)))
        .map_err(|error| format!("script error: {error}"))?;

    let Some(json) = value.as_string() else {
        return Err("script result is not a JSON string after strict serialization".to_string());
    };
    if json.len() > max_result_bytes {
        return Err(format!(
            "script result exceeds the {max_result_bytes} byte limit"
        ));
    }
    let json = json.to_std_string_escaped();
    if json.len() > max_result_bytes {
        return Err(format!(
            "script result exceeds the {max_result_bytes} byte limit"
        ));
    }

    serde_json::from_str(&json).map_err(|error| format!("script result is not valid JSON: {error}"))
}

/// Execute a legacy (v1) rule expression off-actor.
///
/// This is a compatibility format, not a second user-facing runtime: the
/// worker reconstructs the old `devices` and `groups` globals, evaluates the
/// raw expression for its completion value, and coerces it with JavaScript
/// `ToBoolean` exactly like the retired in-process `eval_boolean` (Section
/// 6.4). The result is always a JSON boolean.
pub fn execute_legacy_rule_script(
    script: &str,
    context: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut realm = legacy_realm(script, context)?;

    let value = realm
        .eval(Source::from_bytes(script))
        .map_err(|error| format!("script error: {error}"))?;

    Ok(serde_json::Value::Bool(value.to_boolean()))
}

/// Execute a legacy (v1) scene expression off-actor.
///
/// Same compatibility realm and helper prelude as
/// [`execute_legacy_rule_script`], but the raw JSON completion value instead of
/// boolean truthiness, mirroring the retired in-process `eval_json`
/// (`JSON.stringify` wrapping with a `null` completion fallback). The server
/// keeps applying the legacy per-entry parsing and skip-on-invalid semantics,
/// so the strict v2 scene-materializer contract is never applied to v1 scripts.
pub fn execute_legacy_scene_script(
    script: &str,
    context: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut realm = legacy_realm(script, context)?;

    let wrapped = format!("JSON.stringify({script})");
    let value = realm
        .eval(Source::from_bytes(&wrapped))
        .map_err(|error| format!("script error: {error}"))?;

    let json = value
        .as_string()
        .map(|value| value.to_std_string_escaped())
        .unwrap_or_else(|| "null".to_string());
    if json.len() > MAX_RESULT_BYTES {
        return Err(format!(
            "script result exceeds the {MAX_RESULT_BYTES} byte limit"
        ));
    }

    serde_json::from_str(&json).map_err(|error| format!("script result is not valid JSON: {error}"))
}

/// Build the shared legacy compatibility realm: fresh context, the scene
/// script helper prelude, and the injected `devices`/`groups` globals.
fn legacy_realm(script: &str, context: &serde_json::Value) -> Result<Context, String> {
    check_script_size(script)?;

    let empty = serde_json::Value::Object(serde_json::Map::new());
    let devices = context.get("devices").unwrap_or(&empty);
    let groups = context.get("groups").unwrap_or(&empty);
    let devices_json = serde_json::to_string(devices)
        .map_err(|error| format!("legacy devices are not JSON-serializable: {error}"))?;
    let groups_json = serde_json::to_string(groups)
        .map_err(|error| format!("legacy groups are not JSON-serializable: {error}"))?;
    let injection = format!("var devices = {devices_json};\nvar groups = {groups_json};");
    if injection.len() > MAX_CONTEXT_BYTES {
        return Err(format!(
            "legacy invocation context exceeds the {MAX_CONTEXT_BYTES} byte limit"
        ));
    }

    let mut realm = fresh_context();
    realm
        .eval(Source::from_bytes(SCENE_SCRIPT_HELPERS))
        .map_err(|error| format!("failed to install legacy script helpers: {error}"))?;
    realm
        .eval(Source::from_bytes(&injection))
        .map_err(|error| format!("failed to inject legacy script context: {error}"))?;
    Ok(realm)
}

/// Result cap used by the worker for script output.
pub const MAX_SCRIPT_RESULT_BYTES: usize = MAX_RESULT_BYTES;

#[cfg(test)]
mod tests {
    use super::*;

    fn run(script: &str) -> Result<serde_json::Value, String> {
        execute_script(script, &serde_json::Value::Null, MAX_SCRIPT_RESULT_BYTES)
    }

    #[test]
    fn executes_function_bodies_and_serializes_results() {
        assert_eq!(run("return 1 + 1;").unwrap(), serde_json::json!(2));
        assert_eq!(
            run("return { power: true, brightness: 0.5 };").unwrap(),
            serde_json::json!({"power": true, "brightness": 0.5})
        );
        assert_eq!(
            run("return [1, 'two', null];").unwrap(),
            serde_json::json!([1, "two", null])
        );
        assert_eq!(run("return null;").unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn exposes_immutable_context_as_ctx() {
        let context = serde_json::json!({"event": {"kind": "report"}, "n": 3});
        let value = execute_script(
            "return { kind: ctx.event.kind, n: ctx.n + 1 };",
            &context,
            MAX_SCRIPT_RESULT_BYTES,
        )
        .unwrap();
        assert_eq!(value, serde_json::json!({"kind": "report", "n": 4}));
    }

    #[test]
    fn rejects_non_json_results() {
        assert!(run("return;").is_err());
        assert!(run("return undefined;").is_err());
        assert!(run("return function () {};").is_err());
        assert!(run("return 1 / 0;").is_err());
        assert!(run("return 0 / 0;").is_err());
        assert!(run("return 1n;").is_err());
        let cyclic = "var a = {}; a.self = a; return a;";
        assert!(run(cyclic).is_err());
        assert!(run("return Symbol('x');").is_err());
    }

    #[test]
    fn rejects_syntax_and_runtime_errors() {
        assert!(run("return (;").is_err());
        assert!(run("throw new Error('boom');").is_err());

        let message = run("throw new Error('boom');").unwrap_err();
        assert!(message.contains("boom"), "unexpected message: {message}");
    }

    #[test]
    fn terminates_runaway_loops_and_recursion() {
        let message = run("while (true) {}").unwrap_err();
        assert!(
            message.contains("iteration") || message.contains("loop"),
            "unexpected message: {message}"
        );

        let message =
            run("function recurse() { return recurse(); } return recurse();").unwrap_err();
        assert!(!message.is_empty());
    }

    #[test]
    fn enforces_result_size_cap() {
        let message = run("return 'x'.repeat(2 * 1024 * 1024);").unwrap_err();
        assert!(message.contains("limit"), "unexpected message: {message}");
    }

    #[test]
    fn fresh_realm_prevents_global_and_prototype_leaks() {
        run("globalThis.__homectl_leak = 42; Object.prototype.__homectl_polluted = 'x'; return true;")
            .unwrap();

        let value = run(
            "return { leak: typeof globalThis.__homectl_leak, polluted: typeof ({}).__homectl_polluted };",
        )
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"leak": "undefined", "polluted": "undefined"})
        );
    }

    #[test]
    fn validation_never_executes() {
        validate_script("return 1;").unwrap();
        validate_script("while (true) {}").unwrap();
        assert!(validate_script("return (;").is_err());
    }

    fn run_legacy(script: &str) -> Result<serde_json::Value, String> {
        execute_legacy_rule_script(
            script,
            &serde_json::json!({
                "devices": {
                    "dummy/lamp": { "state": { "Controllable": { "power": true } } }
                },
                "groups": {
                    "room": { "name": "Room", "power": true, "scene_id": "night" }
                }
            }),
        )
    }

    // B04/Section 6.4: v1 semantics are raw completion + ToBoolean, not the v2
    // function-body ABI.
    #[test]
    fn legacy_rule_scripts_keep_truthiness_and_globals() {
        assert_eq!(run_legacy("true").unwrap(), serde_json::json!(true));
        assert_eq!(run_legacy("false").unwrap(), serde_json::json!(false));
        assert_eq!(run_legacy("1 + 1 === 2").unwrap(), serde_json::json!(true));
        assert_eq!(run_legacy("''").unwrap(), serde_json::json!(false));
        assert_eq!(run_legacy("'0'").unwrap(), serde_json::json!(true));
        assert_eq!(run_legacy("0").unwrap(), serde_json::json!(false));
        assert_eq!(run_legacy("[]").unwrap(), serde_json::json!(true));
        assert_eq!(
            run_legacy("({}).missing").unwrap(),
            serde_json::json!(false)
        );
        assert_eq!(
            run_legacy("groups['room'].scene_id === 'night'").unwrap(),
            serde_json::json!(true)
        );
        assert_eq!(
            run_legacy("devices['dummy/lamp'] !== undefined").unwrap(),
            serde_json::json!(true)
        );
    }

    #[test]
    fn legacy_rule_scripts_reject_errors_and_runaway_loops() {
        assert!(run_legacy("throw new Error('boom')").is_err());
        assert!(run_legacy("while (true) {}").is_err());
        // The v2 body ABI must not be accepted: `return` is a syntax error in
        // the legacy raw-expression format.
        assert!(run_legacy("return true;").is_err());
    }

    fn run_legacy_scene(script: &str) -> Result<serde_json::Value, String> {
        execute_legacy_scene_script(
            script,
            &serde_json::json!({
                "devices": {
                    "dummy/lamp": { "state": { "Controllable": { "power": true } } }
                },
                "groups": {
                    "room": { "name": "Room", "power": true, "scene_id": "night" }
                }
            }),
        )
    }

    // P08/Section 6.4: v1 scene expressions keep the legacy raw-JSON output
    // (helpers, globals, JSON.stringify completion), not v2 strictness and not
    // rule truthiness.
    #[test]
    fn legacy_scene_scripts_return_raw_json_with_helpers_and_globals() {
        let value = run_legacy_scene(
            "defineSceneScript(function () { return { \
             'dummy/lamp': deviceState({ power: devices['dummy/lamp'] !== undefined }), \
             'dummy/room': deviceLink({ device_ref: { integration_id: 'dummy', device_id: 'lamp' } }) }; })",
        )
        .unwrap();
        assert_eq!(value["dummy/lamp"]["power"], serde_json::json!(true));
        assert_eq!(value["dummy/room"]["device_ref"]["device_id"], "lamp");

        // Raw JSON completion, exactly like the legacy `eval_json`: the
        // server-side merge treats non-objects as an empty device map.
        assert_eq!(run_legacy_scene("42").unwrap(), serde_json::json!(42));
        assert_eq!(
            run_legacy_scene("groups['room'].scene_id").unwrap(),
            serde_json::json!("night")
        );
    }

    #[test]
    fn legacy_scene_scripts_reject_errors_and_v2_body_syntax() {
        assert!(run_legacy_scene("throw new Error('boom')").is_err());
        assert!(run_legacy_scene("return {};").is_err());
    }
}
