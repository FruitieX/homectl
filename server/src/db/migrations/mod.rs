use crate::db::schema::{
    AssistantThreads, AutomationSources, AutomationTimerJobs, AutomationValueState,
    AutomationValues, ConfigVersions, CoreConfig, DashboardLayouts, DashboardWidgets,
    DeviceColorCalibrations, DeviceDisplayOverrides, DeviceSensorConfigs, Devices, Floorplans,
    GroupDevices, GroupLinks, GroupPositions, Groups, Integrations, RoutineHistory, Routines,
    SceneDeviceStates, SceneGroupStates, SceneOverrides, Scenes, UiState, ValueHistory,
    WidgetSettings,
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
            Box::new(M20260910000000ColorCalibration),
            Box::new(M20260910000001CalibrationProfiles),
            Box::new(M20260913000000DefaultTransition),
            Box::new(M20260913000001SceneTransition),
            Box::new(M20260913000002DashboardFractionalUnits),
            Box::new(M20260916000000UvColorCalibration),
            Box::new(M20260918000000SceneGroupStateOrder),
            Box::new(M20260919000000RoutineV2Semantics),
            Box::new(M20260920000000AutomationHelpers),
            Box::new(M20260921000000AutomationTimerJobs),
            Box::new(M20260922000000AutomationSources),
            Box::new(M20260922000001AssistantThreads),
            Box::new(M20260922000002RoutineHistory),
            Box::new(M20260923000000ValueHistory),
        ]
    }
}

struct M20260923000000ValueHistory;

impl MigrationName for M20260923000000ValueHistory {
    fn name(&self) -> &str {
        "m20260923000000_value_history"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260923000000ValueHistory {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ValueHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ValueHistory::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ValueHistory::SourceKey).text().not_null())
                    .col(ColumnDef::new(ValueHistory::Path).text().not_null())
                    .col(
                        ColumnDef::new(ValueHistory::ChangedAtMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ValueHistory::Value).text().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .table(ValueHistory::Table)
                    .name("idx_value_history_source_path")
                    .col(ValueHistory::SourceKey)
                    .col(ValueHistory::Path)
                    .col(ValueHistory::Id)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ValueHistory::Table).to_owned())
            .await
    }
}

/// Bounded routine history snapshots, restored into the in-memory ring on
/// startup so the history view survives restarts.
struct M20260922000002RoutineHistory;

impl MigrationName for M20260922000002RoutineHistory {
    fn name(&self) -> &str {
        "m20260922000002_routine_history"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260922000002RoutineHistory {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(RoutineHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RoutineHistory::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RoutineHistory::Timestamp).text().not_null())
                    .col(ColumnDef::new(RoutineHistory::Entry).text().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(RoutineHistory::Table)
                    .name("idx_routine_history_timestamp")
                    .col(RoutineHistory::Timestamp)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RoutineHistory::Table).to_owned())
            .await
    }
}

/// Persisted assistant conversation threads (name + message JSON).
struct M20260922000001AssistantThreads;

impl MigrationName for M20260922000001AssistantThreads {
    fn name(&self) -> &str {
        "m20260922000001_assistant_threads"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260922000001AssistantThreads {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AssistantThreads::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AssistantThreads::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AssistantThreads::Name).text().not_null())
                    .col(
                        ColumnDef::new(AssistantThreads::CreatedAtMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AssistantThreads::UpdatedAtMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AssistantThreads::Messages).text().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AssistantThreads::Table).to_owned())
            .await
    }
}

/// P11 computed source definitions. Output values, freshness, and refresh
/// cursors are runtime state and are deliberately not persisted here.
struct M20260922000000AutomationSources;

impl MigrationName for M20260922000000AutomationSources {
    fn name(&self) -> &str {
        "m20260922000000_automation_sources"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260922000000AutomationSources {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AutomationSources::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AutomationSources::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AutomationSources::Name).text().not_null())
                    .col(
                        ColumnDef::new(AutomationSources::Enabled)
                            .boolean()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationSources::Revision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationSources::Timezone)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationSources::RefreshIntervalMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AutomationSources::Aliases).text().not_null())
                    .col(ColumnDef::new(AutomationSources::Compute).text().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AutomationSources::Table).to_owned())
            .await
    }
}

/// P10 best-effort persistence for named timer jobs. Only named timers are
/// stored; schedule occurrences re-arm from the current time and predicate
/// deadlines re-evaluate from current state at startup.
struct M20260921000000AutomationTimerJobs;

impl MigrationName for M20260921000000AutomationTimerJobs {
    fn name(&self) -> &str {
        "m20260921000000_automation_timer_jobs"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260921000000AutomationTimerJobs {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AutomationTimerJobs::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AutomationTimerJobs::RoutineId)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationTimerJobs::TimerId)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationTimerJobs::DefinitionRevision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationTimerJobs::Generation)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationTimerJobs::DueWallMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AutomationTimerJobs::Capture).text().null())
                    .primary_key(
                        Index::create()
                            .col(AutomationTimerJobs::RoutineId)
                            .col(AutomationTimerJobs::TimerId),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AutomationTimerJobs::Table).to_owned())
            .await
    }
}

/// P05 typed helper definitions and their durable current values. Session
/// helper values are runtime-only and never stored here.
struct M20260920000000AutomationHelpers;

impl MigrationName for M20260920000000AutomationHelpers {
    fn name(&self) -> &str {
        "m20260920000000_automation_helpers"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260920000000AutomationHelpers {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AutomationValues::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AutomationValues::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AutomationValues::Name).text().not_null())
                    .col(ColumnDef::new(AutomationValues::Kind).text().not_null())
                    .col(
                        ColumnDef::new(AutomationValues::InitialValue)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationValues::Persistence)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AutomationValues::Hidden).boolean().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(AutomationValueState::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AutomationValueState::HelperId)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AutomationValueState::Value)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AutomationValueState::Revision)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AutomationValueState::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AutomationValues::Table).to_owned())
            .await
    }
}

/// Additive v2 routine columns (P03). Legacy `rules`/`actions` columns are
/// preserved; every existing row becomes an explicit v1 semantics row and is
/// never converted automatically.
struct M20260919000000RoutineV2Semantics;

impl MigrationName for M20260919000000RoutineV2Semantics {
    fn name(&self) -> &str {
        "m20260919000000_routine_v2_semantics"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260919000000RoutineV2Semantics {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .add_column(
                        ColumnDef::new(Routines::SemanticsVersion)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .add_column(ColumnDef::new(Routines::DefinitionV2).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .add_column(
                        ColumnDef::new(Routines::Revision)
                            .big_integer()
                            .not_null()
                            .default(1),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .drop_column(Routines::Revision)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .drop_column(Routines::DefinitionV2)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Routines::Table)
                    .drop_column(Routines::SemanticsVersion)
                    .to_owned(),
            )
            .await
    }
}

struct M20260918000000SceneGroupStateOrder;

impl MigrationName for M20260918000000SceneGroupStateOrder {
    fn name(&self) -> &str {
        "m20260918000000_scene_group_state_order"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260918000000SceneGroupStateOrder {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SceneGroupStates::Table)
                    .add_column(
                        ColumnDef::new(SceneGroupStates::SortOrder)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SceneGroupStates::Table)
                    .drop_column(SceneGroupStates::SortOrder)
                    .to_owned(),
            )
            .await
    }
}

/// HSV calibration anchors cannot be interpreted as CIE 1976 u′v′ anchors.
/// Profiles are explicitly disposable for this migration, so clear all three
/// legacy stores atomically before runtime configuration is loaded.
struct M20260916000000UvColorCalibration;

impl MigrationName for M20260916000000UvColorCalibration {
    fn name(&self) -> &str {
        "m20260916000000_uv_color_calibration"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260916000000UvColorCalibration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use crate::db::config_queries::calibration::{
            CalibrationAssignments as A, CalibrationProfiles as P,
        };
        manager
            .exec_stmt(Query::delete().from_table(A::Table).to_owned())
            .await?;
        manager
            .exec_stmt(Query::delete().from_table(P::Table).to_owned())
            .await?;
        manager
            .exec_stmt(
                Query::delete()
                    .from_table(DeviceColorCalibrations::Table)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

struct M20260913000002DashboardFractionalUnits;

impl MigrationName for M20260913000002DashboardFractionalUnits {
    fn name(&self) -> &str {
        "m20260913000002_dashboard_fractional_units"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260913000002DashboardFractionalUnits {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(DashboardWidgets::Table)
                    .add_column(
                        ColumnDef::new(DashboardWidgets::GridWValue)
                            .double()
                            .not_null()
                            .default(1.0),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(DashboardWidgets::Table)
                    .add_column(
                        ColumnDef::new(DashboardWidgets::GridHValue)
                            .double()
                            .not_null()
                            .default(1.0),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .exec_stmt(
                Query::update()
                    .table(DashboardWidgets::Table)
                    .value(
                        DashboardWidgets::GridWValue,
                        Expr::col(DashboardWidgets::GridW),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .exec_stmt(
                Query::update()
                    .table(DashboardWidgets::Table)
                    .value(
                        DashboardWidgets::GridHValue,
                        Expr::col(DashboardWidgets::GridH),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(DashboardWidgets::Table)
                    .drop_column(DashboardWidgets::GridWValue)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(DashboardWidgets::Table)
                    .drop_column(DashboardWidgets::GridHValue)
                    .to_owned(),
            )
            .await
    }
}

struct M20260913000001SceneTransition;

impl MigrationName for M20260913000001SceneTransition {
    fn name(&self) -> &str {
        "m20260913000001_scene_transition"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260913000001SceneTransition {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(CoreConfig::Table)
                    .add_column(
                        ColumnDef::new(CoreConfig::SceneTransitionMs)
                            .big_integer()
                            .null(),
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
                    .drop_column(CoreConfig::SceneTransitionMs)
                    .to_owned(),
            )
            .await
    }
}

struct M20260913000000DefaultTransition;

impl MigrationName for M20260913000000DefaultTransition {
    fn name(&self) -> &str {
        "m20260913000000_default_transition"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for M20260913000000DefaultTransition {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(CoreConfig::Table)
                    .add_column(
                        ColumnDef::new(CoreConfig::DefaultTransitionMs)
                            .big_integer()
                            .null(),
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
                    .drop_column(CoreConfig::DefaultTransitionMs)
                    .to_owned(),
            )
            .await
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

struct M20260910000001CalibrationProfiles;
impl MigrationName for M20260910000001CalibrationProfiles {
    fn name(&self) -> &str {
        "m20260910000001_calibration_profiles"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for M20260910000001CalibrationProfiles {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use crate::db::config_queries::calibration::{
            CalibrationAssignments as A, CalibrationProfiles as P,
        };
        manager
            .create_table(
                Table::create()
                    .table(P::Table)
                    .col(ColumnDef::new(P::Id).text().not_null().primary_key())
                    .col(ColumnDef::new(P::Config).text().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(A::Table)
                    .col(ColumnDef::new(A::DeviceKey).text().not_null().primary_key())
                    .col(ColumnDef::new(A::ProfileId).text().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(A::Table, A::ProfileId)
                            .to(P::Table, P::Id),
                    )
                    .to_owned(),
            )
            .await
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use crate::db::config_queries::calibration::{
            CalibrationAssignments as A, CalibrationProfiles as P,
        };
        manager
            .drop_table(Table::drop().table(A::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(P::Table).to_owned())
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

struct M20260910000000ColorCalibration;
impl MigrationName for M20260910000000ColorCalibration {
    fn name(&self) -> &str {
        "m20260910000000_color_calibration"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for M20260910000000ColorCalibration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DeviceColorCalibrations::Table)
                    .col(
                        ColumnDef::new(DeviceColorCalibrations::DeviceKey)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(DeviceColorCalibrations::Points)
                            .text()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(DeviceColorCalibrations::UpdatedAt)
                            .timestamp()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(DeviceColorCalibrations::Table)
                    .to_owned(),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    #[tokio::test]
    async fn uv_migration_removes_incompatible_hsv_calibration_data() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(7)).await.unwrap();
        for sql in [
            "INSERT INTO calibration_profiles (id, config) VALUES ('legacy', '{}')",
            "INSERT INTO calibration_assignments (device_key, profile_id) VALUES ('mqtt/lamp', 'legacy')",
            "INSERT INTO device_color_calibrations (device_key, points) VALUES ('mqtt/lamp', '[]')",
        ] {
            db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
                .await
                .unwrap();
        }

        Migrator::up(&db, None).await.unwrap();

        for table in [
            "calibration_assignments",
            "calibration_profiles",
            "device_color_calibrations",
        ] {
            let row = db
                .query_one_raw(Statement::from_string(
                    DbBackend::Sqlite,
                    format!("SELECT COUNT(*) AS count FROM {table}"),
                ))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get::<i64>("", "count").unwrap(), 0);
        }
    }

    // M01: the v2 semantics columns are additive; legacy rows stay explicit v1
    // rows with defaults and are never converted automatically.
    #[tokio::test]
    async fn routine_v2_columns_are_additive_and_preserve_legacy_rows() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        // Run every migration except the additive routine-v2 one.
        Migrator::up(&db, Some(9)).await.unwrap();
        db.execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "INSERT INTO routines (id, name, enabled, rules, actions) \
             VALUES ('legacy', 'Legacy', 1, '[{\"rule\":true}]', '[{\"action\":\"noop\"}]')",
        ))
        .await
        .unwrap();

        Migrator::up(&db, None).await.unwrap();

        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT semantics_version, revision, definition_v2, rules, actions \
                 FROM routines WHERE id = 'legacy'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "semantics_version").unwrap(), 1);
        assert_eq!(row.try_get::<i64>("", "revision").unwrap(), 1);
        assert!(row
            .try_get::<Option<String>>("", "definition_v2")
            .unwrap()
            .is_none());
        assert_eq!(
            row.try_get::<String>("", "rules").unwrap(),
            "[{\"rule\":true}]"
        );
        assert_eq!(
            row.try_get::<String>("", "actions").unwrap(),
            "[{\"action\":\"noop\"}]"
        );
    }
}
