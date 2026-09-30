use homectl_server::db::migrations::Migrator;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use sea_orm_migration::MigratorTrait;

async fn verify(db: DatabaseConnection) {
    let index = Migrator::migrations()
        .iter()
        .position(|m| m.name() == "m20260930000001_device_calibration_brightness")
        .unwrap();
    Migrator::up(&db, Some(index as u32)).await.unwrap();
    let points = r#"[{"reference":{"u":0.2,"v":0.47},"output":{"u":0.21,"v":0.48}},{"reference":{"u":0.3,"v":0.52},"output":{"u":0.29,"v":0.51}}]"#;
    db.execute_raw(Statement::from_string(db.get_database_backend(),format!("INSERT INTO device_color_calibrations (device_key,points) VALUES ('fixture/lamp','{points}')"))).await.unwrap();
    Migrator::up(&db, Some(1)).await.unwrap();
    let row = db.query_one_raw(Statement::from_string(db.get_database_backend(),"SELECT points,brightness_points FROM device_color_calibrations WHERE device_key='fixture/lamp'")).await.unwrap().unwrap();
    assert_eq!(row.try_get::<String>("", "points").unwrap(), points);
    assert_eq!(
        row.try_get::<String>("", "brightness_points").unwrap(),
        "[]"
    );
    Migrator::down(&db, Some(1)).await.unwrap();
    Migrator::up(&db, Some(1)).await.unwrap();
    let row = db.query_one_raw(Statement::from_string(db.get_database_backend(),"SELECT points,brightness_points FROM device_color_calibrations WHERE device_key='fixture/lamp'")).await.unwrap().unwrap();
    assert_eq!(row.try_get::<String>("", "points").unwrap(), points);
    assert_eq!(
        row.try_get::<String>("", "brightness_points").unwrap(),
        "[]"
    );
    // The following bootstrap marker migration must preserve existing core
    // values and use a portable SQL boolean on both supported backends.
    Migrator::up(&db, None).await.unwrap();
    let row = db
        .query_one_raw(Statement::from_string(
            db.get_database_backend(),
            "SELECT initialized FROM core_config WHERE id=1",
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(!row.try_get::<bool>("", "initialized").unwrap());
    db.execute_raw(Statement::from_string(
        db.get_database_backend(),
        "UPDATE core_config SET initialized=true WHERE id=1",
    ))
    .await
    .unwrap();
    let row = db
        .query_one_raw(Statement::from_string(
            db.get_database_backend(),
            "SELECT initialized FROM core_config WHERE id=1",
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(row.try_get::<bool>("", "initialized").unwrap());
    db.close().await.unwrap();
}

#[tokio::test]
async fn sqlite_existing_color_calibration_survives_brightness_migration() {
    verify(Database::connect("sqlite::memory:").await.unwrap()).await;
}

#[test]
fn postgres_existing_color_calibration_survives_brightness_migration() {
    use testcontainers::core::IntoContainerPort;
    use testcontainers::runners::SyncRunner;
    use testcontainers_modules::postgres::Postgres;
    let container = Postgres::default().start().expect("postgres should start");
    let port = container.get_host_port_ipv4(5432.tcp()).unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        verify(
            Database::connect(format!(
                "postgres://postgres:postgres@127.0.0.1:{port}/postgres"
            ))
            .await
            .unwrap(),
        )
        .await;
    });
}
