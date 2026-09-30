use sea_orm::{ConnectionTrait, Statement, TransactionTrait};
use sea_orm_migration::prelude::*;

pub(super) struct RepairableGroupLinks;

impl MigrationName for RepairableGroupLinks {
    fn name(&self) -> &str {
        "m20260930000000_repairable_group_links"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for RepairableGroupLinks {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        rebuild(manager, false).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A downgrade with unresolved children fails transactionally, leaving
        // the current table intact. Never delete user references to downgrade.
        rebuild(manager, true).await
    }
}

async fn rebuild(manager: &SchemaManager<'_>, require_child: bool) -> Result<(), DbErr> {
    let db = manager.get_connection();
    let txn = db.begin().await?;
    let backend = db.get_database_backend();
    // Rebuilding also supports SQLite, whose ALTER TABLE cannot drop an FK.
    // Separate names allow repeated up/down on PostgreSQL, where the renamed
    // table retains its automatically named primary-key index.
    let temporary = if require_child {
        "group_links_v1"
    } else {
        "group_links_v2"
    };
    let child_constraint = if require_child {
        ", FOREIGN KEY (child_group_id) REFERENCES groups(id) ON DELETE CASCADE"
    } else {
        ""
    };
    for sql in [
        format!("CREATE TABLE {temporary} (parent_group_id TEXT NOT NULL, child_group_id TEXT NOT NULL, sort_order INTEGER DEFAULT 0, PRIMARY KEY (parent_group_id, child_group_id), FOREIGN KEY (parent_group_id) REFERENCES groups(id) ON DELETE CASCADE{child_constraint})"),
        format!("INSERT INTO {temporary} (parent_group_id, child_group_id, sort_order) SELECT parent_group_id, child_group_id, sort_order FROM group_links"),
        "DROP TABLE group_links".into(),
        format!("ALTER TABLE {temporary} RENAME TO group_links"),
        "CREATE INDEX idx_group_links_parent ON group_links(parent_group_id)".into(),
        "CREATE INDEX idx_group_links_child ON group_links(child_group_id)".into(),
    ] {
        txn.execute_raw(Statement::from_string(backend, sql)).await?;
    }
    txn.commit().await
}
