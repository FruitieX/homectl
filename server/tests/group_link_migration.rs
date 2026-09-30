use homectl_server::db::migrations::Migrator;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use sea_orm_migration::MigratorTrait;

async fn execute(db: &DatabaseConnection, sql: &str) {
    db.execute_raw(Statement::from_string(db.get_database_backend(), sql))
        .await
        .unwrap();
}
async fn links(db: &DatabaseConnection) -> Vec<(String, String, Option<i32>)> {
    db.query_all_raw(Statement::from_string(db.get_database_backend(),
        "SELECT parent_group_id, child_group_id, sort_order FROM group_links ORDER BY parent_group_id, sort_order"))
        .await.unwrap().into_iter().map(|r| (r.try_get("", "parent_group_id").unwrap(), r.try_get("", "child_group_id").unwrap(), r.try_get("", "sort_order").unwrap())).collect()
}
async fn verify(db: DatabaseConnection) {
    let index = Migrator::migrations()
        .iter()
        .position(|m| m.name() == "m20260930000000_repairable_group_links")
        .unwrap();
    Migrator::up(&db, Some(index as u32)).await.unwrap();
    for sql in [
        "INSERT INTO groups (id,name,hidden) VALUES ('parent','Parent',false),('child','Child',false),('other','Other',true)",
        "INSERT INTO group_links (parent_group_id,child_group_id,sort_order) VALUES ('parent','child',2),('parent','other',1)",
    ] { execute(&db, sql).await; }
    let original = links(&db).await;
    Migrator::up(&db, Some(1)).await.unwrap();
    assert_eq!(links(&db).await, original);
    // Child deletion must leave a reference for the editor to repair.
    execute(&db, "DELETE FROM groups WHERE id='child'").await;
    assert_eq!(links(&db).await, original);
    execute(&db,"INSERT INTO group_links (parent_group_id,child_group_id,sort_order) VALUES ('parent','missing',3)").await;
    let unresolved = links(&db).await;
    assert_eq!(unresolved.len(), 3);
    // A downgrade cannot silently remove these references.
    assert!(Migrator::down(&db, Some(1)).await.is_err());
    assert_eq!(links(&db).await, unresolved);
    // Repair makes downgrade safe. A second upgrade checks renamed PK/index names.
    execute(&db,"INSERT INTO groups (id,name,hidden) VALUES ('child','Child',false),('missing','Recovered',false)").await;
    Migrator::down(&db, Some(1)).await.unwrap();
    assert_eq!(links(&db).await, unresolved);
    Migrator::up(&db, Some(1)).await.unwrap();
    assert_eq!(links(&db).await, unresolved);
    assert!(db.execute_raw(Statement::from_string(db.get_database_backend(),
        "INSERT INTO group_links (parent_group_id,child_group_id,sort_order) VALUES ('absent-parent','missing',0)")).await.is_err());
    assert!(db.execute_raw(Statement::from_string(db.get_database_backend(),
        "INSERT INTO group_links (parent_group_id,child_group_id,sort_order) VALUES ('parent','missing',4)")).await.is_err());
    execute(&db, "DELETE FROM groups WHERE id='parent'").await;
    assert!(links(&db).await.is_empty());
    db.close().await.unwrap();
}
#[tokio::test]
async fn sqlite_group_links_remain_repairable() {
    verify(Database::connect("sqlite::memory:").await.unwrap()).await;
}
#[test]
fn postgres_group_links_remain_repairable() {
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
