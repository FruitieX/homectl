//! Deterministic scenario testing for the production routine engine.
//!
//! Scenario suites intentionally contain only simulated starting devices and
//! events. No integration is loaded or started, and deferred hardware/database
//! work is recorded or discarded rather than executed.

use crate::core::{
    automation::ConfigCatalog,
    clock::{Clock, ManualClock},
    devices::Devices,
    event::{handle_event, DeferredEventWork},
    groups::Groups,
    integrations::Integrations,
    routines::Routines,
    scenes::Scenes,
    snapshot::{new_snapshot_handle, RuntimeSnapshot},
    state::{AppState, PendingWsUpdate},
    ui::Ui,
};
use crate::db::config_queries::ConfigExport;
use crate::types::{
    automation_definition::HelperId,
    automation_event::EventOrigin,
    color::{Capabilities, DeviceColor},
    device::{
        ControllableDevice, ControllableState, Device, DeviceData, DeviceKey, ManageKind,
        SensorDevice,
    },
    event::{mk_event_channel, Event, RxEventChannel},
};
use crate::utils::cli::Cli;
use color_eyre::eyre::{eyre, Result, WrapErr};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

const MAX_EVENTS_PER_SCENARIO: usize = 2_048;
const DEFAULT_START_TIME_MS: i64 = 1_700_000_000_000;

/// Versioned private scenario document. Keep personal suites outside the git
/// checkout; only the generic runner and synthetic runner tests belong here.
#[derive(Debug, Deserialize)]
pub struct ScenarioSuite {
    pub version: u32,
    /// Integration-discovered inventory metadata. State remains scenario-local.
    #[serde(default)]
    pub devices: Vec<ScenarioDeviceSeed>,
    pub scenarios: Vec<Scenario>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScenarioDeviceSeed {
    Light {
        device: DeviceKey,
        name: String,
        capabilities: Capabilities,
    },
    Sensor {
        device: DeviceKey,
        name: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SensorValueKind {
    Boolean,
    Number,
    Text,
}

#[derive(Debug, Deserialize)]
pub struct Scenario {
    pub name: String,
    /// Routine display names under test (IDs are accepted only when unique).
    pub routines: Vec<String>,
    #[serde(default)]
    pub initial_helpers: HashMap<String, Value>,
    #[serde(default = "default_start_time_ms")]
    pub start_time_ms: i64,
    pub initial_state: Vec<ScenarioDevice>,
    #[serde(default)]
    pub events: Vec<ScenarioEvent>,
    pub expect: ScenarioExpectations,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScenarioDevice {
    Light {
        device: DeviceKey,
        #[serde(default)]
        name: Option<String>,
        power: bool,
        #[serde(default)]
        brightness: Option<f32>,
        #[serde(default)]
        color: Option<DeviceColor>,
        #[serde(default)]
        transition: Option<f32>,
        #[serde(default)]
        capabilities: Option<Capabilities>,
    },
    Sensor {
        device: DeviceKey,
        #[serde(default)]
        name: Option<String>,
        value: SensorValue,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum SensorValue {
    Boolean(bool),
    Number(f64),
    Text(String),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScenarioEvent {
    Sensor {
        device: DeviceKey,
        value: SensorValue,
    },
    AdvanceTime {
        duration_ms: u64,
    },
}

#[derive(Debug, Deserialize)]
pub struct ScenarioExpectations {
    #[serde(default)]
    pub commands: Vec<ExpectedCommand>,
    #[serde(default)]
    pub final_state: Vec<ExpectedDeviceState>,
    #[serde(default)]
    pub unchanged: Vec<DeviceKey>,
    #[serde(default)]
    pub final_helpers: HashMap<String, Value>,
    #[serde(default)]
    pub unchanged_helpers: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExpectedCommand {
    DeviceState {
        device: DeviceKey,
        #[serde(flatten)]
        state: LightState,
    },
    IntegrationAction {
        integration_id: String,
        payload: Value,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct LightState {
    pub power: bool,
    #[serde(default)]
    pub brightness: Option<f32>,
    #[serde(default)]
    pub color: Option<DeviceColor>,
    #[serde(default)]
    pub transition: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExpectedDeviceState {
    Light {
        device: DeviceKey,
        #[serde(flatten)]
        state: LightState,
    },
    Sensor {
        device: DeviceKey,
        value: SensorValue,
    },
}

#[derive(Debug, Clone, PartialEq)]
enum RecordedCommand {
    DeviceState {
        device: DeviceKey,
        state: LightState,
    },
    IntegrationAction {
        integration_id: String,
        payload: Value,
    },
}

#[derive(Debug)]
pub struct ScenarioResult {
    pub name: String,
    pub passed: bool,
    pub failures: Vec<String>,
}

#[derive(Debug)]
pub struct ScenarioReport {
    pub scenarios: Vec<ScenarioResult>,
}

impl ScenarioReport {
    pub fn passed_count(&self) -> usize {
        self.scenarios
            .iter()
            .filter(|scenario| scenario.passed)
            .count()
    }

    pub fn failed_count(&self) -> usize {
        self.scenarios.len() - self.passed_count()
    }
}

fn default_start_time_ms() -> i64 {
    DEFAULT_START_TIME_MS
}

/// Run every scenario against the same exported configuration, compiling its
/// routines through `AppState::apply_runtime_routines` and exercising the
/// normal event handler/frame evaluator with a fresh fake runtime per case.
pub async fn run_scenario_suite(
    config: &ConfigExport,
    suite: &ScenarioSuite,
) -> Result<ScenarioReport> {
    if suite.version != 1 {
        return Err(eyre!(
            "unsupported scenario suite version {}; expected 1",
            suite.version
        ));
    }
    if suite.scenarios.is_empty() {
        return Err(eyre!("scenario suite contains no scenarios"));
    }
    let device_catalog = index_device_catalog(&suite.devices)?;

    let mut results = Vec::with_capacity(suite.scenarios.len());
    for scenario in &suite.scenarios {
        results.push(run_scenario(config, scenario, &device_catalog).await?);
    }
    Ok(ScenarioReport { scenarios: results })
}

fn index_device_catalog(
    devices: &[ScenarioDeviceSeed],
) -> Result<HashMap<DeviceKey, &ScenarioDeviceSeed>> {
    let mut catalog = HashMap::with_capacity(devices.len());
    for seed in devices {
        let (device, name) = seed.identity();
        if name.trim().is_empty() {
            return Err(eyre!("device catalog entry '{}' has an empty name", device));
        }
        if catalog.insert(device.clone(), seed).is_some() {
            return Err(eyre!("device catalog defines '{}' more than once", name));
        }
    }
    Ok(catalog)
}

async fn run_scenario(
    config: &ConfigExport,
    scenario: &Scenario,
    device_catalog: &HashMap<DeviceKey, &ScenarioDeviceSeed>,
) -> Result<ScenarioResult> {
    if scenario.name.trim().is_empty() {
        return Err(eyre!("scenario name must not be empty"));
    }
    if scenario.initial_state.is_empty() {
        return Err(eyre!(
            "scenario '{}' has no initial_state devices",
            scenario.name
        ));
    }

    let mut initial_devices = HashMap::new();
    let mut labels = device_catalog
        .iter()
        .map(|(key, seed)| (key.clone(), seed.identity().1.to_owned()))
        .collect::<HashMap<_, _>>();
    for simulated in &scenario.initial_state {
        let key = simulated.key();
        let seed = device_catalog.get(&key).copied();
        if !device_catalog.is_empty() && seed.is_none() {
            return Err(eyre!(
                "scenario '{}' seeds device '{}' that is missing from the suite device catalog",
                scenario.name,
                label(&key, &labels)
            ));
        }
        let device = simulated.to_device(seed)?;
        let key = device.get_device_key();
        if initial_devices.contains_key(&key) {
            return Err(eyre!(
                "scenario '{}' defines device '{}' more than once",
                scenario.name,
                device.name
            ));
        }
        labels.insert(key.clone(), device.name.clone());
        initial_devices.insert(key, device);
    }
    validate_expectations(scenario, &initial_devices, &labels)?;

    let clock = Arc::new(ManualClock::new(scenario.start_time_ms));
    let (mut state, mut event_rx) = build_runtime(
        config,
        &initial_devices,
        &scenario.initial_helpers,
        clock.clone(),
    )
    .await?;
    validate_tested_routines(
        config,
        scenario,
        &state,
        &initial_devices,
        &scenario.initial_helpers,
    )?;
    let starting_devices = state.devices.get_state().0.clone();
    let helper_names: HashSet<String> = scenario.initial_helpers.keys().cloned().collect();
    let starting_helpers = snapshot_helpers(&state, &helper_names);
    let mut commands = Vec::new();
    let mut scheduled_rollouts = Vec::new();

    for injected in &scenario.events {
        match injected {
            ScenarioEvent::Sensor { device, value } => {
                let Some(mut current) = state.devices.get_device(device).cloned() else {
                    return Err(eyre!(
                        "scenario '{}' injects an event for unknown device '{}'",
                        scenario.name,
                        label(device, &labels)
                    ));
                };
                let DeviceData::Sensor(sensor) = &current.data else {
                    return Err(eyre!(
                        "scenario '{}' injects a sensor event into light '{}'",
                        scenario.name,
                        label(device, &labels)
                    ));
                };
                let current_kind = SensorValueKind::from_sensor(sensor).ok_or_else(|| {
                    eyre!(
                        "scenario '{}' cannot inject values into color-type sensor '{}'",
                        scenario.name,
                        label(device, &labels)
                    )
                })?;
                if value.kind() != current_kind {
                    return Err(eyre!(
                        "scenario '{}' injects the wrong value type for sensor '{}'",
                        scenario.name,
                        label(device, &labels)
                    ));
                }
                current.data = DeviceData::Sensor(value.to_sensor()?);
                process_events(
                    &mut state,
                    &mut event_rx,
                    vec![Event::ExternalStateUpdate {
                        device: current,
                        integration_epoch: None,
                    }],
                    &mut commands,
                    &mut scheduled_rollouts,
                )
                .await
                .wrap_err_with(|| format!("scenario '{}' event failed", scenario.name))?;
            }
            ScenarioEvent::AdvanceTime { duration_ms } => {
                let wall_delta = i64::try_from(*duration_ms)
                    .map_err(|_| eyre!("scenario '{}' time advance is too large", scenario.name))?;
                clock.advance_wall_ms(wall_delta);
                clock.advance_monotonic_ms(*duration_ms);
                let mut due = due_timer_events(&state, &clock);
                due.extend(take_due_rollout_events(
                    clock.monotonic_ms(),
                    &mut scheduled_rollouts,
                ));
                process_events(
                    &mut state,
                    &mut event_rx,
                    due,
                    &mut commands,
                    &mut scheduled_rollouts,
                )
                .await
                .wrap_err_with(|| format!("scenario '{}' timer event failed", scenario.name))?;
            }
        }
    }

    // Process any events emitted by the final state frame before asserting.
    process_events(
        &mut state,
        &mut event_rx,
        Vec::new(),
        &mut commands,
        &mut scheduled_rollouts,
    )
    .await
    .wrap_err_with(|| format!("scenario '{}' final dispatch failed", scenario.name))?;

    let mut failures = Vec::new();
    compare_commands(&scenario.expect.commands, &commands, &labels, &mut failures);
    compare_final_state(&state, &scenario.expect.final_state, &labels, &mut failures);
    compare_unchanged(
        &starting_devices,
        &state,
        &scenario.expect.unchanged,
        &labels,
        &mut failures,
    );
    compare_helpers(
        &starting_helpers,
        &state,
        &scenario.expect.final_helpers,
        &scenario.expect.unchanged_helpers,
        &mut failures,
    );

    Ok(ScenarioResult {
        name: scenario.name.clone(),
        passed: failures.is_empty(),
        failures,
    })
}

fn validate_tested_routines(
    config: &ConfigExport,
    scenario: &Scenario,
    state: &AppState,
    initial_devices: &HashMap<DeviceKey, Device>,
    initial_helpers: &HashMap<String, Value>,
) -> Result<()> {
    if scenario.routines.is_empty() {
        return Err(eyre!(
            "scenario '{}' must name the configured routines it exercises",
            scenario.name
        ));
    }
    let mut seen = HashSet::new();
    for reference in &scenario.routines {
        if !seen.insert(reference) {
            return Err(eyre!(
                "scenario '{}' lists routine '{}' more than once",
                scenario.name,
                reference
            ));
        }
        let matching: Vec<_> = config
            .routines
            .iter()
            .filter(|routine| routine.id == *reference || routine.name == *reference)
            .collect();
        let [routine] = matching.as_slice() else {
            return Err(eyre!(
                "scenario '{}' references routine '{}' but it is {} in the loaded configuration",
                scenario.name,
                reference,
                if matching.is_empty() {
                    "missing"
                } else {
                    "ambiguous"
                }
            ));
        };
        if !routine.enabled {
            return Err(eyre!(
                "scenario '{}' references disabled routine '{}'",
                scenario.name,
                routine.name
            ));
        }
        let routine_id = crate::types::rule::RoutineId::from(routine.id.clone());
        let compiled = if routine.semantics_version >= 2 {
            state.rules.compiled_v2_routines().contains_key(&routine_id)
        } else {
            !state.rules.quarantined_routines().contains_key(&routine_id)
        };
        if !compiled {
            return Err(eyre!(
                "scenario '{}' cannot run configured routine '{}' with the simulated device set; check its configuration and required devices",
                scenario.name,
                routine.name
            ));
        }
        for required in referenced_devices(config, routine)? {
            if !initial_devices.contains_key(&required) {
                return Err(eyre!(
                    "scenario '{}' must include configured device '{}' used by routine '{}' in its initial_state",
                    scenario.name,
                    required,
                    routine.name
                ));
            }
        }
        for helper in referenced_helpers(routine)? {
            let helper_id = HelperId(helper.clone());
            if state.helpers.definition(&helper_id).is_none() {
                return Err(eyre!(
                    "scenario '{}' references unknown helper '{}' in routine '{}'",
                    scenario.name,
                    helper,
                    routine.name
                ));
            }
            if !initial_helpers.contains_key(&helper) {
                return Err(eyre!(
                    "scenario '{}' must set the initial value for helper '{}' used by routine '{}'",
                    scenario.name,
                    helper,
                    routine.name
                ));
            }
        }
    }
    Ok(())
}

fn referenced_helpers(routine: &crate::db::config_queries::RoutineRow) -> Result<HashSet<String>> {
    let value = serde_json::to_value(routine)?;
    let mut helpers = HashSet::new();
    collect_string_fields(&value, &["helper"], &mut helpers);
    Ok(helpers)
}

fn referenced_devices(
    config: &ConfigExport,
    routine: &crate::db::config_queries::RoutineRow,
) -> Result<HashSet<DeviceKey>> {
    let routine_value = serde_json::to_value(routine)?;
    let mut devices = HashSet::new();
    let mut group_ids = HashSet::new();
    let mut scene_ids = HashSet::new();
    collect_device_keys(&routine_value, &mut devices);
    collect_string_fields(
        &routine_value,
        &["group_id", "group_keys", "groups"],
        &mut group_ids,
    );
    collect_string_fields(&routine_value, &["scene_id"], &mut scene_ids);

    while let Some(group_id) = group_ids.iter().next().cloned() {
        group_ids.remove(&group_id);
        let Some(group) = config.groups.iter().find(|group| group.id == group_id) else {
            continue;
        };
        let value = serde_json::to_value(group)?;
        collect_device_keys(&value, &mut devices);
        collect_string_fields(
            &value,
            &["group_id", "group_keys", "linked_groups"],
            &mut group_ids,
        );
    }
    while let Some(scene_id) = scene_ids.iter().next().cloned() {
        scene_ids.remove(&scene_id);
        let Some(scene) = config.scenes.iter().find(|scene| scene.id == scene_id) else {
            continue;
        };
        let value = serde_json::to_value(scene)?;
        collect_device_keys(&value, &mut devices);
        collect_string_fields(
            &value,
            &["group_id", "group_keys", "groups", "linked_groups"],
            &mut group_ids,
        );
        if let Some(group_states) = value.get("group_states").and_then(Value::as_object) {
            group_ids.extend(group_states.keys().cloned());
        }
        if let Some(group_order) = value.get("group_state_order").and_then(Value::as_array) {
            group_ids.extend(
                group_order
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string),
            );
        }
        while let Some(group_id) = group_ids.iter().next().cloned() {
            group_ids.remove(&group_id);
            if let Some(group) = config.groups.iter().find(|group| group.id == group_id) {
                let group_value = serde_json::to_value(group)?;
                collect_device_keys(&group_value, &mut devices);
                collect_string_fields(
                    &group_value,
                    &["group_id", "group_keys", "linked_groups"],
                    &mut group_ids,
                );
            }
        }
    }
    Ok(devices)
}

fn collect_device_keys(value: &Value, devices: &mut HashSet<DeviceKey>) {
    match value {
        Value::Object(object) => {
            if let (Some(integration_id), Some(device_id)) = (
                object.get("integration_id").and_then(Value::as_str),
                object.get("device_id").and_then(Value::as_str),
            ) {
                if let Ok(key) = serde_json::from_value(serde_json::json!({
                    "integration_id": integration_id,
                    "device_id": device_id
                })) {
                    devices.insert(key);
                }
            }
            for (name, child) in object {
                if matches!(name.as_str(), "device" | "device_key") {
                    if let Some(key) = child.as_str().and_then(parse_device_key) {
                        devices.insert(key);
                    }
                }
                if let Some(key) = parse_device_key(name) {
                    devices.insert(key);
                }
                collect_device_keys(child, devices);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_device_keys(item, devices);
            }
        }
        _ => {}
    }
}

fn collect_string_fields(value: &Value, fields: &[&str], output: &mut HashSet<String>) {
    match value {
        Value::Object(object) => {
            for (name, child) in object {
                if fields.contains(&name.as_str()) {
                    match child {
                        Value::String(value) => {
                            output.insert(value.clone());
                        }
                        Value::Array(values) => {
                            output
                                .extend(values.iter().filter_map(Value::as_str).map(str::to_owned));
                        }
                        _ => {}
                    }
                }
                collect_string_fields(child, fields, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_string_fields(item, fields, output);
            }
        }
        _ => {}
    }
}

fn parse_device_key(value: &str) -> Option<DeviceKey> {
    serde_json::from_value(Value::String(value.to_string())).ok()
}

async fn build_runtime(
    config: &ConfigExport,
    devices_to_seed: &HashMap<DeviceKey, Device>,
    initial_helpers: &HashMap<String, Value>,
    clock: Arc<ManualClock>,
) -> Result<(AppState, RxEventChannel)> {
    let cli = Cli {
        dry_run: true,
        port: 0,
        database_url: None,
        config: None,
        warmup_time: Some(0),
        command: None,
    };
    let (event_tx, event_rx) = mk_event_channel();

    // Nothing calls integration load/register/start passes: simulated commands
    // terminate at the event recorder below, never at a plugin or device.
    let integrations = Integrations::new(event_tx.clone(), &cli);
    let mut groups = Groups::new(Default::default());
    groups.load_config_rows(&config.groups);
    let mut scenes = Scenes::new(Default::default());
    scenes.load_config_rows(&config.scenes, Default::default());

    let mut devices = Devices::new_simulated(event_tx.clone(), &cli);
    for device in devices_to_seed.values() {
        devices.set_state_with_origin(device, true, true, EventOrigin::Startup);
    }
    // Initial state is seed data, not a user event and must never trigger a
    // routine or emit a command.
    devices.take_pending_mutations();
    groups.force_invalidate(&devices);
    scenes.force_invalidate(&devices, &groups);

    let mut helpers = crate::core::helpers::Helpers::default();
    helpers.load_rows(
        config.helpers.clone(),
        config
            .helper_values
            .iter()
            .map(|row| (HelperId(row.id.clone()), row.value.clone(), row.revision))
            .collect(),
    );
    for (id, value) in initial_helpers {
        helpers
            .set_value(&HelperId(id.clone()), value.clone())
            .map_err(|error| eyre!("invalid initial helper '{}': {error}", id))?;
    }
    let mut sources = crate::core::automation::sources::Sources::default();
    sources.load_rows(config.sources.clone());
    let catalog = ConfigCatalog::new(devices.get_state().0.keys().cloned(), config);
    let mut rules = Routines::new(Default::default(), event_tx.clone());
    rules.load_config_rows(&config.routines, &catalog);
    rules.seed_transitions(&devices, &groups, Some(&helpers));
    let ui = Ui::new();
    let snapshot = new_snapshot_handle(RuntimeSnapshot {
        runtime_config: Arc::new(config.clone()),
        devices: Arc::new(devices.get_state().clone()),
        flattened_groups: Arc::new(groups.get_flattened_groups().clone()),
        flattened_scenes: Arc::new(scenes.get_flattened_scenes().clone()),
        routine_statuses: rules.get_runtime_statuses(),
        helper_statuses: Arc::new(Vec::new()),
        timers: Arc::new(Vec::new()),
        ui_state: Arc::new(ui.get_state().clone()),
        warming_up: false,
    });
    let mut state = AppState {
        calibration_sessions: Default::default(),
        warming_up: false,
        runtime_config: config.clone(),
        integrations,
        groups,
        scenes,
        devices,
        rules,
        helpers,
        sources,
        intents: Default::default(),
        scripts: Default::default(),
        timers: Default::default(),
        pending_timer_fires: Vec::new(),
        pending_predicate_fires: Vec::new(),
        pending_schedule_fires: Vec::new(),
        clock: clock.clone(),
        pending_deferred_work: Vec::new(),
        event_tx,
        ws: Default::default(),
        ui,
        ws_broadcast_pending: Default::default(),
        pending_ws_update: Arc::new(Mutex::new(PendingWsUpdate::default())),
        runtime_apply_lock: Arc::new(AsyncMutex::new(())),
        snapshot,
        frame_log: Default::default(),
    };

    // No startup actor, websocket broadcaster, or wall-clock schedule task is
    // started here. Scenario time advances only through `AdvanceTime` events.
    state.sync_script_owners();
    Ok((state, event_rx))
}

async fn process_events(
    state: &mut AppState,
    event_rx: &mut RxEventChannel,
    initial_events: Vec<Event>,
    commands: &mut Vec<RecordedCommand>,
    scheduled_rollouts: &mut Vec<(u64, Event)>,
) -> Result<()> {
    let mut queue: VecDeque<Event> = initial_events.into();
    let mut processed = 0usize;
    loop {
        while let Some(event) = queue.pop_front() {
            processed += 1;
            if processed > MAX_EVENTS_PER_SCENARIO {
                return Err(eyre!(
                    "event cascade exceeded {MAX_EVENTS_PER_SCENARIO} events (possible routine loop)"
                ));
            }
            let outcome = handle_event(state, &event).await?;
            for work in outcome.into_deferred_work() {
                match work {
                    DeferredEventWork::PublishIntegrationState { device, .. } => {
                        let light = device
                            .get_controllable_state()
                            .ok_or_else(|| eyre!("outbound device command targeted a sensor"))?;
                        commands.push(RecordedCommand::DeviceState {
                            device: device.get_device_key(),
                            state: LightState::from_controllable(light),
                        });
                    }
                    DeferredEventWork::RunIntegrationAction { descriptor, .. } => {
                        commands.push(RecordedCommand::IntegrationAction {
                            integration_id: descriptor.integration_id.to_string(),
                            payload: Value::String(descriptor.payload.to_string()),
                        });
                    }
                    // Persistence, UI, and timer-storage work has no place in
                    // the simulated runtime and is intentionally not executed.
                    _ => {}
                }
            }
            state.flush_pending_frames().await;
            let now = state.clock.monotonic_ms();
            for (delay_ms, rollout_event) in state.devices.take_scheduled_rollout_events() {
                scheduled_rollouts.push((now.saturating_add(delay_ms), rollout_event));
            }
            queue.extend(take_due_rollout_events(now, scheduled_rollouts));
            while let Ok(emitted) = event_rx.try_recv() {
                queue.push_back(emitted);
            }
        }

        // Script-backed routines use the same supervised worker path as the
        // server. Await only while an invocation is actually pending; clock
        // advancement and timer deadlines remain controlled by the scenario.
        if state.scripts.coordinator().total_pending_count() == 0 {
            break;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(15), event_rx.recv()).await {
            Ok(Some(event)) => queue.push_back(event),
            Ok(None) => return Err(eyre!("event channel closed while a script was pending")),
            Err(_) => return Err(eyre!("script execution timed out after 15 seconds")),
        }
    }
    Ok(())
}

fn take_due_rollout_events(now_ms: u64, scheduled: &mut Vec<(u64, Event)>) -> Vec<Event> {
    let mut due = Vec::new();
    let mut future = Vec::with_capacity(scheduled.len());
    for (due_ms, event) in std::mem::take(scheduled) {
        if due_ms <= now_ms {
            due.push(event);
        } else {
            future.push((due_ms, event));
        }
    }
    *scheduled = future;
    due
}

fn due_timer_events(state: &AppState, clock: &ManualClock) -> Vec<Event> {
    state
        .timers
        .wakeups()
        .into_iter()
        .filter(|wakeup| match &wakeup.job {
            crate::types::event::TimerWakeupJob::ScheduleOccurrence { .. } => {
                wakeup.due_wall_ms <= clock.wall_ms()
            }
            _ => wakeup.due_monotonic_ms <= clock.monotonic_ms(),
        })
        .map(|wakeup| Event::TimerWakeup {
            routine_id: wakeup.routine_id,
            definition_revision: wakeup.definition_revision,
            job: wakeup.job,
            generation: wakeup.generation,
            due_wall_ms: wakeup.due_wall_ms,
        })
        .collect()
}

fn validate_expectations(
    scenario: &Scenario,
    initial_devices: &HashMap<DeviceKey, Device>,
    labels: &HashMap<DeviceKey, String>,
) -> Result<()> {
    let mut covered = HashSet::new();
    for device in &scenario.expect.unchanged {
        if !initial_devices.contains_key(device) {
            return Err(eyre!(
                "scenario '{}' expects unknown device '{}' to remain unchanged",
                scenario.name,
                label(device, labels)
            ));
        }
        if !covered.insert(device) {
            return Err(eyre!(
                "scenario '{}' lists '{}' more than once in its final-state assertions",
                scenario.name,
                label(device, labels)
            ));
        }
    }
    for expected in &scenario.expect.final_state {
        let key = expected.device();
        let Some(initial) = initial_devices.get(key) else {
            return Err(eyre!(
                "scenario '{}' expects a final state for unknown device '{}'",
                scenario.name,
                label(key, labels)
            ));
        };
        let kind_matches = matches!(
            (expected, &initial.data),
            (
                ExpectedDeviceState::Light { .. },
                DeviceData::Controllable(_)
            ) | (ExpectedDeviceState::Sensor { .. }, DeviceData::Sensor(_))
        );
        if !kind_matches {
            return Err(eyre!(
                "scenario '{}' final-state assertion has the wrong device kind for '{}'",
                scenario.name,
                label(key, labels)
            ));
        }
        if !covered.insert(key) {
            return Err(eyre!(
                "scenario '{}' asserts final state for '{}' more than once",
                scenario.name,
                label(key, labels)
            ));
        }
    }
    for command in &scenario.expect.commands {
        if let ExpectedCommand::DeviceState { device, .. } = command {
            let Some(initial) = initial_devices.get(device) else {
                return Err(eyre!(
                    "scenario '{}' expects a command for unknown device '{}'",
                    scenario.name,
                    label(device, labels)
                ));
            };
            if !matches!(&initial.data, DeviceData::Controllable(_)) {
                return Err(eyre!(
                    "scenario '{}' expects a light command for sensor '{}'",
                    scenario.name,
                    label(device, labels)
                ));
            }
        }
    }
    for (key, device) in initial_devices {
        if !covered.contains(key) {
            return Err(eyre!(
                "scenario '{}' must assert final state or unchanged status for '{}'",
                scenario.name,
                label(key, labels)
            ));
        }
        if !labels.contains_key(key) || device.name.trim().is_empty() {
            return Err(eyre!(
                "scenario '{}' requires a display name for every simulated device",
                scenario.name
            ));
        }
    }
    let mut covered_helpers = HashSet::new();
    for helper in &scenario.expect.unchanged_helpers {
        if !scenario.initial_helpers.contains_key(helper) {
            return Err(eyre!(
                "scenario '{}' expects helper '{}' to remain unchanged but has no initial value for it",
                scenario.name,
                helper
            ));
        }
        if !covered_helpers.insert(helper) {
            return Err(eyre!(
                "scenario '{}' asserts helper '{}' more than once",
                scenario.name,
                helper
            ));
        }
    }
    for helper in scenario.expect.final_helpers.keys() {
        if !scenario.initial_helpers.contains_key(helper) {
            return Err(eyre!(
                "scenario '{}' expects a final value for helper '{}' but has no initial value for it",
                scenario.name,
                helper
            ));
        }
        if !covered_helpers.insert(helper) {
            return Err(eyre!(
                "scenario '{}' asserts helper '{}' more than once",
                scenario.name,
                helper
            ));
        }
    }
    for helper in scenario.initial_helpers.keys() {
        if !covered_helpers.contains(helper) {
            return Err(eyre!(
                "scenario '{}' must assert the final value or unchanged status for helper '{}'",
                scenario.name,
                helper
            ));
        }
    }
    Ok(())
}

fn compare_commands(
    expected: &[ExpectedCommand],
    actual: &[RecordedCommand],
    labels: &HashMap<DeviceKey, String>,
    failures: &mut Vec<String>,
) {
    let expected = expected
        .iter()
        .map(|command| match command {
            ExpectedCommand::DeviceState { device, state } => RecordedCommand::DeviceState {
                device: device.clone(),
                state: state.clone(),
            },
            ExpectedCommand::IntegrationAction {
                integration_id,
                payload,
            } => RecordedCommand::IntegrationAction {
                integration_id: integration_id.clone(),
                payload: payload.clone(),
            },
        })
        .collect::<Vec<_>>();
    let expected_sequences = command_sequences(expected.iter());
    let actual_sequences = command_sequences(actual.iter());
    if expected_sequences != actual_sequences {
        let expected_text = expected_sequences
            .values()
            .flatten()
            .map(|command| describe_command(command, labels))
            .collect::<Vec<_>>();
        let actual_text = actual_sequences
            .values()
            .flatten()
            .map(|command| describe_command(command, labels))
            .collect::<Vec<_>>();
        failures.push(format!(
            "outbound commands differ (order is significant per target)\n      expected: {}\n      actual:   {}",
            serde_json::to_string(&expected_text).unwrap_or_default(),
            serde_json::to_string(&actual_text).unwrap_or_default()
        ));
    }
}

fn command_sequences<'a>(
    commands: impl IntoIterator<Item = &'a RecordedCommand>,
) -> BTreeMap<String, Vec<RecordedCommand>> {
    let mut sequences = BTreeMap::new();
    for command in commands {
        let target = match command {
            RecordedCommand::DeviceState { device, .. } => {
                format!("device:{}/{}", device.integration_id, device.device_id)
            }
            RecordedCommand::IntegrationAction { integration_id, .. } => {
                format!("integration:{integration_id}")
            }
        };
        sequences
            .entry(target)
            .or_insert_with(Vec::new)
            .push(command.clone());
    }
    sequences
}

fn compare_final_state(
    state: &AppState,
    expected: &[ExpectedDeviceState],
    labels: &HashMap<DeviceKey, String>,
    failures: &mut Vec<String>,
) {
    for expected in expected {
        let key = expected.device();
        let Some(actual) = state.devices.get_device(key) else {
            failures.push(format!(
                "{} is missing from final state",
                label(key, labels)
            ));
            continue;
        };
        let matches = match (expected, &actual.data) {
            (ExpectedDeviceState::Light { state, .. }, DeviceData::Controllable(light)) => {
                *state == LightState::from_controllable(&light.state)
            }
            (ExpectedDeviceState::Sensor { value, .. }, DeviceData::Sensor(sensor)) => {
                value == &SensorValue::from_sensor(sensor)
            }
            _ => false,
        };
        if !matches {
            failures.push(format!(
                "{} final state did not match expectation",
                label(key, labels)
            ));
        }
    }
}

fn compare_unchanged(
    initial: &BTreeMap<DeviceKey, Device>,
    state: &AppState,
    unchanged: &[DeviceKey],
    labels: &HashMap<DeviceKey, String>,
    failures: &mut Vec<String>,
) {
    for key in unchanged {
        let before = initial.get(key);
        let after = state.devices.get_device(key);
        if !matches!((before, after), (Some(before), Some(after)) if before.is_state_eq(after)) {
            failures.push(format!(
                "{} changed but was expected to remain untouched",
                label(key, labels)
            ));
        }
    }
}

fn snapshot_helpers(state: &AppState, names: &HashSet<String>) -> HashMap<String, Value> {
    names
        .iter()
        .filter_map(|name| {
            state
                .helpers
                .value(&HelperId(name.clone()))
                .cloned()
                .map(|value| (name.clone(), value))
        })
        .collect()
}

fn compare_helpers(
    initial: &HashMap<String, Value>,
    state: &AppState,
    expected: &HashMap<String, Value>,
    unchanged: &[String],
    failures: &mut Vec<String>,
) {
    for (id, expected_value) in expected {
        let actual = state.helpers.value(&HelperId(id.clone()));
        if actual != Some(expected_value) {
            failures.push(format!(
                "helper '{}' final value did not match expectation",
                helper_label(state, id)
            ));
        }
    }
    for id in unchanged {
        let before = initial.get(id);
        let after = state.helpers.value(&HelperId(id.clone()));
        if before != after {
            failures.push(format!(
                "helper '{}' changed but was expected to remain unchanged",
                helper_label(state, id)
            ));
        }
    }
}

fn helper_label(state: &AppState, id: &str) -> String {
    state
        .helpers
        .definition(&HelperId(id.to_string()))
        .map(|definition| definition.name.clone())
        .unwrap_or_else(|| id.to_string())
}

fn describe_command(command: &RecordedCommand, labels: &HashMap<DeviceKey, String>) -> String {
    match command {
        RecordedCommand::DeviceState { device, state } => format!(
            "{} -> power={}, brightness={:?}, color={:?}, transition={:?}",
            label(device, labels),
            state.power,
            state.brightness,
            state.color,
            state.transition
        ),
        RecordedCommand::IntegrationAction { integration_id, .. } => {
            format!("integration action {integration_id} (payload redacted)")
        }
    }
}

fn label(key: &DeviceKey, labels: &HashMap<DeviceKey, String>) -> String {
    labels
        .get(key)
        .cloned()
        .unwrap_or_else(|| key.device_id.to_string())
}

impl ScenarioDevice {
    fn key(&self) -> DeviceKey {
        match self {
            Self::Light { device, .. } | Self::Sensor { device, .. } => device.clone(),
        }
    }

    fn to_device(&self, seed: Option<&ScenarioDeviceSeed>) -> Result<Device> {
        match self {
            Self::Light {
                device,
                name,
                power,
                brightness,
                color,
                transition,
                capabilities,
            } => {
                let (resolved_name, resolved_capabilities) = match seed {
                    Some(ScenarioDeviceSeed::Light {
                        name: seed_name,
                        capabilities: seed_capabilities,
                        ..
                    }) => {
                        if name.as_ref().is_some_and(|name| name != seed_name) {
                            return Err(eyre!(
                                "scenario device '{}' name conflicts with the suite device catalog",
                                seed_name
                            ));
                        }
                        if capabilities
                            .as_ref()
                            .is_some_and(|capabilities| capabilities != seed_capabilities)
                        {
                            return Err(eyre!(
                                "scenario device '{}' capabilities conflict with the suite device catalog",
                                seed_name
                            ));
                        }
                        (seed_name.clone(), seed_capabilities.clone())
                    }
                    Some(ScenarioDeviceSeed::Sensor {
                        name: seed_name, ..
                    }) => {
                        return Err(eyre!(
                            "scenario device '{}' is a light but the suite device catalog defines it as a sensor",
                            seed_name
                        ));
                    }
                    None => (
                        name.clone().ok_or_else(|| {
                            eyre!(
                                "legacy scenario device '{}' is missing its name",
                                device_key_label(device)
                            )
                        })?,
                        capabilities.clone().unwrap_or_default(),
                    ),
                };
                Ok(Device::new(
                    device.integration_id.clone(),
                    device.device_id.clone(),
                    resolved_name,
                    DeviceData::Controllable(ControllableDevice::new(
                        None,
                        *power,
                        *brightness,
                        color.clone(),
                        *transition,
                        resolved_capabilities,
                        ManageKind::Unmanaged,
                    )),
                    None,
                ))
            }
            Self::Sensor {
                device,
                name,
                value,
            } => {
                let resolved_name = match seed {
                    Some(ScenarioDeviceSeed::Sensor {
                        name: seed_name, ..
                    }) => {
                        if name.as_ref().is_some_and(|name| name != seed_name) {
                            return Err(eyre!(
                                "scenario device '{}' name conflicts with the suite device catalog",
                                seed_name
                            ));
                        }
                        seed_name.clone()
                    }
                    Some(ScenarioDeviceSeed::Light {
                        name: seed_name, ..
                    }) => {
                        return Err(eyre!(
                            "scenario device '{}' is a sensor but the suite device catalog defines it as a light",
                            seed_name
                        ));
                    }
                    None => name.clone().ok_or_else(|| {
                        eyre!(
                            "legacy scenario device '{}' is missing its name",
                            device_key_label(device)
                        )
                    })?,
                };
                Ok(Device::new(
                    device.integration_id.clone(),
                    device.device_id.clone(),
                    resolved_name,
                    DeviceData::Sensor(value.to_sensor()?),
                    None,
                ))
            }
        }
    }
}

impl ScenarioDeviceSeed {
    fn identity(&self) -> (&DeviceKey, &str) {
        match self {
            Self::Light { device, name, .. } | Self::Sensor { device, name, .. } => (device, name),
        }
    }
}

fn device_key_label(device: &DeviceKey) -> String {
    format!("{}/{}", device.integration_id, device.device_id)
}

impl SensorValue {
    fn kind(&self) -> SensorValueKind {
        match self {
            Self::Boolean(_) => SensorValueKind::Boolean,
            Self::Number(_) => SensorValueKind::Number,
            Self::Text(_) => SensorValueKind::Text,
        }
    }

    fn to_sensor(&self) -> Result<SensorDevice> {
        Ok(match self {
            Self::Boolean(value) => SensorDevice::Boolean { value: *value },
            Self::Number(value) => SensorDevice::Number { value: *value },
            Self::Text(value) => SensorDevice::Text {
                value: value.clone(),
            },
        })
    }

    fn from_sensor(sensor: &SensorDevice) -> Self {
        match sensor {
            SensorDevice::Boolean { value } => Self::Boolean(*value),
            SensorDevice::Number { value } => Self::Number(*value),
            SensorDevice::Text { value } => Self::Text(value.clone()),
            SensorDevice::Color(state) => Self::Text(format!("color:{state:?}")),
        }
    }
}

impl SensorValueKind {
    fn from_sensor(sensor: &SensorDevice) -> Option<Self> {
        match sensor {
            SensorDevice::Boolean { .. } => Some(Self::Boolean),
            SensorDevice::Number { .. } => Some(Self::Number),
            SensorDevice::Text { .. } => Some(Self::Text),
            SensorDevice::Color(_) => None,
        }
    }
}

impl LightState {
    fn from_controllable(state: &ControllableState) -> Self {
        Self {
            power: state.power,
            brightness: state.brightness.map(|value| value.0),
            color: state.color.clone(),
            transition: state.transition.map(|value| value.0),
        }
    }
}

impl ExpectedDeviceState {
    fn device(&self) -> &DeviceKey {
        match self {
            Self::Light { device, .. } | Self::Sensor { device, .. } => device,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensor_values_convert_without_loss() {
        assert_eq!(
            SensorValue::Text("off".to_string()).to_sensor().unwrap(),
            SensorDevice::Text {
                value: "off".to_string()
            }
        );
    }

    #[test]
    fn light_command_comparison_includes_brightness_and_power() {
        let expected = LightState {
            power: true,
            brightness: Some(0.25),
            color: None,
            transition: None,
        };
        assert_eq!(expected, expected.clone());
        assert_ne!(
            expected,
            LightState {
                power: true,
                brightness: Some(0.75),
                color: None,
                transition: None,
            }
        );
    }

    #[test]
    fn integration_action_diagnostics_redact_payloads() {
        let command = RecordedCommand::IntegrationAction {
            integration_id: "synthetic".to_string(),
            payload: Value::String("private-test-payload".to_string()),
        };
        let output = describe_command(&command, &HashMap::new());

        assert!(!output.contains("private-test-payload"));
        assert!(output.contains("payload redacted"));
    }

    #[test]
    fn command_comparison_ignores_inter_target_order_but_preserves_target_order() {
        let first: DeviceKey = serde_json::from_value(Value::String("sim/first".into())).unwrap();
        let second: DeviceKey = serde_json::from_value(Value::String("sim/second".into())).unwrap();
        let off = LightState {
            power: false,
            brightness: Some(0.5),
            color: None,
            transition: None,
        };
        let on = LightState {
            power: true,
            ..off.clone()
        };
        let expected = vec![
            ExpectedCommand::DeviceState {
                device: first.clone(),
                state: off.clone(),
            },
            ExpectedCommand::DeviceState {
                device: second.clone(),
                state: off.clone(),
            },
            ExpectedCommand::DeviceState {
                device: first.clone(),
                state: on.clone(),
            },
        ];
        let actual = vec![
            RecordedCommand::DeviceState {
                device: second.clone(),
                state: off.clone(),
            },
            RecordedCommand::DeviceState {
                device: first.clone(),
                state: off.clone(),
            },
            RecordedCommand::DeviceState {
                device: first.clone(),
                state: on.clone(),
            },
        ];
        let mut failures = Vec::new();

        compare_commands(&expected, &actual, &HashMap::new(), &mut failures);
        assert!(failures.is_empty(), "{failures:#?}");

        let reversed_for_same_target = vec![
            RecordedCommand::DeviceState {
                device: first.clone(),
                state: on,
            },
            RecordedCommand::DeviceState {
                device: second,
                state: off.clone(),
            },
            RecordedCommand::DeviceState {
                device: first,
                state: off,
            },
        ];
        compare_commands(
            &expected,
            &reversed_for_same_target,
            &HashMap::new(),
            &mut failures,
        );
        assert_eq!(failures.len(), 1, "same-target command order must matter");
    }
}
