use std::path::PathBuf;

use homectl_server::types::{
    action::Action,
    assistant::{
        ApplyAssistantActionResponse, ApplyAssistantPlanRequest, ApplyAssistantPlanResponse,
        AssistantAction, AssistantActionChange, AssistantActionChangeResult, AssistantActionColor,
        AssistantAttachment, AssistantChatRequest, AssistantEntityKind, AssistantHistoryMessage,
        AssistantMessageRole, AssistantOpKind, AssistantOperation, AssistantOperationResult,
        AssistantPlan, AssistantPlanRequest, AssistantSearchResult, AssistantThread,
        AssistantThreadProposal, AssistantThreadSummary, AssistantUsage,
    },
    automation_definition::{
        ChooseBranch, ConditionExpr, ExecutionPolicy, HelperId, NativeAction, NativeProgram,
        NodeId, Program, Quantifier, RoutineDefinitionV2, ScheduleSpec, ScriptDeclaration,
        ScriptSpec, SourceId, TargetSpec, TimerId, TriggerSpec, ValueSource,
    },
    automation_source::{
        CircadianCompatParams, LightProfile, SourceCompute, SourceDefinition, SourceOutput,
        SourcePresetInfo, SourcePresetRef, SourcePreview, SourcePreviewRequest,
        SourcePreviewSample, SourceQuality,
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
    routine_history::{RoutineHistoryEntry, RoutineHistoryTriggerKind},
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
        ApplyAssistantActionResponse::export_all_to(&output_dir)?;
        ApplyAssistantPlanRequest::export_all_to(&output_dir)?;
        ApplyAssistantPlanResponse::export_all_to(&output_dir)?;
        AssistantAction::export_all_to(&output_dir)?;
        AssistantActionChange::export_all_to(&output_dir)?;
        AssistantActionChangeResult::export_all_to(&output_dir)?;
        AssistantActionColor::export_all_to(&output_dir)?;
        AssistantAttachment::export_all_to(&output_dir)?;
        AssistantChatRequest::export_all_to(&output_dir)?;
        AssistantEntityKind::export_all_to(&output_dir)?;
        AssistantHistoryMessage::export_all_to(&output_dir)?;
        AssistantMessageRole::export_all_to(&output_dir)?;
        AssistantOpKind::export_all_to(&output_dir)?;
        AssistantOperation::export_all_to(&output_dir)?;
        AssistantOperationResult::export_all_to(&output_dir)?;
        AssistantPlan::export_all_to(&output_dir)?;
        AssistantPlanRequest::export_all_to(&output_dir)?;
        AssistantSearchResult::export_all_to(&output_dir)?;
        AssistantThread::export_all_to(&output_dir)?;
        AssistantThreadProposal::export_all_to(&output_dir)?;
        AssistantThreadSummary::export_all_to(&output_dir)?;
        AssistantUsage::export_all_to(&output_dir)?;
        homectl_server::types::config_diagnostics::ConfigDiagnostics::export_all_to(&output_dir)?;
        homectl_server::types::config_write::ConfigWriteStatus::export_all_to(&output_dir)?;
        ChooseBranch::export_all_to(&output_dir)?;
        CircadianCompatParams::export_all_to(&output_dir)?;
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
        LightProfile::export_all_to(&output_dir)?;
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
        RoutineHistoryEntry::export_all_to(&output_dir)?;
        RoutineHistoryTriggerKind::export_all_to(&output_dir)?;
        ScheduleSpec::export_all_to(&output_dir)?;
        ScriptDeclaration::export_all_to(&output_dir)?;
        ScriptSpec::export_all_to(&output_dir)?;
        SourceCompute::export_all_to(&output_dir)?;
        SourceDefinition::export_all_to(&output_dir)?;
        SourcePreview::export_all_to(&output_dir)?;
        SourcePreviewRequest::export_all_to(&output_dir)?;
        SourcePreviewSample::export_all_to(&output_dir)?;
        SourceId::export_all_to(&output_dir)?;
        SourceOutput::export_all_to(&output_dir)?;
        SourcePresetInfo::export_all_to(&output_dir)?;
        SourcePresetRef::export_all_to(&output_dir)?;
        SourceQuality::export_all_to(&output_dir)?;
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
