use std::path::PathBuf;

use homectl_server::types::{
    action::Action,
    automation_definition::{
        ChooseBranch, ConditionExpr, ExecutionPolicy, HelperId, NativeAction, NativeProgram,
        NodeId, Program, Quantifier, RoutineDefinitionV2, ScheduleSpec, ScriptDeclaration,
        ScriptSpec, SourceId, TargetSpec, TimerId, TriggerSpec, ValueSource,
    },
    automation_trace::{
        ConditionEvaluation, ConditionTraceNode, GroupEvaluation, GroupMemberEvaluation,
        GroupSceneSummary, GroupSceneSummaryKind, PlannedRunStatus, PlannedStepStatus,
        RoutineV2RuntimeStatus, StepDisposition, TriggerRuntimeStatus, TruthValue, UnknownReason,
    },
    automation_value::{HelperDefinition, HelperKind, HelperPersistence, HelperRuntimeStatus},
    device::{Device, DevicesState},
    dim::FlattenedDimConfig,
    group::{FlattenedGroupConfig, FlattenedGroupsConfig, GroupId},
    integration::{
        IntegrationConfigFieldKind, IntegrationConfigFieldOption, IntegrationConfigFieldSchema,
        IntegrationConfigFieldVisibility, IntegrationConfigSchema,
    },
    routine_status::{RoutineRuntimeStatus, RoutineStatuses, RuleRuntimeStatus},
    rule::{Routine, Rule, TriggerMode},
    scene::{FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig},
    timer_status::{TimerJobStatus, TimerPersistence, TimerRuntimeStatus},
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
        homectl_server::types::config_diagnostics::ConfigDiagnostics::export_all_to(&output_dir)?;
        homectl_server::types::config_write::ConfigWriteStatus::export_all_to(&output_dir)?;
        ChooseBranch::export_all_to(&output_dir)?;
        ConditionEvaluation::export_all_to(&output_dir)?;
        ConditionExpr::export_all_to(&output_dir)?;
        ConditionTraceNode::export_all_to(&output_dir)?;
        Device::export_all_to(&output_dir)?;
        ExecutionPolicy::export_all_to(&output_dir)?;
        GroupEvaluation::export_all_to(&output_dir)?;
        GroupMemberEvaluation::export_all_to(&output_dir)?;
        GroupSceneSummary::export_all_to(&output_dir)?;
        GroupSceneSummaryKind::export_all_to(&output_dir)?;
        HelperId::export_all_to(&output_dir)?;
        HelperDefinition::export_all_to(&output_dir)?;
        HelperKind::export_all_to(&output_dir)?;
        HelperPersistence::export_all_to(&output_dir)?;
        HelperRuntimeStatus::export_all_to(&output_dir)?;
        PlannedRunStatus::export_all_to(&output_dir)?;
        PlannedStepStatus::export_all_to(&output_dir)?;
        StepDisposition::export_all_to(&output_dir)?;
        NativeAction::export_all_to(&output_dir)?;
        NativeProgram::export_all_to(&output_dir)?;
        NodeId::export_all_to(&output_dir)?;
        Program::export_all_to(&output_dir)?;
        Quantifier::export_all_to(&output_dir)?;
        RoutineDefinitionV2::export_all_to(&output_dir)?;
        RoutineV2RuntimeStatus::export_all_to(&output_dir)?;
        ScheduleSpec::export_all_to(&output_dir)?;
        ScriptDeclaration::export_all_to(&output_dir)?;
        ScriptSpec::export_all_to(&output_dir)?;
        SourceId::export_all_to(&output_dir)?;
        TargetSpec::export_all_to(&output_dir)?;
        TimerId::export_all_to(&output_dir)?;
        TimerJobStatus::export_all_to(&output_dir)?;
        TimerPersistence::export_all_to(&output_dir)?;
        TimerRuntimeStatus::export_all_to(&output_dir)?;
        TriggerRuntimeStatus::export_all_to(&output_dir)?;
        TriggerSpec::export_all_to(&output_dir)?;
        TruthValue::export_all_to(&output_dir)?;
        UnknownReason::export_all_to(&output_dir)?;
        ValueSource::export_all_to(&output_dir)?;
        homectl_server::core::color_calibration::ColorCalibrationProfile::export_all_to(
            &output_dir,
        )?;
        homectl_server::core::color_calibration::ColorCalibrationAssignment::export_all_to(
            &output_dir,
        )?;
        homectl_server::core::color_calibration::DeviceColorCalibration::export_all_to(
            &output_dir,
        )?;
        DevicesState::export_all_to(&output_dir)?;
        FlattenedDimConfig::export_all_to(&output_dir)?;
        FlattenedGroupConfig::export_all_to(&output_dir)?;
        FlattenedGroupsConfig::export_all_to(&output_dir)?;
        GroupId::export_all_to(&output_dir)?;
        IntegrationConfigFieldKind::export_all_to(&output_dir)?;
        IntegrationConfigFieldOption::export_all_to(&output_dir)?;
        IntegrationConfigFieldSchema::export_all_to(&output_dir)?;
        IntegrationConfigFieldVisibility::export_all_to(&output_dir)?;
        IntegrationConfigSchema::export_all_to(&output_dir)?;
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
