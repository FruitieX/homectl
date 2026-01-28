//! Integration tests for the JavaScript scripting engine.
//!
//! These tests verify that:
//! - ScriptEngine correctly evaluates boolean expressions
//! - Device and group state is correctly exposed to scripts
//! - Script rules work within routine evaluation

use homectl_server::core::scripting::ScriptEngine;

#[test]
fn test_simple_boolean_evaluation() {
    let mut engine = ScriptEngine::new();

    // Test basic boolean values
    assert!(engine.eval_boolean("true").unwrap());
    assert!(!engine.eval_boolean("false").unwrap());

    // Test comparison operators
    assert!(engine.eval_boolean("1 + 1 === 2").unwrap());
    assert!(!engine.eval_boolean("1 + 1 === 3").unwrap());
    assert!(engine.eval_boolean("5 > 3").unwrap());
    assert!(engine.eval_boolean("3 >= 3").unwrap());
    assert!(engine.eval_boolean("2 < 5").unwrap());

    // Test logical operators
    assert!(engine.eval_boolean("true && true").unwrap());
    assert!(!engine.eval_boolean("true && false").unwrap());
    assert!(engine.eval_boolean("true || false").unwrap());
    assert!(!engine.eval_boolean("!true").unwrap());
}

#[test]
fn test_string_comparison() {
    let mut engine = ScriptEngine::new();

    assert!(engine.eval_boolean("'hello' === 'hello'").unwrap());
    assert!(!engine.eval_boolean("'hello' === 'world'").unwrap());
    assert!(engine.eval_boolean("'abc' < 'abd'").unwrap());
}

#[test]
fn test_complex_expressions() {
    let mut engine = ScriptEngine::new();

    // Test ternary operator
    assert!(engine.eval_boolean("true ? true : false").unwrap());
    assert!(!engine.eval_boolean("false ? true : false").unwrap());

    // Test array methods
    assert!(engine.eval_boolean("[1, 2, 3].includes(2)").unwrap());
    assert!(!engine.eval_boolean("[1, 2, 3].includes(5)").unwrap());
    assert!(engine.eval_boolean("[1, 2, 3].length === 3").unwrap());

    // Test object access
    assert!(engine.eval_boolean("({ a: 1, b: 2 }).a === 1").unwrap());
}

#[test]
fn test_json_evaluation() {
    let mut engine = ScriptEngine::new();

    let result = engine
        .eval_json("({ power: true, brightness: 0.5 })")
        .unwrap();
    assert_eq!(result["power"], true);
    assert_eq!(result["brightness"], 0.5);

    let result = engine
        .eval_json("({ scenes: ['dark', 'bright', 'off'] })")
        .unwrap();
    assert_eq!(result["scenes"].as_array().unwrap().len(), 3);
}

// Note: Tests for device/group context would require creating mock DevicesState
// and FlattenedGroupsConfig, which is more complex. Those are covered in the
// scripting.rs unit tests.
