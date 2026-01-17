use std::path::PathBuf;

use homectl_server::types::{
    action::Action,
    device::{Device, DevicesState},
    dim::FlattenedDimConfig,
    group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupId},
    routine_status::{RoutineRuntimeStatus, RoutineStatuses, RuleRuntimeStatus},
    rule::{Routine, Rule, TriggerMode},
    scene::{FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig},
    ui::UiActionDescriptor,
    websockets::{StateUpdate, WebSocketRequest, WebSocketResponse},
};
use ts_rs::{ExportError, TS};

#[test]
#[ignore = "Run manually to regenerate TypeScript bindings"]
fn export_ts_bindings() -> Result<(), ExportError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    for output_dir in [
        manifest_dir.join("bindings"),
        manifest_dir.join("../ui/bindings"),
    ] {
        Action::export_all_to(&output_dir)?;
        Device::export_all_to(&output_dir)?;
        DevicesState::export_all_to(&output_dir)?;
        FlattenedDimConfig::export_all_to(&output_dir)?;
        FlattenedGroupConfig::export_all_to(&output_dir)?;
        FlattenedGroupsConfig::export_all_to(&output_dir)?;
        GroupId::export_all_to(&output_dir)?;
        RuleRuntimeStatus::export_all_to(&output_dir)?;
        Rule::export_all_to(&output_dir)?;
        Routine::export_all_to(&output_dir)?;
        RoutineRuntimeStatus::export_all_to(&output_dir)?;
        RoutineStatuses::export_all_to(&output_dir)?;
        SceneConfig::export_all_to(&output_dir)?;
        FlattenedSceneConfig::export_all_to(&output_dir)?;
        FlattenedScenesConfig::export_all_to(&output_dir)?;
        TriggerMode::export_all_to(&output_dir)?;
        UiActionDescriptor::export_all_to(&output_dir)?;
        StateUpdate::export_all_to(&output_dir)?;
        WebSocketRequest::export_all_to(&output_dir)?;
        WebSocketResponse::export_all_to(&output_dir)?;
    }

    Ok(())
}
