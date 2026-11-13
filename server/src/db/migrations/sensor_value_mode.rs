use crate::db::schema::Integrations;
use sea_orm::{ConnectionTrait, StatementBuilder};
use sea_orm_migration::prelude::*;

/// Generic MQTT now keeps every listed `sensor_value_fields` value by default
/// (`sensor_value_mode = "all"`). Existing MQTT integrations listing several
/// fields used them as a first-present fallback, so they are pinned to
/// `"first"` and keep decoding exactly as before.
pub struct PinSensorValueMode;

impl MigrationName for PinSensorValueMode {
    fn name(&self) -> &str {
        "m20261113000000_pin_sensor_value_mode"
    }
}

/// The config with `sensor_value_mode = "first"` added, or `None` when it
/// needs no change.
pub(super) fn pinned_config(config: &str) -> Option<String> {
    let mut config: serde_json::Value = serde_json::from_str(config).ok()?;
    let object = config.as_object_mut()?;
    let several_fields = object
        .get("sensor_value_fields")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|fields| fields.len() > 1);
    if !several_fields || object.contains_key("sensor_value_mode") {
        return None;
    }
    object.insert("sensor_value_mode".to_string(), "first".into());
    serde_json::to_string(&config).ok()
}

#[async_trait::async_trait]
impl MigrationTrait for PinSensorValueMode {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        let select = Query::select()
            .columns([Integrations::Id, Integrations::Config])
            .from(Integrations::Table)
            .and_where(Expr::col(Integrations::Plugin).eq("mqtt"))
            .to_owned();
        for row in db
            .query_all_raw(StatementBuilder::build(&select, &backend))
            .await?
        {
            let id: String = row.try_get("", "id")?;
            let config: String = row.try_get("", "config")?;
            let Some(config) = pinned_config(&config) else {
                continue;
            };
            let update = Query::update()
                .table(Integrations::Table)
                .value(Integrations::Config, config)
                .and_where(Expr::col(Integrations::Id).eq(id))
                .to_owned();
            db.execute_raw(StatementBuilder::build(&update, &backend))
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // `"first"` is the old behaviour, so the pinned value can stay.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::Migrator;
    use sea_orm::{Database, DbBackend, Statement};

    #[tokio::test]
    async fn existing_mqtt_rows_with_several_fields_are_pinned_to_first() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let before = (Migrator::migrations().len() - 1) as u32;
        Migrator::up(&db, Some(before)).await.unwrap();
        db.execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            r#"INSERT INTO integrations (id, plugin, config) VALUES
               ('z2m', 'mqtt', '{"sensor_value_fields":["/action","/occupancy"]}'),
               ('plain', 'mqtt', '{"sensor_value_fields":["/temperature"]}'),
               ('other', 'dummy', '{"sensor_value_fields":["/a","/b"]}')"#,
        ))
        .await
        .unwrap();

        Migrator::up(&db, None).await.unwrap();

        let config = |id: &'static str| {
            let db = &db;
            async move {
                let row = db
                    .query_one_raw(Statement::from_string(
                        DbBackend::Sqlite,
                        format!("SELECT config FROM integrations WHERE id = '{id}'"),
                    ))
                    .await
                    .unwrap()
                    .unwrap();
                serde_json::from_str::<serde_json::Value>(
                    &row.try_get::<String>("", "config").unwrap(),
                )
                .unwrap()
            }
        };
        assert_eq!(config("z2m").await["sensor_value_mode"], "first");
        assert!(config("plain").await.get("sensor_value_mode").is_none());
        assert!(config("other").await.get("sensor_value_mode").is_none());
    }

    #[test]
    fn pins_only_unset_lists_of_several_fields() {
        let pinned = pinned_config(r#"{"sensor_value_fields":["/action","/occupancy"]}"#).unwrap();
        let pinned: serde_json::Value = serde_json::from_str(&pinned).unwrap();
        assert_eq!(pinned["sensor_value_mode"], "first");
        assert_eq!(pinned["sensor_value_fields"][1], "/occupancy");

        for unchanged in [
            r#"{}"#,
            r#"{"sensor_value_fields":["/temperature"]}"#,
            r#"{"sensor_value_fields":["/a","/b"],"sensor_value_mode":"all"}"#,
            "not json",
        ] {
            assert_eq!(pinned_config(unchanged), None, "{unchanged}");
        }
    }
}
