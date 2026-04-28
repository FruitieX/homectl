pub mod actor;
pub mod command;

pub use actor::IntegrationHandle;

use crate::db::config_queries;
use crate::integrations::cron::Cron;
use crate::integrations::{
    circadian::Circadian, dummy::Dummy, mqtt::Mqtt, random::Random, timer::Timer,
};
use crate::types::{
    device::Device,
    event::TxEventChannel,
    integration::{
        Integration, IntegrationActionPayload, IntegrationConfigFieldKind,
        IntegrationConfigFieldOption, IntegrationConfigFieldSchema, IntegrationConfigSchema,
        IntegrationId, OutboundDeviceUpdatePolicy,
    },
};
use crate::utils::cli::Cli;
use color_eyre::Result;
use eyre::eyre;
use serde_json::json;
use std::collections::HashMap;

pub type CustomIntegrationsMap = HashMap<IntegrationId, IntegrationHandle>;

const BUILT_IN_PLUGIN_NAMES: [&str; 6] = ["mqtt", "circadian", "cron", "timer", "dummy", "random"];

#[derive(Clone)]
pub struct Integrations {
    custom_integrations: CustomIntegrationsMap,
    event_tx: TxEventChannel,
    cli: Cli,
}

impl Integrations {
    pub fn new(event_tx: TxEventChannel, cli: &Cli) -> Self {
        Integrations {
            custom_integrations: Default::default(),
            event_tx,
            cli: cli.clone(),
        }
    }

    pub async fn load_integration(
        &mut self,
        module_name: &str,
        integration_id: &IntegrationId,
        config: &serde_json::Value,
        cli: &Cli,
    ) -> Result<()> {
        info!("loading integration with module_name {module_name}");

        let event_tx = self.event_tx.clone();
        let integration =
            load_custom_integration(module_name, integration_id, config, cli, event_tx)?;
        let device_update_policy = OutboundDeviceUpdatePolicy::from_config(config)?;

        let handle = IntegrationHandle::new(
            integration,
            integration_id.clone(),
            module_name.to_string(),
            config.clone(),
            device_update_policy,
        );

        self.custom_integrations
            .insert(integration_id.clone(), handle);

        Ok(())
    }

    pub async fn run_register_pass(&self) -> Result<()> {
        for (integration_id, handle) in self.custom_integrations.iter() {
            handle.register().await?;
            info!(
                "registered {} integration {}",
                handle.module_name, integration_id
            );
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<()> {
        for (integration_id, handle) in self.custom_integrations.iter() {
            handle.start().await?;
            info!(
                "started {} integration {}",
                handle.module_name, integration_id
            );
        }

        Ok(())
    }

    pub async fn set_integration_device_state(&self, device: Device) -> Result<()> {
        if device.is_readonly() {
            debug!(
                "Skipping ReadOnly device {integration_id}/{name} state update: {state}",
                integration_id = device.integration_id,
                name = device.name,
                state = device
                    .get_controllable_state()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            );
            return Ok(());
        }

        let handle = self
            .custom_integrations
            .get(&device.integration_id)
            .ok_or_else(|| {
                eyre!(
                    "Expected to find integration by id {}",
                    device.integration_id
                )
            })?;

        handle.set_device_state(device);
        Ok(())
    }

    pub async fn run_integration_action(
        &self,
        integration_id: &IntegrationId,
        payload: &IntegrationActionPayload,
    ) -> Result<()> {
        let handle = self
            .custom_integrations
            .get(integration_id)
            .ok_or_else(|| eyre!("Expected to find integration by id {integration_id}"))?;

        handle.run_action(payload.clone());
        Ok(())
    }

    pub async fn load_config_rows(
        &mut self,
        integrations: &[config_queries::IntegrationRow],
    ) -> Result<()> {
        for row in integrations {
            if !row.enabled {
                continue;
            }

            let integration_id = IntegrationId::from(row.id.clone());

            if self.custom_integrations.contains_key(&integration_id) {
                debug!("Integration {} already loaded, skipping", integration_id);
                continue;
            }

            match self
                .load_integration(&row.plugin, &integration_id, &row.config, &self.cli.clone())
                .await
            {
                Ok(()) => {
                    info!(
                        "Loaded integration {} (plugin: {}) from config rows",
                        integration_id, row.plugin
                    );
                }
                Err(e) => {
                    error!(
                        "Failed to load integration {} from config rows: {e}",
                        integration_id
                    );
                }
            }
        }

        Ok(())
    }

    /// Load integrations from the database.
    pub async fn load_db_integrations(&mut self) -> Result<()> {
        let db_integrations = config_queries::db_get_integrations().await?;
        self.load_config_rows(&db_integrations).await
    }

    /// Full diff-based reload from config rows: add new, remove deleted, restart modified.
    /// Returns the IDs of integrations that were removed.
    pub async fn reload_config_rows(
        &mut self,
        integrations: &[config_queries::IntegrationRow],
    ) -> Result<Vec<IntegrationId>> {
        let mut removed_ids = Vec::new();

        let desired: HashMap<IntegrationId, _> = integrations
            .iter()
            .filter(|row| row.enabled)
            .cloned()
            .map(|row| (IntegrationId::from(row.id.clone()), row))
            .collect();

        let current_ids: Vec<IntegrationId> = self.custom_integrations.keys().cloned().collect();
        for id in &current_ids {
            if !desired.contains_key(id) {
                if let Some(handle) = self.custom_integrations.remove(id) {
                    info!("Stopping removed integration {}", id);
                    if let Err(e) = handle.stop().await {
                        warn!("Error stopping integration {}: {e}", id);
                    }
                    removed_ids.push(id.clone());
                    // Dropping the handle here closes this clone's
                    // sender; the actor task exits once the last
                    // sender (held by the state actor's copy of the
                    // map) is also dropped after commit.
                    drop(handle);
                }
            }
        }

        for (id, row) in &desired {
            if let Some(existing) = self.custom_integrations.get(id) {
                if existing.module_name != row.plugin || existing.config != row.config {
                    info!("Restarting modified integration {}", id);
                    if let Some(handle) = self.custom_integrations.remove(id) {
                        if let Err(e) = handle.stop().await {
                            warn!("Error stopping integration {}: {e}", id);
                        }
                        drop(handle);
                    }

                    match self
                        .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                        .await
                    {
                        Ok(()) => {
                            if let Some(handle) = self.custom_integrations.get(id) {
                                let _ = handle.register().await;
                                let _ = handle.start().await;
                            }
                            info!("Restarted integration {} (plugin: {})", id, row.plugin);
                        }
                        Err(e) => {
                            error!("Failed to restart integration {}: {e}", id);
                        }
                    }
                }
            } else {
                match self
                    .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                    .await
                {
                    Ok(()) => {
                        if let Some(handle) = self.custom_integrations.get(id) {
                            let _ = handle.register().await;
                            let _ = handle.start().await;
                        }
                        info!("Added integration {} (plugin: {})", id, row.plugin);
                    }
                    Err(e) => {
                        error!("Failed to add integration {}: {e}", id);
                    }
                }
            }
        }

        Ok(removed_ids)
    }

    /// Full diff-based reload: add new, remove deleted, restart modified integrations.
    /// Returns the IDs of integrations that were removed.
    pub async fn reload_integrations(&mut self) -> Result<Vec<IntegrationId>> {
        let db_integrations = config_queries::db_get_integrations().await?;
        self.reload_config_rows(&db_integrations).await
    }
}

pub fn integration_config_schemas() -> Vec<IntegrationConfigSchema> {
    BUILT_IN_PLUGIN_NAMES
        .iter()
        .filter_map(|plugin| integration_config_schema(plugin))
        .collect()
}

fn integration_config_schema(plugin: &str) -> Option<IntegrationConfigSchema> {
    match plugin {
        "mqtt" => Some(schema(
            "mqtt",
            "MQTT",
            "Connect devices through MQTT topics, including Zigbee2MQTT-style bridges.",
            vec![
                text_config_field(
                    "host",
                    "Host",
                    true,
                    "MQTT broker hostname or IP address.",
                    Some("mqtt.example.org"),
                ),
                number_config_field(
                    "port",
                    "Port",
                    true,
                    "MQTT broker port.",
                    (Some(1.0), Some(65535.0), Some(1.0)),
                    Some("1883"),
                ),
                text_config_field(
                    "username",
                    "Username",
                    false,
                    "Optional MQTT username.",
                    Some("homeassistant"),
                ),
                password_config_field(
                    "password",
                    "Password",
                    false,
                    "Optional MQTT password.",
                    None,
                ),
                text_config_field(
                    "topic",
                    "State topic",
                    true,
                    "Topic to subscribe to for device state messages.",
                    Some("home/+/example/{id}"),
                ),
                text_config_field(
                    "topic_set",
                    "Command topic",
                    true,
                    "Topic used when publishing device state commands.",
                    Some("home/lights/example/{id}/set"),
                ),
                select_config_field(
                    "managed",
                    "Management mode",
                    false,
                    "Controls whether homectl corrects state drift for devices from this integration.",
                    vec![
                        option("Full", json!("Full"), Some("Continuously correct state drift.")),
                        option(
                            "Unmanaged",
                            json!("Unmanaged"),
                            Some("Send commands without correcting later drift."),
                        ),
                        option(
                            "Full read-only",
                            json!("FullReadOnly"),
                            Some("Track state but drop outbound commands."),
                        ),
                        option(
                            "Unmanaged read-only",
                            json!("UnmanagedReadOnly"),
                            Some("Drop outbound commands and do not correct drift."),
                        ),
                    ],
                ),
                text_config_field(
                    "id_field",
                    "ID field",
                    false,
                    "JSON pointer to the device id in incoming payloads.",
                    Some("/id"),
                ),
                text_config_field(
                    "name_field",
                    "Name field",
                    false,
                    "JSON pointer to the device display name in incoming payloads.",
                    Some("/name"),
                ),
                text_config_field(
                    "power_field",
                    "Power field",
                    false,
                    "JSON pointer to the power value in incoming and outgoing payloads.",
                    Some("/power"),
                ),
                json_config_field(
                    "power_on_value",
                    "Power on value",
                    false,
                    "Optional JSON value that represents an on state.",
                    Some(json!(true)),
                ),
                json_config_field(
                    "power_off_value",
                    "Power off value",
                    false,
                    "Optional JSON value that represents an off state.",
                    Some(json!(false)),
                ),
                text_config_field(
                    "color_field",
                    "Color field",
                    false,
                    "JSON pointer to the color value.",
                    Some("/color"),
                ),
                text_config_field(
                    "brightness_field",
                    "Brightness field",
                    false,
                    "JSON pointer to the brightness value.",
                    Some("/brightness"),
                ),
                json_config_field(
                    "brightness_range",
                    "Brightness range",
                    false,
                    "Two-number JSON array describing the source brightness range.",
                    Some(json!([0, 255])),
                ),
                json_config_field(
                    "sensor_value_fields",
                    "Sensor value fields",
                    false,
                    "JSON array of pointers to sensor values in incoming payloads.",
                    Some(json!(["/temperature", "/humidity"])),
                ),
                text_config_field(
                    "transition_field",
                    "Transition field",
                    false,
                    "JSON pointer to transition/fade duration.",
                    Some("/transition"),
                ),
                json_config_field(
                    "transition_range",
                    "Transition range",
                    false,
                    "Two-number JSON array describing the transition duration range.",
                    Some(json!([0, 600])),
                ),
                number_config_field(
                    "default_transition",
                    "Default transition",
                    false,
                    "Default transition duration in seconds when none is provided by homectl.",
                    (Some(0.0), None, Some(0.1)),
                    Some("0.6"),
                ),
                text_config_field(
                    "capabilities_field",
                    "Capabilities field",
                    false,
                    "JSON pointer to advertised device capabilities.",
                    Some("/capabilities"),
                ),
                json_config_field(
                    "capabilities_override",
                    "Capabilities override",
                    false,
                    "Optional capabilities object that overrides discovered capabilities.",
                    Some(json!({ "xy": true, "hs": false, "rgb": false, "ct": { "start": 2000, "end": 6500 } })),
                ),
                text_config_field(
                    "raw_field",
                    "Raw payload field",
                    false,
                    "JSON pointer to store as raw device metadata.",
                    Some("/raw"),
                ),
                boolean_config_field(
                    "include_id_name_in_set_payload",
                    "Include id/name in command payload",
                    false,
                    "Include device id and name fields when publishing command payloads.",
                ),
            ],
        )),
        "circadian" => Some(schema(
            "circadian",
            "Circadian",
            "Expose a virtual color sensor that follows a day/night color schedule.",
            vec![
                text_config_field(
                    "device_name",
                    "Device name",
                    true,
                    "Display name for the virtual circadian color device.",
                    Some("Circadian rhythm"),
                ),
                text_config_field(
                    "day_fade_start",
                    "Day fade start",
                    true,
                    "Local time when the fade toward day color starts, formatted as HH:MM.",
                    Some("06:00"),
                ),
                number_config_field(
                    "day_fade_duration_hours",
                    "Day fade duration",
                    true,
                    "Duration in hours for the fade toward day color.",
                    (Some(0.0), None, Some(0.25)),
                    Some("4"),
                ),
                color_config_field(
                    "day_color",
                    "Day color",
                    true,
                    "Color used after the day fade completes.",
                    Some(json!({ "h": 25, "s": 0.35 })),
                ),
                number_config_field(
                    "day_brightness",
                    "Day brightness",
                    false,
                    "Optional day brightness from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.01)),
                    Some("1.0"),
                ),
                text_config_field(
                    "night_fade_start",
                    "Night fade start",
                    true,
                    "Local time when the fade toward night color starts, formatted as HH:MM.",
                    Some("18:00"),
                ),
                number_config_field(
                    "night_fade_duration_hours",
                    "Night fade duration",
                    true,
                    "Duration in hours for the fade toward night color.",
                    (Some(0.0), None, Some(0.25)),
                    Some("1"),
                ),
                color_config_field(
                    "night_color",
                    "Night color",
                    true,
                    "Color used after the night fade completes.",
                    Some(json!({ "h": 17, "s": 1.0 })),
                ),
                number_config_field(
                    "night_brightness",
                    "Night brightness",
                    false,
                    "Optional night brightness from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.01)),
                    Some("0.8"),
                ),
            ],
        )),
        "cron" => Some(schema(
            "cron",
            "Cron",
            "Expose schedule devices that trigger actions from cron expressions.",
            vec![json_config_field(
                "schedules",
                "Schedules",
                true,
                "JSON object mapping schedule ids to name, cron expression, action, and optional initial enabled state.",
                Some(json!({
                    "bedtime": {
                        "name": "Bedtime",
                        "schedule": "0 22 * * *",
                        "init_enabled": true,
                        "action": { "ActivateScene": { "scene_id": "night" } }
                    }
                })),
            )],
        )),
        "timer" => Some(schema(
            "timer",
            "Timer",
            "Expose a virtual timer sensor that can be started by integration actions.",
            vec![text_config_field(
                "device_name",
                "Device name",
                true,
                "Display name for the virtual timer device.",
                Some("Timer"),
            )],
        )),
        "dummy" => Some(schema(
            "dummy",
            "Dummy",
            "Create in-memory devices for development and testing without physical hardware.",
            vec![json_config_field(
                "devices",
                "Devices",
                true,
                "JSON object mapping device ids to a name and optional initial state.",
                Some(json!({
                    "1": {
                        "name": "Kitchen ceiling light",
                        "init_state": {
                            "Controllable": {
                                "state": { "power": true }
                            }
                        }
                    }
                })),
            )],
        )),
        "random" => Some(schema(
            "random",
            "Random",
            "Expose a virtual color sensor that emits a random color every second.",
            vec![text_config_field(
                "device_name",
                "Device name",
                true,
                "Display name for the virtual random color device.",
                Some("Random colors"),
            )],
        )),
        _ => None,
    }
}

fn schema(
    plugin: &str,
    name: &str,
    description: &str,
    mut fields: Vec<IntegrationConfigFieldSchema>,
) -> IntegrationConfigSchema {
    fields.push(outbound_device_update_field());

    IntegrationConfigSchema {
        plugin: plugin.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        fields,
    }
}

fn base_config_field(
    key: &str,
    label: &str,
    kind: IntegrationConfigFieldKind,
    required: bool,
    description: &str,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        key: key.to_string(),
        label: label.to_string(),
        kind,
        required,
        description: Some(description.to_string()),
        placeholder: None,
        options: Vec::new(),
        default_value: None,
        min: None,
        max: None,
        step: None,
        help_text: None,
    }
}

fn text_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    placeholder: Option<&str>,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        placeholder: placeholder.map(str::to_string),
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Text,
            required,
            description,
        )
    }
}

fn password_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    placeholder: Option<&str>,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        placeholder: placeholder.map(str::to_string),
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Password,
            required,
            description,
        )
    }
}

fn number_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    number_bounds: (Option<f64>, Option<f64>, Option<f64>),
    placeholder: Option<&str>,
) -> IntegrationConfigFieldSchema {
    let (min, max, step) = number_bounds;

    IntegrationConfigFieldSchema {
        min,
        max,
        step,
        placeholder: placeholder.map(str::to_string),
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Number,
            required,
            description,
        )
    }
}

fn boolean_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
) -> IntegrationConfigFieldSchema {
    base_config_field(
        key,
        label,
        IntegrationConfigFieldKind::Boolean,
        required,
        description,
    )
}

fn select_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    options: Vec<IntegrationConfigFieldOption>,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        options,
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Select,
            required,
            description,
        )
    }
}

fn json_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    default_value: Option<serde_json::Value>,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        default_value,
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Json,
            required,
            description,
        )
    }
}

fn color_config_field(
    key: &str,
    label: &str,
    required: bool,
    description: &str,
    default_value: Option<serde_json::Value>,
) -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        default_value,
        ..base_config_field(
            key,
            label,
            IntegrationConfigFieldKind::Color,
            required,
            description,
        )
    }
}

fn outbound_device_update_field() -> IntegrationConfigFieldSchema {
    IntegrationConfigFieldSchema {
        min: Some(0.0),
        step: Some(10.0),
        placeholder: Some("150".to_string()),
        help_text: Some(
            "Place a linked source device such as circadian/color on the floorplan to enqueue linked lights nearest to that source first. With a non-zero interval this creates a staggered rollout while preserving immediate response for the first affected light."
                .to_string(),
        ),
        ..base_config_field(
            "outbound_device_updates.min_interval_ms",
            "Minimum interval between device commands",
            IntegrationConfigFieldKind::Number,
            false,
            "Milliseconds. Leave empty or set to 0 to disable pacing. The first update after an idle period is sent immediately; queued updates are coalesced per device so the latest state wins.",
        )
    }
}

fn option(
    label: &str,
    value: serde_json::Value,
    description: Option<&str>,
) -> IntegrationConfigFieldOption {
    IntegrationConfigFieldOption {
        label: label.to_string(),
        value,
        description: description.map(str::to_string),
    }
}

// TODO: Load integrations dynamically as plugins:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_custom_integration(
    module_name: &str,
    id: &IntegrationId,
    config: &serde_json::Value,
    cli: &Cli,
    event_tx: TxEventChannel,
) -> Result<Box<dyn Integration>> {
    match module_name {
        "circadian" => Ok(Box::new(Circadian::new(id, config, cli, event_tx)?)),
        "random" => Ok(Box::new(Random::new(id, config, cli, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, cli, event_tx)?)),
        "mqtt" => Ok(Box::new(Mqtt::new(id, config, cli, event_tx)?)),
        "timer" => Ok(Box::new(Timer::new(id, config, cli, event_tx)?)),
        "cron" => Ok(Box::new(Cron::new(id, config, cli, event_tx)?)),
        _ => Err(eyre!("Unknown module name: {module_name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_cover_all_builtin_plugins() {
        let schemas = integration_config_schemas();
        let schema_plugins = schemas
            .iter()
            .map(|schema| schema.plugin.as_str())
            .collect::<Vec<_>>();

        assert_eq!(schema_plugins, BUILT_IN_PLUGIN_NAMES);
    }

    #[test]
    fn every_schema_includes_common_outbound_pacing_field() {
        for schema in integration_config_schemas() {
            assert!(
                schema
                    .fields
                    .iter()
                    .any(|field| field.key == "outbound_device_updates.min_interval_ms"),
                "{} schema is missing outbound device update pacing",
                schema.plugin
            );
        }
    }

    #[test]
    fn mqtt_schema_exposes_core_required_fields() {
        let schema = integration_config_schema("mqtt").expect("mqtt schema should exist");
        let required_fields = schema
            .fields
            .iter()
            .filter(|field| field.required)
            .map(|field| field.key.as_str())
            .collect::<Vec<_>>();

        assert_eq!(required_fields, vec!["host", "port", "topic", "topic_set"]);
    }

    #[test]
    fn circadian_schema_uses_color_fields() {
        let schema = integration_config_schema("circadian").expect("circadian schema should exist");
        let color_fields = schema
            .fields
            .iter()
            .filter(|field| field.kind == IntegrationConfigFieldKind::Color)
            .map(|field| field.key.as_str())
            .collect::<Vec<_>>();

        assert_eq!(color_fields, vec!["day_color", "night_color"]);
    }
}
