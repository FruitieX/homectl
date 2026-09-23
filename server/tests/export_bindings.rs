use std::path::PathBuf;

use homectl_server::types::{
    action::Action,
    assistant::{
        ApplyAssistantActionResponse, ApplyAssistantPlanRequest, ApplyAssistantPlanResponse,
        AssistantAction, AssistantActionChange, AssistantActionChangeResult, AssistantActionColor,
        AssistantAttachment, AssistantChatRequest, AssistantEntityKind, AssistantHistoryMessage,
        AssistantMessageRole, AssistantOpKind, AssistantOperation, AssistantOperationResult,
        AssistantPlan, AssistantPlanRequest, AssistantSearchResult, AssistantThread,
        AssistantThreadOutcome, AssistantThreadOutcomeRequest, AssistantThreadProposal,
        AssistantThreadSummary, AssistantUsage,
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
    config_authoring::{
        PreviewStep, PreviewValidationError, RoutinePreviewOverride, RoutinePreviewRequest,
        RoutinePreviewResponse, ValueFieldInfo, ValueHistoryEntry,
    },
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
use ts_rs::{Config, ExportError, TS};

#[test]
#[ignore = "Run manually to regenerate TypeScript bindings"]
fn export_ts_bindings() -> Result<(), ExportError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    for output_dir in [
        manifest_dir.join("bindings"),
        manifest_dir.join("../ui/bindings"),
    ] {
        let cfg = Config::new().with_out_dir(output_dir);
        Action::export_all(&cfg)?;
        ApplyAssistantActionResponse::export_all(&cfg)?;
        ApplyAssistantPlanRequest::export_all(&cfg)?;
        ApplyAssistantPlanResponse::export_all(&cfg)?;
        AssistantAction::export_all(&cfg)?;
        AssistantActionChange::export_all(&cfg)?;
        AssistantActionChangeResult::export_all(&cfg)?;
        AssistantActionColor::export_all(&cfg)?;
        AssistantAttachment::export_all(&cfg)?;
        AssistantChatRequest::export_all(&cfg)?;
        AssistantEntityKind::export_all(&cfg)?;
        AssistantHistoryMessage::export_all(&cfg)?;
        AssistantMessageRole::export_all(&cfg)?;
        AssistantOpKind::export_all(&cfg)?;
        AssistantOperation::export_all(&cfg)?;
        AssistantOperationResult::export_all(&cfg)?;
        AssistantPlan::export_all(&cfg)?;
        AssistantPlanRequest::export_all(&cfg)?;
        AssistantSearchResult::export_all(&cfg)?;
        AssistantThread::export_all(&cfg)?;
        AssistantThreadOutcome::export_all(&cfg)?;
        AssistantThreadOutcomeRequest::export_all(&cfg)?;
        AssistantThreadProposal::export_all(&cfg)?;
        AssistantThreadSummary::export_all(&cfg)?;
        AssistantUsage::export_all(&cfg)?;
        homectl_server::types::config_diagnostics::ConfigDiagnostics::export_all(&cfg)?;
        homectl_server::types::config_write::ConfigWriteStatus::export_all(&cfg)?;
        ChooseBranch::export_all(&cfg)?;
        CircadianCompatParams::export_all(&cfg)?;
        ConditionEvaluation::export_all(&cfg)?;
        ConditionExpr::export_all(&cfg)?;
        ConditionTraceNode::export_all(&cfg)?;
        PreviewStep::export_all(&cfg)?;
        PreviewValidationError::export_all(&cfg)?;
        RoutinePreviewOverride::export_all(&cfg)?;
        RoutinePreviewRequest::export_all(&cfg)?;
        RoutinePreviewResponse::export_all(&cfg)?;
        ValueFieldInfo::export_all(&cfg)?;
        ValueHistoryEntry::export_all(&cfg)?;
        Device::export_all(&cfg)?;
        ExecutionPolicy::export_all(&cfg)?;
        GroupEvaluation::export_all(&cfg)?;
        GroupMemberEvaluation::export_all(&cfg)?;
        GroupSceneSummary::export_all(&cfg)?;
        GroupSceneSummaryKind::export_all(&cfg)?;
        HelperId::export_all(&cfg)?;
        HelperDefinition::export_all(&cfg)?;
        HelperKind::export_all(&cfg)?;
        HelperPersistence::export_all(&cfg)?;
        HelperRuntimeStatus::export_all(&cfg)?;
        LightProfile::export_all(&cfg)?;
        PlannedRunStatus::export_all(&cfg)?;
        PlannedStepStatus::export_all(&cfg)?;
        StepDisposition::export_all(&cfg)?;
        NativeAction::export_all(&cfg)?;
        NativeProgram::export_all(&cfg)?;
        NodeId::export_all(&cfg)?;
        Program::export_all(&cfg)?;
        Quantifier::export_all(&cfg)?;
        RoutineDefinitionV2::export_all(&cfg)?;
        RoutineV2RuntimeStatus::export_all(&cfg)?;
        RoutineHistoryEntry::export_all(&cfg)?;
        RoutineHistoryTriggerKind::export_all(&cfg)?;
        ScheduleSpec::export_all(&cfg)?;
        ScriptDeclaration::export_all(&cfg)?;
        ScriptSpec::export_all(&cfg)?;
        SourceCompute::export_all(&cfg)?;
        SourceDefinition::export_all(&cfg)?;
        SourcePreview::export_all(&cfg)?;
        SourcePreviewRequest::export_all(&cfg)?;
        SourcePreviewSample::export_all(&cfg)?;
        SourceId::export_all(&cfg)?;
        SourceOutput::export_all(&cfg)?;
        SourcePresetInfo::export_all(&cfg)?;
        SourcePresetRef::export_all(&cfg)?;
        SourceQuality::export_all(&cfg)?;
        TargetSpec::export_all(&cfg)?;
        TimerId::export_all(&cfg)?;
        TimerJobStatus::export_all(&cfg)?;
        TimerPersistence::export_all(&cfg)?;
        TimerRuntimeStatus::export_all(&cfg)?;
        TriggerRuntimeStatus::export_all(&cfg)?;
        TriggerSpec::export_all(&cfg)?;
        TruthValue::export_all(&cfg)?;
        UnknownReason::export_all(&cfg)?;
        ValueSource::export_all(&cfg)?;
        homectl_server::core::color_calibration::ColorCalibrationProfile::export_all(
            &cfg,
        )?;
        homectl_server::core::color_calibration::ColorCalibrationAssignment::export_all(
            &cfg,
        )?;
        homectl_server::core::color_calibration::DeviceColorCalibration::export_all(
            &cfg,
        )?;
        DevicesState::export_all(&cfg)?;
        FlattenedDimConfig::export_all(&cfg)?;
        FlattenedGroupConfig::export_all(&cfg)?;
        FlattenedGroupsConfig::export_all(&cfg)?;
        GroupId::export_all(&cfg)?;
        IntegrationConfigFieldKind::export_all(&cfg)?;
        IntegrationConfigFieldOption::export_all(&cfg)?;
        IntegrationConfigFieldSchema::export_all(&cfg)?;
        IntegrationConfigFieldVisibility::export_all(&cfg)?;
        IntegrationConfigSchema::export_all(&cfg)?;
        RuleRuntimeStatus::export_all(&cfg)?;
        Rule::export_all(&cfg)?;
        Routine::export_all(&cfg)?;
        RoutineRuntimeStatus::export_all(&cfg)?;
        RoutineStatuses::export_all(&cfg)?;
        SceneConfig::export_all(&cfg)?;
        FlattenedSceneConfig::export_all(&cfg)?;
        FlattenedScenesConfig::export_all(&cfg)?;
        TriggerMode::export_all(&cfg)?;
        UiActionDescriptor::export_all(&cfg)?;
        StateUpdate::export_all(&cfg)?;
        WebSocketRequest::export_all(&cfg)?;
        WebSocketResponse::export_all(&cfg)?;
    }

    Ok(())
}
