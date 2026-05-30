use crate::db::schema::{
    ConfigVersions, CoreConfig, DashboardLayouts, DashboardWidgets, DeviceDisplayOverrides,
    DeviceSensorConfigs, Devices, Floorplans, GroupDevices, GroupLinks, GroupPositions, Groups,
    Integrations, Routines, SceneDeviceStates, SceneGroupStates, SceneOverrides, Scenes,
    StateDeviceEvents, StateLoggerEvents, UiState, WidgetSettings,
};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(M20260227000000Init),
            Box::new(M20260420000000DashboardWidgetSources),
            Box::new(M20260529000000StateLoggerEvents),
        ]
    }
}

struct M20260227000000Init;

impl MigrationName for M20260227000000Init {
    fn name(&self) -> &str {
        "m20260227000000_init"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260227000000Init {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_devices(manager).await?;
        create_core_config(manager).await?;
        seed_core_config(manager).await?;
        create_integrations(manager).await?;
        create_groups(manager).await?;
        create_group_devices(manager).await?;
        create_group_links(manager).await?;
        create_scenes(manager).await?;
        create_scene_device_states(manager).await?;
        create_scene_group_states(manager).await?;
        create_scene_overrides(manager).await?;
        create_routines(manager).await?;
        create_floorplans(manager).await?;
        create_group_positions(manager).await?;
        create_device_display_overrides(manager).await?;
        create_device_sensor_configs(manager).await?;
        create_dashboard_layouts(manager).await?;
        seed_default_dashboard_layout(manager).await?;
        create_dashboard_widgets(manager).await?;
        create_config_versions(manager).await?;
        create_ui_state(manager).await?;
        create_indexes(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            UiState::Table.into_iden(),
            ConfigVersions::Table.into_iden(),
            DashboardWidgets::Table.into_iden(),
            DashboardLayouts::Table.into_iden(),
            DeviceSensorConfigs::Table.into_iden(),
            DeviceDisplayOverrides::Table.into_iden(),
            GroupPositions::Table.into_iden(),
            Floorplans::Table.into_iden(),
            Routines::Table.into_iden(),
            SceneOverrides::Table.into_iden(),
            SceneGroupStates::Table.into_iden(),
            SceneDeviceStates::Table.into_iden(),
            Scenes::Table.into_iden(),
            GroupLinks::Table.into_iden(),
            GroupDevices::Table.into_iden(),
            Groups::Table.into_iden(),
            Integrations::Table.into_iden(),
            CoreConfig::Table.into_iden(),
            Devices::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }

        Ok(())
    }
}

struct M20260420000000DashboardWidgetSources;

impl MigrationName for M20260420000000DashboardWidgetSources {
    fn name(&self) -> &str {
        "m20260420000000_dashboard_widget_sources"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260420000000DashboardWidgetSources {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_widget_settings(manager).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(WidgetSettings::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

struct M20260529000000StateLoggerEvents;

impl MigrationName for M20260529000000StateLoggerEvents {
    fn name(&self) -> &str {
        "m20260529000000_state_logger_events"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260529000000StateLoggerEvents {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_state_logger_events(manager).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(StateLoggerEvents::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

async fn create_devices(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Devices::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(Devices::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(ColumnDef::new(Devices::Name).text().not_null())
                .col(ColumnDef::new(Devices::IntegrationId).text().not_null())
                .col(ColumnDef::new(Devices::DeviceId).text().not_null())
                .col(ColumnDef::new(Devices::State).text().not_null())
                .to_owned(),
        )
        .await
}

async fn create_core_config(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(CoreConfig::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(CoreConfig::Id)
                        .integer()
                        .not_null()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(CoreConfig::WarmupTimeSeconds)
                        .integer()
                        .default(1),
                )
                .col(
                    ColumnDef::new(CoreConfig::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn seed_core_config(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .exec_stmt(
            Query::insert()
                .into_table(CoreConfig::Table)
                .columns([CoreConfig::Id])
                .values_panic([1.into()])
                .on_conflict(OnConflict::column(CoreConfig::Id).do_nothing().to_owned())
                .to_owned(),
        )
        .await
}

async fn create_integrations(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Integrations::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(Integrations::Id)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(ColumnDef::new(Integrations::Plugin).text().not_null())
                .col(
                    ColumnDef::new(Integrations::Config)
                        .text()
                        .not_null()
                        .default("{}"),
                )
                .col(
                    ColumnDef::new(Integrations::Enabled)
                        .boolean()
                        .default(true),
                )
                .col(
                    ColumnDef::new(Integrations::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(Integrations::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_groups(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Groups::Table)
                .if_not_exists()
                .col(ColumnDef::new(Groups::Id).text().not_null().primary_key())
                .col(ColumnDef::new(Groups::Name).text().not_null())
                .col(ColumnDef::new(Groups::Hidden).boolean().default(false))
                .col(
                    ColumnDef::new(Groups::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(Groups::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_group_devices(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(GroupDevices::Table)
                .if_not_exists()
                .col(ColumnDef::new(GroupDevices::GroupId).text().not_null())
                .col(
                    ColumnDef::new(GroupDevices::IntegrationId)
                        .text()
                        .not_null(),
                )
                .col(ColumnDef::new(GroupDevices::DeviceId).text().not_null())
                .col(ColumnDef::new(GroupDevices::SortOrder).integer().default(0))
                .primary_key(
                    Index::create()
                        .col(GroupDevices::GroupId)
                        .col(GroupDevices::IntegrationId)
                        .col(GroupDevices::DeviceId),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(GroupDevices::Table, GroupDevices::GroupId)
                        .to(Groups::Table, Groups::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await
}

async fn create_group_links(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(GroupLinks::Table)
                .if_not_exists()
                .col(ColumnDef::new(GroupLinks::ParentGroupId).text().not_null())
                .col(ColumnDef::new(GroupLinks::ChildGroupId).text().not_null())
                .col(ColumnDef::new(GroupLinks::SortOrder).integer().default(0))
                .primary_key(
                    Index::create()
                        .col(GroupLinks::ParentGroupId)
                        .col(GroupLinks::ChildGroupId),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(GroupLinks::Table, GroupLinks::ParentGroupId)
                        .to(Groups::Table, Groups::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(GroupLinks::Table, GroupLinks::ChildGroupId)
                        .to(Groups::Table, Groups::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await
}

async fn create_scenes(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Scenes::Table)
                .if_not_exists()
                .col(ColumnDef::new(Scenes::Id).text().not_null().primary_key())
                .col(ColumnDef::new(Scenes::Name).text().not_null())
                .col(ColumnDef::new(Scenes::Hidden).boolean().default(false))
                .col(ColumnDef::new(Scenes::Script).text())
                .col(
                    ColumnDef::new(Scenes::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(Scenes::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_scene_device_states(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(SceneDeviceStates::Table)
                .if_not_exists()
                .col(ColumnDef::new(SceneDeviceStates::SceneId).text().not_null())
                .col(
                    ColumnDef::new(SceneDeviceStates::DeviceKey)
                        .text()
                        .not_null(),
                )
                .col(ColumnDef::new(SceneDeviceStates::Config).text().not_null())
                .primary_key(
                    Index::create()
                        .col(SceneDeviceStates::SceneId)
                        .col(SceneDeviceStates::DeviceKey),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(SceneDeviceStates::Table, SceneDeviceStates::SceneId)
                        .to(Scenes::Table, Scenes::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await
}

async fn create_scene_group_states(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(SceneGroupStates::Table)
                .if_not_exists()
                .col(ColumnDef::new(SceneGroupStates::SceneId).text().not_null())
                .col(ColumnDef::new(SceneGroupStates::GroupId).text().not_null())
                .col(ColumnDef::new(SceneGroupStates::Config).text().not_null())
                .primary_key(
                    Index::create()
                        .col(SceneGroupStates::SceneId)
                        .col(SceneGroupStates::GroupId),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(SceneGroupStates::Table, SceneGroupStates::SceneId)
                        .to(Scenes::Table, Scenes::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await
}

async fn create_scene_overrides(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(SceneOverrides::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(SceneOverrides::SceneId)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(ColumnDef::new(SceneOverrides::Overrides).text().not_null())
                .to_owned(),
        )
        .await
}

async fn create_routines(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Routines::Table)
                .if_not_exists()
                .col(ColumnDef::new(Routines::Id).text().not_null().primary_key())
                .col(ColumnDef::new(Routines::Name).text().not_null())
                .col(ColumnDef::new(Routines::Enabled).boolean().default(true))
                .col(
                    ColumnDef::new(Routines::Rules)
                        .text()
                        .not_null()
                        .default("[]"),
                )
                .col(
                    ColumnDef::new(Routines::Actions)
                        .text()
                        .not_null()
                        .default("[]"),
                )
                .col(
                    ColumnDef::new(Routines::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(Routines::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_floorplans(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(Floorplans::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(Floorplans::Id)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(ColumnDef::new(Floorplans::Name).text().not_null())
                .col(ColumnDef::new(Floorplans::ImageData).binary())
                .col(ColumnDef::new(Floorplans::ImageMimeType).text())
                .col(ColumnDef::new(Floorplans::Width).integer())
                .col(ColumnDef::new(Floorplans::Height).integer())
                .col(ColumnDef::new(Floorplans::GridData).text())
                .col(ColumnDef::new(Floorplans::SortOrder).integer().default(0))
                .col(
                    ColumnDef::new(Floorplans::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_group_positions(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(GroupPositions::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(GroupPositions::GroupId)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(ColumnDef::new(GroupPositions::X).float().not_null())
                .col(ColumnDef::new(GroupPositions::Y).float().not_null())
                .col(ColumnDef::new(GroupPositions::Width).float().not_null())
                .col(ColumnDef::new(GroupPositions::Height).float().not_null())
                .col(
                    ColumnDef::new(GroupPositions::ZIndex)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .to_owned(),
        )
        .await
}

async fn create_device_display_overrides(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(DeviceDisplayOverrides::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(DeviceDisplayOverrides::DeviceKey)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(DeviceDisplayOverrides::DisplayName)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(DeviceDisplayOverrides::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_device_sensor_configs(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(DeviceSensorConfigs::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(DeviceSensorConfigs::DeviceRef)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(DeviceSensorConfigs::InteractionKind)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(DeviceSensorConfigs::ConfigJson)
                        .text()
                        .not_null()
                        .default("{}"),
                )
                .col(
                    ColumnDef::new(DeviceSensorConfigs::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_dashboard_layouts(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(DashboardLayouts::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(DashboardLayouts::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(DashboardLayouts::Name)
                        .text()
                        .not_null()
                        .default("Default"),
                )
                .col(
                    ColumnDef::new(DashboardLayouts::IsDefault)
                        .boolean()
                        .default(false),
                )
                .col(
                    ColumnDef::new(DashboardLayouts::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(DashboardLayouts::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn seed_default_dashboard_layout(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .exec_stmt(
            Query::insert()
                .into_table(DashboardLayouts::Table)
                .columns([
                    DashboardLayouts::Id,
                    DashboardLayouts::Name,
                    DashboardLayouts::IsDefault,
                ])
                .values_panic([1.into(), "Default".into(), true.into()])
                .on_conflict(
                    OnConflict::column(DashboardLayouts::Id)
                        .do_nothing()
                        .to_owned(),
                )
                .to_owned(),
        )
        .await
}

async fn create_dashboard_widgets(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(DashboardWidgets::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(DashboardWidgets::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(ColumnDef::new(DashboardWidgets::LayoutId).integer())
                .col(
                    ColumnDef::new(DashboardWidgets::WidgetType)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::Config)
                        .text()
                        .not_null()
                        .default("{}"),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::GridX)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::GridY)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::GridW)
                        .integer()
                        .not_null()
                        .default(1),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::GridH)
                        .integer()
                        .not_null()
                        .default(1),
                )
                .col(
                    ColumnDef::new(DashboardWidgets::SortOrder)
                        .integer()
                        .default(0),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(DashboardWidgets::Table, DashboardWidgets::LayoutId)
                        .to(DashboardLayouts::Table, DashboardLayouts::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        )
        .await
}

async fn create_config_versions(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(ConfigVersions::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(ConfigVersions::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(ColumnDef::new(ConfigVersions::Version).integer().not_null())
                .col(ColumnDef::new(ConfigVersions::Description).text())
                .col(
                    ColumnDef::new(ConfigVersions::ExportedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .col(ColumnDef::new(ConfigVersions::ConfigJson).text().not_null())
                .to_owned(),
        )
        .await
}

async fn create_ui_state(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(UiState::Table)
                .if_not_exists()
                .col(ColumnDef::new(UiState::Key).text().not_null().primary_key())
                .col(ColumnDef::new(UiState::Value).text().not_null())
                .to_owned(),
        )
        .await
}

async fn create_widget_settings(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(WidgetSettings::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(WidgetSettings::Key)
                        .text()
                        .not_null()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(WidgetSettings::Config)
                        .text()
                        .not_null()
                        .default("{}"),
                )
                .col(
                    ColumnDef::new(WidgetSettings::UpdatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await
}

async fn create_state_device_events(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(StateDeviceEvents::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(StateDeviceEvents::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::DeviceKey)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::IntegrationId)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::DeviceId)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::DeviceName)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::DeviceKind)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::EventKind)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateDeviceEvents::DeviceStateJson)
                        .text()
                        .not_null(),
                )
                .col(ColumnDef::new(StateDeviceEvents::Value).double().null())
                .col(
                    ColumnDef::new(StateDeviceEvents::CreatedAt)
                        .timestamp()
                        .default(Expr::current_timestamp()),
                )
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .name("idx_state_device_events_device_key")
                .table(StateDeviceEvents::Table)
                .col(StateDeviceEvents::DeviceKey)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .name("idx_state_device_events_created_at")
                .table(StateDeviceEvents::Table)
                .col(StateDeviceEvents::CreatedAt)
                .if_not_exists()
                .to_owned(),
        )
        .await
}

async fn create_state_logger_events(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    manager
        .create_table(
            Table::create()
                .table(StateLoggerEvents::Table)
                .if_not_exists()
                .col(
                    ColumnDef::new(StateLoggerEvents::Id)
                        .integer()
                        .not_null()
                        .auto_increment()
                        .primary_key(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::DeviceKey)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::CreatedAt)
                        .timestamp_with_time_zone()
                        .default(Expr::current_timestamp()),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::IntegrationId)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::DeviceId)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::DeviceName)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::DeviceKind)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::EventKind)
                        .text()
                        .not_null(),
                )
                .col(
                    ColumnDef::new(StateLoggerEvents::DeviceStateJson)
                        .text()
                        .not_null(),
                )
                .col(ColumnDef::new(StateLoggerEvents::Value).double().null())
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .name("idx_state_logger_events_device_key")
                .table(StateLoggerEvents::Table)
                .col(StateLoggerEvents::DeviceKey)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

    manager
        .create_index(
            Index::create()
                .name("idx_state_logger_events_created_at")
                .table(StateLoggerEvents::Table)
                .col(StateLoggerEvents::CreatedAt)
                .if_not_exists()
                .to_owned(),
        )
        .await
}

async fn create_indexes(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    for index in [
        Index::create()
            .name("idx_devices_integration_device_unique")
            .table(Devices::Table)
            .col(Devices::IntegrationId)
            .col(Devices::DeviceId)
            .unique()
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_group_devices_group_id")
            .table(GroupDevices::Table)
            .col(GroupDevices::GroupId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_group_links_parent")
            .table(GroupLinks::Table)
            .col(GroupLinks::ParentGroupId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_group_links_child")
            .table(GroupLinks::Table)
            .col(GroupLinks::ChildGroupId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_scene_device_states_scene")
            .table(SceneDeviceStates::Table)
            .col(SceneDeviceStates::SceneId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_scene_group_states_scene")
            .table(SceneGroupStates::Table)
            .col(SceneGroupStates::SceneId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_dashboard_widgets_layout")
            .table(DashboardWidgets::Table)
            .col(DashboardWidgets::LayoutId)
            .if_not_exists()
            .to_owned(),
    ] {
        manager.create_index(index).await?;
    }

    Ok(())
}
