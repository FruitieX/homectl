use crate::{
    core::snapshot::{RuntimeSnapshot, SnapshotChanges},
    db::{get_db_connection, schema::StateLoggerEvents},
    types::{
        device::Device,
        integration::{Integration, IntegrationId},
    },
    utils::cli::Cli,
};
use async_trait::async_trait;
use chrono::Utc;
use color_eyre::{eyre::Context, Result};
use eyre::eyre;
use jsonptr::PointerBuf;
use once_cell::sync::OnceCell;
use regex::Regex;
use sea_orm::sea_query::Query;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, Statement, StatementBuilder,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
enum PatternMatchMode {
    #[default]
    Glob,
    Regex,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StateLoggerConfig {
    source_integration_id: IntegrationId,
    device_name_pattern: String,
    #[serde(default)]
    match_mode: PatternMatchMode,
    #[serde(default)]
    postgresql_url: Option<String>,
    value_path: PointerBuf,
}

enum StateLoggerDatabase {
    Shared,
    Dedicated {
        postgres_url: String,
        connection: OnceCell<Result<DatabaseConnection, String>>,
    },
}

pub struct StateLogger {
    id: IntegrationId,
    config: StateLoggerConfig,
    compiled_pattern: Regex,
    database: StateLoggerDatabase,
}

#[async_trait]
impl Integration for StateLogger {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        _event_tx: crate::types::event::TxEventChannel,
    ) -> Result<Self> {
        let config: StateLoggerConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of StateLogger integration")?;
        let compiled_pattern = compile_pattern(&config.device_name_pattern, config.match_mode)
            .wrap_err("Failed to compile device name pattern for StateLogger integration")?;
        let database = match &config.postgresql_url {
            Some(postgres_url) => StateLoggerDatabase::Dedicated {
                postgres_url: postgres_url.clone(),
                connection: OnceCell::new(),
            },
            None => StateLoggerDatabase::Shared,
        };

        info!(
            "state_logger[{logger_id}] loaded from config: source_integration_id={source_integration_id} match_mode={match_mode:?} device_name_pattern={device_name_pattern:?} value_path={value_path} postgres_source={postgres_source}",
            logger_id = id,
            source_integration_id = config.source_integration_id,
            match_mode = config.match_mode,
            device_name_pattern = config.device_name_pattern,
            value_path = config.value_path,
            postgres_source = if config.postgresql_url.is_some() {
                "state_logger config option postgresql_url"
            } else {
                "DATABASE_URL"
            },
        );

        Ok(Self {
            id: id.clone(),
            config,
            compiled_pattern,
            database,
        })
    }

    async fn register(&mut self) -> Result<()> {
        if self.ensure_database_connection().await.is_ok() {
            info!(
                "state_logger[{logger_id}] PostgreSQL connection established using {source}",
                logger_id = self.id,
                source = self.database_source_label(),
            );
        }

        Ok(())
    }

    async fn on_runtime_state_change(
        &mut self,
        previous: &RuntimeSnapshot,
        current: &RuntimeSnapshot,
        changes: SnapshotChanges,
    ) -> Result<()> {
        if !changes.devices && !changes.flattened_scenes && !changes.flattened_groups {
            debug!(
                "state_logger[{logger_id}] skipping runtime snapshot change: no relevant device/group/scene updates",
                logger_id = self.id,
            );
            return Ok(());
        }

        let db = match self.ensure_database_connection().await {
            Ok(db) => db,
            Err(_) => return Ok(()),
        };

        let previous_devices = &previous.devices.0;
        for (device_key, current_device) in &current.devices.0 {
            if current_device.integration_id != self.config.source_integration_id {
                debug!(
                    "state_logger[{logger_id}] ignoring {device_key} from integration {device_integration_id}: expecting {expected_integration_id}",
                    logger_id = self.id,
                    device_integration_id = current_device.integration_id,
                    expected_integration_id = self.config.source_integration_id,
                );
                continue;
            }

            if !self.compiled_pattern.is_match(&current_device.name) {
                debug!(
                    "state_logger[{logger_id}] ignoring {device_key} name={device_name:?}: pattern did not match",
                    logger_id = self.id,
                    device_name = current_device.name,
                );
                continue;
            }

            let current_value = select_value(current_device, &self.config.value_path);
            let previous_value = previous_devices
                .get(device_key)
                .and_then(|device| select_value(device, &self.config.value_path));

            if previous_value == current_value {
                debug!(
                    "state_logger[{logger_id}] matched {device_key} name={device_name:?} but value at {value_path} did not change",
                    logger_id = self.id,
                    device_name = current_device.name,
                    value_path = self.config.value_path,
                );
                continue;
            }

            info!(
                "state_logger[{logger_id}] {device_key} name={device_name:?} path={value_path} previous={previous_value:?} current={current_value:?}",
                logger_id = self.id,
                device_key = device_key,
                device_name = current_device.name,
                value_path = self.config.value_path,
            );

            if let Err(error) =
                insert_state_logger_event_row(db, current_device, current_value).await
            {
                warn!(
                    "state_logger[{logger_id}] failed to write event row for {device_key}: {error}",
                    logger_id = self.id,
                );
            }
        }

        Ok(())
    }
}

fn select_value(device: &Device, path: &PointerBuf) -> Option<serde_json::Value> {
    path.as_ref().resolve(&device.get_value()).ok().cloned()
}

fn to_numeric_value(value: Option<&serde_json::Value>) -> Option<f64> {
    match value? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    }
}

fn statement<C, S>(db: &C, builder: S) -> Statement
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    db.get_database_backend().build(&builder)
}

fn device_kind(device: &Device) -> &'static str {
    if device.is_sensor() {
        "sensor"
    } else {
        "device"
    }
}

async fn insert_state_logger_event_row(
    db: &DatabaseConnection,
    device: &Device,
    selected_value: Option<serde_json::Value>,
) -> Result<()> {
    let device_state_json = device.get_value().to_string();
    let value = to_numeric_value(selected_value.as_ref());
    let created_at = Utc::now();

    db.execute(statement(
        db,
        Query::insert()
            .into_table(StateLoggerEvents::Table)
            .columns([
                StateLoggerEvents::DeviceKey,
                StateLoggerEvents::IntegrationId,
                StateLoggerEvents::DeviceId,
                StateLoggerEvents::DeviceName,
                StateLoggerEvents::DeviceKind,
                StateLoggerEvents::EventKind,
                StateLoggerEvents::DeviceStateJson,
                StateLoggerEvents::Value,
                StateLoggerEvents::CreatedAt,
            ])
            .values_panic([
                device.get_device_key().to_string().into(),
                device.integration_id.to_string().into(),
                device.id.to_string().into(),
                device.name.clone().into(),
                device_kind(device).into(),
                "state_logger".into(),
                device_state_json.into(),
                value.into(),
                created_at.into(),
            ])
            .to_owned(),
    ))
    .await?;

    Ok(())
}

impl StateLogger {
    fn database_source_label(&self) -> &'static str {
        match self.database {
            StateLoggerDatabase::Shared => "HomeCTL shared PG connection",
            StateLoggerDatabase::Dedicated { .. } => "state_logger config option `postgresql_url`",
        }
    }

    async fn ensure_database_connection(&self) -> Result<&DatabaseConnection> {
        match &self.database {
            StateLoggerDatabase::Shared => Ok(get_db_connection()?),
            StateLoggerDatabase::Dedicated {
                postgres_url,
                connection,
            } => {
                if let Some(connection_result) = connection.get() {
                    return connection_result
                        .as_ref()
                        .map_err(|error| eyre!(error.clone()));
                }

                let mut options = ConnectOptions::new(postgres_url.clone());
                options.acquire_timeout(Duration::from_secs(2));

                let result: Result<DatabaseConnection, String> = async {
                    let database_connection = Database::connect(options).await?;
                    // Ensure the state_logger_events table exists in the dedicated
                    // database by running only the StateLoggerEvents migration.
                    crate::db::migrations::ensure_state_logger_events_on_connection(
                        &database_connection,
                    )
                    .await?;

                    Ok(database_connection)
                }
                .await
                .map_err(|error: color_eyre::Report| error.to_string());

                if let Err(error) = &result {
                    warn!(
                        "state_logger[{logger_id}] PostgreSQL connection could not be made using {source}: {error}",
                        logger_id = self.id,
                        source = self.database_source_label(),
                    );
                }

                let _ = connection.set(result);

                connection
                    .get()
                    .expect("dedicated connection result should be set")
                    .as_ref()
                    .map_err(|error| eyre!(error.clone()))
            }
        }
    }
}

fn compile_pattern(pattern: &str, mode: PatternMatchMode) -> Result<Regex> {
    let regex = match mode {
        PatternMatchMode::Regex => pattern.to_string(),
        PatternMatchMode::Glob => glob_to_regex(pattern),
    };

    Regex::new(&regex).map_err(Into::into)
}

fn glob_to_regex(pattern: &str) -> String {
    // Do not anchor the generated regex by default. Let callers include
    // explicit start/end anchors or wildcards in the pattern when desired.
    let mut regex = String::new();
    for character in pattern.chars() {
        match character {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\' => {
                regex.push('\\');
                regex.push(character);
            }
            other => regex.push(other),
        }
    }
    regex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matches_substring_by_default() {
        let re = compile_pattern("temp", PatternMatchMode::Glob).unwrap();
        assert!(re.is_match("my-temp-device"));
        assert!(re.is_match("temperature"));
        // spaces in device names should match too
        assert!(re.is_match("my temp device"));
        assert!(re.is_match("temp sensor"));
    }

    #[test]
    fn glob_wildcards() {
        let re = compile_pattern("sensor-*", PatternMatchMode::Glob).unwrap();
        assert!(re.is_match("sensor-1"));
        // Unanchored patterns match substrings by default
        assert!(re.is_match("prefix-sensor-1"));
        assert!(!re.is_match("sensr-1"));
        // wildcard should also match when device name contains spaces
        let re2 = compile_pattern("sensor *", PatternMatchMode::Glob).unwrap();
        assert!(re2.is_match("sensor lamp"));
        assert!(re2.is_match("prefix sensor lamp"));
    }

    #[test]
    fn glob_question_mark() {
        let re = compile_pattern("dev?ce", PatternMatchMode::Glob).unwrap();
        assert!(re.is_match("device"));
        assert!(re.is_match("devXce"));
        assert!(!re.is_match("devce"));
        // question mark matches a single character including space
        let re2 = compile_pattern("dev?ce", PatternMatchMode::Glob).unwrap();
        assert!(re2.is_match("dev ce"));
    }

    #[test]
    fn regex_mode_respects_anchors() {
        let re = compile_pattern("^sensor-\\d+$", PatternMatchMode::Regex).unwrap();
        assert!(re.is_match("sensor-123"));
        assert!(!re.is_match("prefix-sensor-123"));
        // regex anchors also handle spaces explicitly
        let re2 = compile_pattern("^living room .+$", PatternMatchMode::Regex).unwrap();
        assert!(re2.is_match("living room lamp"));
        assert!(!re2.is_match("my living room lamp"));
        let re3 = compile_pattern("living room*", PatternMatchMode::Regex).unwrap();
        assert!(re3.is_match("living room lamp"));
        assert!(re3.is_match("my living room lamp"));
    }
}
