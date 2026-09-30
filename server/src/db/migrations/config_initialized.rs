use crate::db::schema::CoreConfig;
use sea_orm_migration::prelude::*;

pub struct ConfigInitialized;
impl MigrationName for ConfigInitialized {
    fn name(&self) -> &str {
        "m20260930000002_config_initialized"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for ConfigInitialized {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(CoreConfig::Table)
                    .add_column(
                        ColumnDef::new(CoreConfig::Initialized)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(CoreConfig::Table)
                    .drop_column(CoreConfig::Initialized)
                    .to_owned(),
            )
            .await
    }
}
