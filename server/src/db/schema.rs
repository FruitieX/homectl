use sea_orm::sea_query;
use sea_orm::sea_query::Iden;

#[derive(Clone, Copy, Iden)]
pub enum Devices {
    Table,
    Id,
    Name,
    IntegrationId,
    DeviceId,
    State,
}

#[derive(Clone, Copy, Iden)]
pub enum CoreConfig {
    Table,
    Id,
    WarmupTimeSeconds,
    DefaultTransitionMs,
    SceneTransitionMs,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum Integrations {
    Table,
    Id,
    Plugin,
    Config,
    Enabled,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum Groups {
    Table,
    Id,
    Name,
    Hidden,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum GroupDevices {
    Table,
    GroupId,
    IntegrationId,
    DeviceId,
    SortOrder,
}

#[derive(Clone, Copy, Iden)]
pub enum GroupLinks {
    Table,
    ParentGroupId,
    ChildGroupId,
    SortOrder,
}

#[derive(Clone, Copy, Iden)]
pub enum Scenes {
    Table,
    Id,
    Name,
    Hidden,
    Script,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum SceneDeviceStates {
    Table,
    SceneId,
    DeviceKey,
    Config,
}

#[derive(Clone, Copy, Iden)]
pub enum SceneGroupStates {
    Table,
    SceneId,
    GroupId,
    Config,
    SortOrder,
}

#[derive(Clone, Copy, Iden)]
pub enum SceneOverrides {
    Table,
    SceneId,
    Overrides,
}

#[derive(Clone, Copy, Iden)]
pub enum Routines {
    Table,
    Id,
    Name,
    Enabled,
    SemanticsVersion,
    DefinitionV2,
    Revision,
    Rules,
    Actions,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum AutomationValues {
    Table,
    Id,
    Name,
    Kind,
    InitialValue,
    Persistence,
    Hidden,
}

#[derive(Clone, Copy, Iden)]
pub enum AutomationValueState {
    Table,
    HelperId,
    Value,
    Revision,
}

/// P11 computed source definitions. The computed value and its freshness live
/// in actor state; only the versioned definition is persisted.
#[derive(Clone, Copy, Iden)]
pub enum AutomationSources {
    Table,
    Id,
    Name,
    Enabled,
    Revision,
    Timezone,
    RefreshIntervalMs,
    Aliases,
    Compute,
}

/// P10 best-effort durable named timer jobs. Only named timers are persisted;
/// schedule occurrences and sustained-predicate deadlines recover from
/// current time/state instead.
#[derive(Clone, Copy, Iden)]
pub enum AutomationTimerJobs {
    Table,
    RoutineId,
    TimerId,
    DefinitionRevision,
    Generation,
    DueWallMs,
    Capture,
}

#[derive(Clone, Copy, Iden)]
pub enum Floorplans {
    Table,
    Id,
    Name,
    ImageData,
    ImageMimeType,
    Width,
    Height,
    GridData,
    SortOrder,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum GroupPositions {
    Table,
    GroupId,
    X,
    Y,
    Width,
    Height,
    ZIndex,
}

#[derive(Clone, Copy, Iden)]
pub enum DeviceDisplayOverrides {
    Table,
    DeviceKey,
    DisplayName,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum DeviceSensorConfigs {
    Table,
    DeviceRef,
    InteractionKind,
    ConfigJson,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum DashboardLayouts {
    Table,
    Id,
    Name,
    IsDefault,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum DashboardWidgets {
    Table,
    Id,
    LayoutId,
    WidgetType,
    Config,
    GridX,
    GridY,
    GridW,
    GridH,
    GridWValue,
    GridHValue,
    SortOrder,
}

#[derive(Clone, Copy, Iden)]
pub enum ConfigVersions {
    Table,
    Id,
    Version,
    Description,
    ExportedAt,
    ConfigJson,
}

#[derive(Clone, Copy, Iden)]
pub enum UiState {
    Table,
    Key,
    Value,
}

#[derive(Clone, Copy, Iden)]
pub enum WidgetSettings {
    Table,
    Key,
    Config,
    UpdatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum DeviceColorCalibrations {
    Table,
    DeviceKey,
    Points,
    UpdatedAt,
}

/// Persisted assistant conversation threads. Messages are a JSON array of
/// `{role, content}` entries; the list query keeps only the newest threads.
#[derive(Clone, Copy, Iden)]
pub enum AssistantThreads {
    Table,
    Id,
    Name,
    CreatedAtMs,
    UpdatedAtMs,
    Messages,
}

/// Bounded routine history snapshots. `entry` stores the full history entry
/// JSON so the history page keeps its traces across restarts; the table is
/// pruned to the newest rows on startup and while writing.
#[derive(Clone, Copy, Iden)]
pub enum RoutineHistory {
    Table,
    Id,
    Timestamp,
    Entry,
}

#[derive(Clone, Copy, Iden)]
pub enum ValueHistory {
    Table,
    Id,
    SourceKey,
    Path,
    ChangedAtMs,
    Value,
}
