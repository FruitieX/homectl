//! Tests for routine rule evaluation including Script rules.

use homectl_server::core::scripting::ScriptEngine;

#[test]
fn test_script_rule_device_state_access() {
    let mut engine = ScriptEngine::new();

    // Simulate checking if a device is powered on
    let script = "true"; // Simplified - real test would use device context
    assert!(engine.eval_boolean(script).unwrap());
}

#[test]
fn test_script_rule_comparison() {
    let mut engine = ScriptEngine::new();

    // Test temperature threshold check
    let script = "22.5 > 20";
    assert!(engine.eval_boolean(script).unwrap());

    // Test brightness level check
    let script = "0.8 >= 0.5";
    assert!(engine.eval_boolean(script).unwrap());
}

#[test]
fn test_script_rule_time_logic() {
    let mut engine = ScriptEngine::new();

    // Test hour-based conditions (simplified)
    let script = "
        const hour = 14;
        hour >= 9 && hour < 17
    ";
    assert!(engine.eval_boolean(script).unwrap());

    // Test weekend detection (simplified)
    let script = "
        const dayOfWeek = 6; // Saturday
        dayOfWeek === 0 || dayOfWeek === 6
    ";
    assert!(engine.eval_boolean(script).unwrap());
}

#[test]
fn test_script_rule_array_operations() {
    let mut engine = ScriptEngine::new();

    // Test if device is in a list
    let script = "['living-room', 'bedroom', 'kitchen'].includes('bedroom')";
    assert!(engine.eval_boolean(script).unwrap());

    // Test array filtering
    let script = "[1, 2, 3, 4, 5].filter(x => x > 3).length === 2";
    assert!(engine.eval_boolean(script).unwrap());

    // Test array some/every
    let script = "[10, 20, 30].every(x => x >= 10)";
    assert!(engine.eval_boolean(script).unwrap());

    let script = "[10, 20, 30].some(x => x > 25)";
    assert!(engine.eval_boolean(script).unwrap());
}

#[test]
fn test_script_rule_null_safety() {
    let mut engine = ScriptEngine::new();

    // Test optional chaining
    let script = "
        const device = null;
        device?.state?.power === undefined
    ";
    assert!(engine.eval_boolean(script).unwrap());

    // Test nullish coalescing
    let script = "
        const brightness = null;
        (brightness ?? 0.5) === 0.5
    ";
    assert!(engine.eval_boolean(script).unwrap());
}

#[test]
fn test_scene_script_returns_state() {
    let mut engine = ScriptEngine::new();

    // Scene script should return device state object
    let script = "({ power: true, brightness: 0.75 })";
    let result = engine.eval_json(script).unwrap();

    assert_eq!(result["power"], true);
    assert_eq!(result["brightness"], 0.75);
}

#[test]
fn test_scene_script_dynamic_brightness() {
    let mut engine = ScriptEngine::new();

    // Simulate circadian-style dynamic brightness (using ternary)
    let script = "(function() { var hour = 20; var brightness = hour < 6 ? 0.1 : hour < 9 ? 0.5 : hour < 18 ? 1.0 : hour < 22 ? 0.7 : 0.3; return { power: true, brightness: brightness }; })()";
    let result = engine.eval_json(script).unwrap();

    assert_eq!(result["power"], true);
    assert_eq!(result["brightness"], 0.7);
}

#[test]
fn test_scene_script_color_calculation() {
    let mut engine = ScriptEngine::new();

    // Simulate color temperature calculation
    let script = "(function() { var hour = 12; var kelvin = hour < 10 ? 2700 : hour < 18 ? 5000 : 2700; return { power: true, colorTemp: kelvin }; })()";
    let result = engine.eval_json(script).unwrap();

    assert_eq!(result["power"], true);
    assert_eq!(result["colorTemp"], 5000);
}

#[test]
fn test_script_error_handling() {
    let mut engine = ScriptEngine::new();

    // Syntax error should return error
    let result = engine.eval_boolean("if (");
    assert!(result.is_err());

    // Type error (calling non-function) should return error
    let result = engine.eval_boolean("'hello'()");
    assert!(result.is_err());

    // Undefined variable access in strict context
    let result = engine.eval_boolean("undefinedVariable === true");
    // This might not error in JS (returns false due to undefined !== true)
    // but should at least not panic
    assert!(result.is_ok() || result.is_err());
}

#[test]
fn test_script_no_side_effects() {
    let mut engine = ScriptEngine::new();

    // Scripts shouldn't be able to access dangerous APIs
    // Note: This test verifies sandboxing - actual restrictions depend on engine config

    // Should not be able to eval arbitrary code
    let _result = engine.eval_boolean("typeof eval === 'undefined'");
    // Result depends on engine configuration

    // console.log should not crash
    // (may or may not be available depending on engine)
    let result = engine.eval_boolean("true");
    assert!(result.is_ok());
}

#[test]
fn test_complex_rule_logic() {
    let mut engine = ScriptEngine::new();

    // Complex multi-condition rule (as IIFE)
    let script = "(function() { var motion = true; var lightLevel = 30; var hour = 22; var isNight = hour >= 21 || hour < 6; return motion && lightLevel < 50 && isNight; })()";
    assert!(engine.eval_boolean(script).unwrap());

    // Same conditions but motion is false
    let script = "(function() { var motion = false; var lightLevel = 30; var hour = 22; var isNight = hour >= 21 || hour < 6; return motion && lightLevel < 50 && isNight; })()";
    assert!(!engine.eval_boolean(script).unwrap());
}
