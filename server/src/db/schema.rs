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
    Rules,
    Actions,
    CreatedAt,
    UpdatedAt,
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
pub enum StateDeviceEvents {
    Table,
    Id,
    DeviceKey,
    IntegrationId,
    DeviceId,
    DeviceName,
    DeviceKind,
    EventKind,
    DeviceStateJson,
    Value,
    CreatedAt,
}

#[derive(Clone, Copy, Iden)]
pub enum StateLoggerEvents {
    Table,
    Id,
    DeviceKey,
    IntegrationId,
    DeviceId,
    DeviceName,
    DeviceKind,
    EventKind,
    DeviceStateJson,
    Value,
    CreatedAt,
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
