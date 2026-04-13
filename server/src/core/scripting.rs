//! JavaScript scripting engine for dynamic scene expressions and routine rules
//!
//! This module provides a JavaScript runtime (using boa_engine) that replaces
//! the previous evalexpr-based expression evaluation. It exposes device, group,
//! and scene state to scripts for dynamic automation logic.

use boa_engine::{Context, Source};
use color_eyre::Result;
use std::collections::HashMap;

use crate::types::{device::DevicesState, group::FlattenedGroupsConfig};

const SCENE_SCRIPT_HELPERS: &str = r#"
var defineSceneScript = function (factory) { return factory(); };
var deviceState = function (config) { return config; };
var deviceLink = function (config) { return config; };
var sceneLink = function (config) { return config; };
"#;

/// JavaScript scripting context for evaluating dynamic expressions
pub struct ScriptEngine {
    context: Context,
}

impl Default for ScriptEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ScriptEngine {
    /// Create a new script engine instance
    pub fn new() -> Self {
        let mut context = Context::default();
        let _ = context.eval(Source::from_bytes(SCENE_SCRIPT_HELPERS));
        ScriptEngine { context }
    }

    /// Update the script context with current device states as JSON
    pub fn update_devices(&mut self, devices: &DevicesState) {
        // Convert devices to JSON and parse it into JS
        let devices_json = serde_json::to_string(&devices.0).unwrap_or_else(|_| "{}".to_string());
        let script = format!("var devices = {};", devices_json);
        let _ = self.context.eval(Source::from_bytes(&script));
    }

    /// Update the script context with current group states as JSON
    pub fn update_groups(&mut self, groups: &FlattenedGroupsConfig, devices: &DevicesState) {
        // Build a simplified group state object
        let mut groups_map: HashMap<String, serde_json::Value> = HashMap::new();

        for (group_id, group) in &groups.0 {
            let all_powered = group.device_keys.iter().all(|key| {
                devices
                    .0
                    .get(key)
                    .and_then(|d| d.is_powered_on())
                    .unwrap_or(false)
            });

            let first_scene = group
                .device_keys
                .first()
                .and_then(|key| devices.0.get(key))
                .and_then(|d| d.get_scene_id());

            let common_scene = if group
                .device_keys
                .iter()
                .all(|key| devices.0.get(key).and_then(|d| d.get_scene_id()) == first_scene)
            {
                first_scene.map(|s| s.to_string())
            } else {
                None
            };

            groups_map.insert(
                group_id.to_string(),
                serde_json::json!({
                    "name": group.name,
                    "power": all_powered,
                    "scene_id": common_scene
                }),
            );
        }

        let groups_json = serde_json::to_string(&groups_map).unwrap_or_else(|_| "{}".to_string());
        let script = format!("var groups = {};", groups_json);
        let _ = self.context.eval(Source::from_bytes(&script));
    }

    /// Evaluate a JavaScript expression and return the result as a boolean
    pub fn eval_boolean(&mut self, script: &str) -> Result<bool> {
        let result = self
            .context
            .eval(Source::from_bytes(script))
            .map_err(|e| eyre::eyre!("JS evaluation error: {}", e))?;

        Ok(result.to_boolean())
    }

    /// Evaluate a JavaScript expression and return the result as a JSON value
    pub fn eval_json(&mut self, script: &str) -> Result<serde_json::Value> {
        // Wrap the script to convert result to JSON string
        let wrapped = format!("JSON.stringify({})", script);
        let result = self
            .context
            .eval(Source::from_bytes(&wrapped))
            .map_err(|e| eyre::eyre!("JS evaluation error: {}", e))?;

        // Extract the JSON string from the result
        let json_str = result
            .as_string()
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_else(|| "null".to_string());

        let value: serde_json::Value = serde_json::from_str(&json_str)?;
        Ok(value)
    }

    /// Evaluate a scene script that returns device state configuration
    pub fn eval_scene_script(
        &mut self,
        script: &str,
        devices: &DevicesState,
        groups: &FlattenedGroupsConfig,
    ) -> Result<HashMap<String, serde_json::Value>> {
        // Update context with current state
        self.update_devices(devices);
        self.update_groups(groups, devices);

        // Evaluate the script
        let result = self.eval_json(script)?;

        // Parse the result as a map of device configs
        match result {
            serde_json::Value::Object(map) => Ok(map.into_iter().collect()),
            _ => Ok(HashMap::new()),
        }
    }

    /// Evaluate a routine rule script that returns a boolean
    pub fn eval_rule_script(
        &mut self,
        script: &str,
        devices: &DevicesState,
        groups: &FlattenedGroupsConfig,
    ) -> Result<bool> {
        // Update context with current state
        self.update_devices(devices);
        self.update_groups(groups, devices);

        // Evaluate the script
        self.eval_boolean(script)
    }

    /// Register a global variable in the script context
    pub fn register_global(&mut self, name: &str, value: serde_json::Value) {
        let json_str = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
        let script = format!("var {} = {};", name, json_str);
        let _ = self.context.eval(Source::from_bytes(&script));
    }
}

/// Helper to create a script engine with the current state loaded
pub fn create_script_engine_with_state(
    devices: &DevicesState,
    groups: &FlattenedGroupsConfig,
) -> ScriptEngine {
    let mut engine = ScriptEngine::new();
    engine.update_devices(devices);
    engine.update_groups(groups, devices);
    engine
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eval_boolean() {
        let mut engine = ScriptEngine::new();

        assert!(engine.eval_boolean("true").unwrap());
        assert!(!engine.eval_boolean("false").unwrap());
        assert!(engine.eval_boolean("1 + 1 === 2").unwrap());
        assert!(!engine.eval_boolean("1 + 1 === 3").unwrap());
    }

    #[test]
    fn test_eval_json() {
        let mut engine = ScriptEngine::new();

        let result = engine.eval_json("({ foo: 'bar', num: 42 })").unwrap();
        assert_eq!(result["foo"], "bar");
        assert_eq!(result["num"], 42);
    }

    #[test]
    fn test_scene_script_helpers() {
        let mut engine = ScriptEngine::new();

        let result = engine
            .eval_json(
                "defineSceneScript(() => ({ 'demo/device': deviceState({ power: true, brightness: 0.5 }) }))",
            )
            .unwrap();

        assert_eq!(result["demo/device"]["power"], true);
        assert_eq!(result["demo/device"]["brightness"], serde_json::json!(0.5));
    }

    #[test]
    fn test_global_var_access() {
        let mut engine = ScriptEngine::new();

        // Register a test variable using JSON
        engine.register_global("testValue", serde_json::json!(42));

        assert!(engine.eval_boolean("testValue === 42").unwrap());
        assert!(engine.eval_boolean("testValue > 40").unwrap());
    }

    #[test]
    fn test_register_complex_global() {
        let mut engine = ScriptEngine::new();

        engine.register_global(
            "config",
            serde_json::json!({
                "threshold": 50,
                "enabled": true,
                "zones": ["living", "bedroom"]
            }),
        );

        assert!(engine.eval_boolean("config.enabled").unwrap());
        assert!(engine.eval_boolean("config.threshold === 50").unwrap());
        assert!(engine
            .eval_boolean("config.zones.includes('living')")
            .unwrap());
    }
}
