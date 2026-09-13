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
        IntegrationConfigFieldOption, IntegrationConfigFieldSchema,
        IntegrationConfigFieldVisibility, IntegrationConfigSchema, IntegrationId,
        OutboundDeviceUpdatePolicy,
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
        let desired: HashMap<IntegrationId, _> = integrations
            .iter()
            .filter(|row| row.enabled)
            .map(|row| (IntegrationId::from(row.id.clone()), row))
            .collect();

        // Construct every replacement before stopping any working integration.
        // Invalid configuration must not tear down the existing runtime.
        let mut replacements = HashMap::new();
        for (id, row) in &desired {
            let changed = self
                .custom_integrations
                .get(id)
                .map(|old| old.module_name != row.plugin || old.config != row.config)
                .unwrap_or(true);
            if changed {
                let integration = load_custom_integration(
                    &row.plugin,
                    id,
                    &row.config,
                    &self.cli,
                    self.event_tx.clone(),
                )?;
                let policy = OutboundDeviceUpdatePolicy::from_config(&row.config)?;
                replacements.insert(
                    id.clone(),
                    IntegrationHandle::new(
                        integration,
                        id.clone(),
                        row.plugin.clone(),
                        row.config.clone(),
                        policy,
                    ),
                );
            }
        }

        let mut stopped = Vec::new();
        let mut started = Vec::new();
        let apply: Result<()> = async {
            for (id, old) in &self.custom_integrations {
                if !desired.contains_key(id) || replacements.contains_key(id) {
                    // Include the current handle in recovery even when stop times out.
                    stopped.push(old.clone());
                    old.stop().await?;
                }
            }
            for replacement in replacements.values() {
                started.push(replacement.clone());
                replacement.register().await?;
                replacement.start().await?;
            }
            Ok(())
        }
        .await;
        if let Err(error) = apply {
            for replacement in started {
                let _ = replacement.stop().await;
            }
            let mut recovery_errors = Vec::new();
            for old in stopped {
                if let Err(recovery) = old.start().await {
                    recovery_errors.push(recovery.to_string());
                }
            }
            if !recovery_errors.is_empty() {
                return Err(eyre!("Integration reload failed: {error}; restoring previous integrations also failed: {}", recovery_errors.join("; ")));
            }
            return Err(error);
        }

        let removed_ids = self
            .custom_integrations
            .keys()
            .filter(|id| !desired.contains_key(*id))
            .cloned()
            .collect();
        self.custom_integrations
            .retain(|id, _| desired.contains_key(id));
        self.custom_integrations.extend(replacements);
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
            "Connect generic MQTT devices, Zigbee2MQTT bridges, or ESPHome MQTT JSON lights.",
            vec![
                with_section(text_config_field("host", "Host", true, "MQTT broker hostname or IP address.", Some("mqtt.example.org")), "Connection"),
                with_section(number_config_field("port", "Port", true, "MQTT broker port.", (Some(1.0), Some(65535.0), Some(1.0)), Some("1883")), "Connection"),
                with_section(text_config_field("username", "Username", false, "Optional MQTT username.", Some("homeassistant")), "Connection"),
                with_section(password_config_field("password", "Password", false, "Optional MQTT password.", None), "Connection"),
                with_default_value(
                    with_section(
                        select_config_field(
                            "mode",
                            "Mode",
                            true,
                            "Generic MQTT: custom topics and payload mappings. Zigbee2MQTT: discover devices and capabilities from bridge metadata. ESPHome: standard ESPHome MQTT JSON lights.",
                            vec![
                                option("Generic MQTT", json!("generic"), Some("Custom MQTT topics and payload mappings.")),
                                option("Zigbee2MQTT", json!("zigbee2mqtt"), Some("Discover devices and capabilities from Zigbee2MQTT bridge metadata.")),
                                option("ESPHome", json!("esphome"), Some("ESPHome MQTT JSON lights using standard ESPHome light topics.")),
                            ],
                        ),
                        "Mode",
                    ),
                    json!("generic"),
                ),
                visible_when(
                    with_help_text(
                        with_section(
                            text_config_field("topic", "State topic", true, "Topic to subscribe to for device state messages.", Some("home/+/example/{id}")),
                            "Topics",
                        ),
                        "Use `{id}` where the device id appears in the MQTT topic. `+` and `#` are supported subscription wildcards.",
                    ),
                    "mode",
                    json!("generic"),
                ),
                visible_when(
                    with_help_text(
                        with_section(
                            text_config_field("topic_set", "Command topic", true, "Topic used when publishing device state commands.", Some("home/lights/example/{id}/set")),
                            "Topics",
                        ),
                        "Use `{id}` or `{name}` where the device identifier belongs in the command topic.",
                    ),
                    "mode",
                    json!("generic"),
                ),
                visible_when(
                    with_default_value(
                        with_section(
                            text_config_field("zigbee2mqtt_base_topic", "Base topic", false, "Zigbee2MQTT bridge base topic.", Some("zigbee2mqtt")),
                            "Zigbee2MQTT",
                        ),
                        json!("zigbee2mqtt"),
                    ),
                    "mode",
                    json!("zigbee2mqtt"),
                ),
                visible_when(
                    with_default_value(
                        with_section(
                            text_config_field("esphome_base_topic", "Base topic", false, "ESPHome MQTT topic prefix.", Some("esphome")),
                            "ESPHome",
                        ),
                        json!("esphome"),
                    ),
                    "mode",
                    json!("esphome"),
                ),
                visible_when(
                    with_default_value(
                        with_section(
                            text_config_field("esphome_light_object_id", "Light object ID", false, "ESPHome light object id used in the normal MQTT light topic layout.", Some("light")),
                            "ESPHome",
                        ),
                        json!("light"),
                    ),
                    "mode",
                    json!("esphome"),
                ),
                visible_when(
                    with_default_value(
                        with_section(
                            number_config_field("esphome_warm_white_kelvin", "Warm white", false, "Warm white endpoint of the ESPHome CWWW light.", (Some(1.0), Some(65535.0), Some(1.0)), Some("2700")),
                            "ESPHome",
                        ),
                        json!(2700),
                    ),
                    "mode",
                    json!("esphome"),
                ),
                visible_when(
                    with_default_value(
                        with_section(
                            number_config_field("esphome_cold_white_kelvin", "Cold white", false, "Cold white endpoint of the ESPHome CWWW light.", (Some(1.0), Some(65535.0), Some(1.0)), Some("6500")),
                            "ESPHome",
                        ),
                        json!(6500),
                    ),
                    "mode",
                    json!("esphome"),
                ),
                advanced(visible_when(with_section(number_config_field("zigbee2mqtt_poll_interval_secs", "Poll interval", false, "Refresh stale Zigbee2MQTT lights after this many seconds. Default 300; values below 30 are clamped by the runtime; 0 disables polling.", (Some(0.0), Some(86_400.0), Some(1.0)), Some("300")), "Advanced settings"), "mode", json!("zigbee2mqtt"))),
                advanced(with_section(select_config_field("managed", "Management mode", false, "Controls whether homectl corrects state drift for devices from this integration.", vec![option("Full", json!("Full"), Some("Continuously correct state drift.")), option("Unmanaged", json!("Unmanaged"), Some("Send commands without correcting later drift.")), option("Full read-only", json!("FullReadOnly"), Some("Track state but drop outbound commands.")), option("Unmanaged read-only", json!("UnmanagedReadOnly"), Some("Drop outbound commands and do not correct drift."))]), "Advanced settings")),
                advanced(with_section(number_config_field("default_transition", "Default transition", false, "Default transition duration in seconds when none is provided by homectl.", (Some(0.0), None, Some(0.1)), Some("0.6")), "Advanced settings")),
                advanced(visible_when(with_section(boolean_config_field("retain_commands", "Retain generic commands", false, "Generic MQTT retains commands by default for backwards compatibility. Disable this for brokers/devices that should only receive live commands."), "Advanced settings"), "mode", json!("generic"))),
                generic_advanced(with_help_text(with_section(text_config_field("id_field", "ID field", false, "JSON pointer to the device id when the state topic has no `{id}` placeholder.", Some("/id")), "Payload mapping"), "JSON pointers follow RFC 6901.")),
                generic_advanced(with_section(text_config_field("name_field", "Name field", false, "JSON pointer to the device display name in incoming payloads.", Some("/name")), "Payload mapping")),
                generic_advanced(with_section(text_config_field("power_field", "Power field", false, "JSON pointer to the power value in incoming and outgoing payloads.", Some("/power")), "Payload mapping")),
                generic_advanced(with_section(json_config_field("power_on_value", "Power on value", false, "JSON value that represents an on state.", Some(json!(true))), "Payload mapping")),
                generic_advanced(with_section(json_config_field("power_off_value", "Power off value", false, "JSON value that represents an off state.", Some(json!(false))), "Payload mapping")),
                generic_advanced(with_section(text_config_field("color_field", "Color field", false, "JSON pointer to the color value.", Some("/color")), "Payload mapping")),
                generic_advanced(with_section(text_config_field("brightness_field", "Brightness field", false, "JSON pointer to the brightness value.", Some("/brightness")), "Payload mapping")),
                generic_advanced(with_section(json_config_field("brightness_range", "Brightness range", false, "Two-number JSON array describing the source brightness range.", Some(json!([0, 255]))), "Payload mapping")),
                generic_advanced(with_help_text(with_section(json_config_field("sensor_value_fields", "Sensor value fields", false, "JSON array of pointers to sensor values in incoming payloads.", Some(json!(["/temperature", "/humidity"]))), "Payload mapping"), "List every numeric or boolean sensor value to keep.")),
                generic_advanced(with_section(text_config_field("transition_field", "Transition field", false, "JSON pointer to transition/fade duration.", Some("/transition")), "Payload mapping")),
                generic_advanced(with_section(json_config_field("transition_range", "Transition range", false, "Two-number JSON array describing the transition duration range.", Some(json!([0, 600]))), "Payload mapping")),
                generic_advanced(with_section(text_config_field("capabilities_field", "Capabilities field", false, "JSON pointer to advertised device capabilities.", Some("/capabilities")), "Payload mapping")),
                generic_advanced(with_section(json_config_field("capabilities_override", "Capabilities override", false, "Optional capabilities object that overrides discovered capabilities.", Some(json!({ "xy": true, "hs": false, "rgb": false, "ct": { "start": 2000, "end": 6500 } }))), "Payload mapping")),
                generic_advanced(with_section(text_config_field("raw_field", "Raw payload field", false, "JSON pointer to store as raw device metadata.", Some("/raw")), "Payload mapping")),
                generic_advanced(with_section(boolean_config_field("include_id_name_in_set_payload", "Include id/name in command payload", false, "Include device id and name fields when publishing command payloads."), "Payload mapping")),
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
            vec![with_help_text(
                json_config_field(
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
                ),
                "Cron syntax is `second minute hour day-of-month month day-of-week`. Keep ids stable because routines and actions may reference the generated schedule devices.",
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
            vec![with_help_text(
                json_config_field(
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
                ),
                "Use dummy devices to prototype groups, scenes, and routines before connecting real hardware. Device ids become `integration_id/device_id` keys.",
            )],
        )),
        "random" => Some(schema(
            "random",
            "Random",
            "Expose a virtual color sensor that emits a random color every second.",
            vec![
                text_config_field(
                    "device_name",
                    "Device name",
                    true,
                    "Display name for the virtual random color device.",
                    Some("Random colors"),
                ),
                number_config_field(
                    "min_brightness",
                    "Minimum brightness",
                    false,
                    "Lower bound for random brightness values from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.1)),
                    Some("0.4"),
                ),
                number_config_field(
                    "max_brightness",
                    "Maximum brightness",
                    false,
                    "Upper bound for random brightness values from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.1)),
                    Some("0.8"),
                ),
                number_config_field(
                    "min_saturation",
                    "Minimum saturation",
                    false,
                    "Lower bound for random saturation values from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.1)),
                    Some("0.4"),
                ),
                number_config_field(
                    "max_saturation",
                    "Maximum saturation",
                    false,
                    "Upper bound for random saturation values from 0 to 1.",
                    (Some(0.0), Some(1.0), Some(0.1)),
                    Some("0.7"),
                ),
                number_config_field(
                    "transition",
                    "Transition",
                    false,
                    "Transition duration in seconds applied to each random color update.",
                    (Some(0.0), Some(10.0), Some(0.1)),
                    Some("0.6"),
                ),
                number_config_field(
                    "strobe_interval",
                    "Strobe interval",
                    false,
                    "Polling interval in milliseconds between random color updates.",
                    (Some(20.0), None, Some(100.0)),
                    Some("1000"),
                ),
            ],
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
    fields.push(advanced(with_section(
        outbound_device_update_field(),
        "Advanced settings",
    )));
    fields.push(advanced(with_section(
        json_config_field(
            "disabled_device_ids",
            "Disabled devices",
            false,
            "Device IDs excluded from state commands and Zigbee2MQTT polling. Also editable in each device dialog.",
            Some(json!([])),
        ),
        "Advanced settings",
    )));

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
        section: None,
        advanced: false,
        visible_when: None,
    }
}

fn with_section(
    mut field: IntegrationConfigFieldSchema,
    section: &str,
) -> IntegrationConfigFieldSchema {
    field.section = Some(section.to_string());
    field
}

fn advanced(mut field: IntegrationConfigFieldSchema) -> IntegrationConfigFieldSchema {
    field.advanced = true;
    field
}

fn generic_advanced(field: IntegrationConfigFieldSchema) -> IntegrationConfigFieldSchema {
    advanced(visible_when(field, "mode", json!("generic")))
}

fn visible_when(
    mut field: IntegrationConfigFieldSchema,
    key: &str,
    equals: serde_json::Value,
) -> IntegrationConfigFieldSchema {
    field.visible_when = Some(IntegrationConfigFieldVisibility {
        key: key.to_string(),
        equals,
    });
    field
}

fn with_default_value(
    mut field: IntegrationConfigFieldSchema,
    value: serde_json::Value,
) -> IntegrationConfigFieldSchema {
    field.default_value = Some(value);
    field
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

fn with_help_text(
    mut field: IntegrationConfigFieldSchema,
    help_text: &str,
) -> IntegrationConfigFieldSchema {
    field.help_text = Some(help_text.to_string());
    field
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

    #[tokio::test]
    async fn disabled_device_policy_round_trips_in_database_config_exports() {
        let (state, _rx) = crate::core::event::tests::test_state();
        let mut export = state.runtime_config.clone();
        export.integrations.push(config_queries::IntegrationRow {
            id: "policy-test".into(),
            plugin: "mqtt".into(),
            enabled: true,
            config: json!({"disabled_device_ids":["lamp"]}),
        });
        let restored: config_queries::ConfigExport =
            serde_json::from_str(&serde_json::to_string(&export).unwrap()).unwrap();
        let row = restored
            .integrations
            .iter()
            .find(|row| row.id == "policy-test")
            .unwrap();
        assert!(crate::types::integration::device_is_disabled(
            &row.config,
            "lamp"
        ));
        assert!(!crate::types::integration::device_is_disabled(
            &json!({}),
            "lamp"
        ));
    }

    #[tokio::test]
    async fn invalid_reload_preserves_existing_integration() {
        let (mut state, _rx) = crate::core::event::tests::test_state();
        let original = config_queries::IntegrationRow {
            id: "timer".into(),
            plugin: "timer".into(),
            config: json!({"device_name": "Original timer"}),
            enabled: true,
        };
        state
            .integrations
            .reload_config_rows(std::slice::from_ref(&original))
            .await
            .unwrap();
        let invalid = config_queries::IntegrationRow {
            config: json!({"device_name": 123}),
            ..original.clone()
        };
        assert!(state
            .integrations
            .reload_config_rows(&[invalid])
            .await
            .is_err());
        let current = state
            .integrations
            .custom_integrations
            .get(&IntegrationId::from("timer".to_string()))
            .unwrap();
        assert_eq!(current.config, original.config);
        current.register().await.unwrap();
    }

    #[tokio::test]
    async fn reload_stop_failure_restarts_previous_integration_and_returns_error() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        struct StopFailure(Arc<AtomicUsize>);
        #[async_trait::async_trait]
        impl Integration for StopFailure {
            fn new(
                _: &IntegrationId,
                _: &serde_json::Value,
                _: &Cli,
                _: TxEventChannel,
            ) -> Result<Self> {
                unreachable!()
            }
            async fn start(&mut self) -> Result<()> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
            async fn stop(&mut self) -> Result<()> {
                Err(eyre!("stop failed"))
            }
        }
        let (mut state, _rx) = crate::core::event::tests::test_state();
        let starts = Arc::new(AtomicUsize::new(0));
        let id = IntegrationId::from("existing".to_string());
        state.integrations.custom_integrations.insert(
            id.clone(),
            IntegrationHandle::new(
                Box::new(StopFailure(starts.clone())),
                id.clone(),
                "test".into(),
                json!({}),
                Default::default(),
            ),
        );
        let error = state
            .integrations
            .reload_config_rows(&[])
            .await
            .unwrap_err();
        assert!(error.to_string().contains("stop failed"));
        assert_eq!(starts.load(Ordering::SeqCst), 1);
        assert!(state.integrations.custom_integrations.contains_key(&id));
    }

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

        assert!(required_fields.contains(&"mode"));
        assert!(required_fields.contains(&"host"));
        assert!(required_fields.contains(&"port"));
        assert!(required_fields.contains(&"topic"));
        assert!(required_fields.contains(&"topic_set"));

        let field = |key: &str| schema.fields.iter().find(|field| field.key == key).unwrap();
        assert_eq!(field("mode").default_value, Some(json!("generic")));
        assert_eq!(field("topic").visible_when.as_ref().unwrap().key, "mode");
        assert_eq!(
            field("topic").visible_when.as_ref().unwrap().equals,
            json!("generic")
        );
        assert!(field("id_field").advanced);
        assert_eq!(
            field("id_field").section.as_deref(),
            Some("Payload mapping")
        );
        assert_eq!(
            field("id_field").visible_when.as_ref().unwrap().equals,
            json!("generic")
        );
        assert_eq!(
            field("zigbee2mqtt_poll_interval_secs")
                .visible_when
                .as_ref()
                .unwrap()
                .equals,
            json!("zigbee2mqtt")
        );
        assert_eq!(
            field("zigbee2mqtt_base_topic").default_value,
            Some(json!("zigbee2mqtt"))
        );
        assert_eq!(
            field("esphome_base_topic").default_value,
            Some(json!("esphome"))
        );
        assert_eq!(
            field("esphome_light_object_id").default_value,
            Some(json!("light"))
        );
        assert_eq!(
            field("esphome_warm_white_kelvin").default_value,
            Some(json!(2700))
        );
        assert_eq!(
            field("esphome_cold_white_kelvin").default_value,
            Some(json!(6500))
        );

        let serialized = serde_json::to_value(&schema).expect("schema should be serializable");
        assert_eq!(serialized["plugin"], "mqtt");
        assert_eq!(serialized["fields"][4]["key"], "mode");
        assert_eq!(serialized["fields"][4]["visible_when"], json!(null));
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

    #[test]
    fn random_schema_exposes_random_config_fields() {
        let schema = integration_config_schema("random").expect("random schema should exist");
        let keys = schema
            .fields
            .iter()
            .map(|field| field.key.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            keys,
            vec![
                "device_name",
                "min_brightness",
                "max_brightness",
                "min_saturation",
                "max_saturation",
                "transition",
                "strobe_interval",
                "outbound_device_updates.min_interval_ms",
                "disabled_device_ids",
            ]
        );
    }
}
