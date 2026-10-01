//! Script conditions execute in workers; native decisions keep their captured frame.
use super::{
    compile::CompiledDefinition,
    evaluate::{FrameContext, RoutineFrameEvaluation},
    plan::IntentTracker,
    script_coordinator::ScriptOwnerId,
    script_runtime::{PreparedScriptRun, ScriptExecution},
};
use crate::types::{
    automation_definition::{ConditionExpr, NativeAction, Program, ScriptSpec},
    automation_event::{DeviceMutation, EventCausation, EventId, EventOrigin},
    device::{DeviceKey, DevicesState},
};
use serde_json::{json, Value};

pub fn visit_condition(
    condition: &mut ConditionExpr,
    callback: &mut impl FnMut(&mut ConditionExpr),
) {
    match condition {
        ConditionExpr::Script { .. } => callback(condition),
        ConditionExpr::All { conditions } | ConditionExpr::Any { conditions } => {
            for item in conditions {
                visit_condition(item, callback);
            }
        }
        ConditionExpr::Not { condition } => visit_condition(condition, callback),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        core::event::{handle_event, tests::test_state},
        types::{
            automation_definition::HelperId,
            automation_event::EventCausation,
            automation_trace::TruthValue,
            automation_value::{HelperDefinition, HelperKind},
            event::Event,
        },
    };
    use serde_json::json;

    #[tokio::test]
    async fn conditions_and_choose_branches_use_the_captured_helpers_and_guard_manual_intent() {
        for (source, expected, manual_intent) in [
            (
                "return api.values.get('mode').value === true;",
                Some(TruthValue::True),
                false,
            ),
            ("return false;", Some(TruthValue::False), false),
            (
                "return api.unknown('not ready');",
                Some(TruthValue::Unknown),
                false,
            ),
            ("throw new Error('bad condition');", None, false),
            ("return true;", Some(TruthValue::True), true),
        ] {
            let (mut state, mut events) = test_state();
            let mut binary = std::env::current_exe().unwrap();
            binary.pop();
            binary.pop();
            binary.push("script-worker");
            state.scripts.worker_binary = Some(binary);
            let lamp = crate::core::event::tests::lamp("dummy", "lamp", false, 0.1);
            state.devices.set_state(&lamp, true, true);
            state.devices.begin_command(EventCausation::default());
            state.flush_pending_frames().await;
            let mut mode = HelperDefinition::new("mode", "Mode", HelperKind::Boolean);
            mode.initial_value = json!(true);
            state.runtime_config.helpers = vec![mode];
            state.apply_runtime_helpers();
            state.runtime_config.routines=serde_json::from_value(json!([{"id":"conditional","name":"Conditional","enabled":true,"semantics_version":2,"revision":1,"rules":[],"actions":[],"definition_v2":{"triggers":[{"kind":"state_change","id":"change","device":{"integration_id":"dummy","device_id":"lamp"}}],"condition":{"kind":"script","spec":{"api_version":1,"source_body":source,"declarations":[],"limits_profile":"default"}},"program":{"kind":"native","steps":[{"action":"choose","id":"choice","branches":[{"id":"home","condition":{"kind":"comparison","source":{"kind":"helper","helper":"mode"},"operator":"eq","value":true},"steps":[{"action":"set_power","id":"power","device":{"integration_id":"dummy","device_id":"lamp"},"power":true}]}]}]}}}])).unwrap();
            state.apply_runtime_routines();
            let mut report = lamp.clone();
            if let crate::types::device::DeviceData::Controllable(data) = &mut report.data {
                data.state.power = true;
            }
            handle_event(
                &mut state,
                &Event::ExternalStateUpdate {
                    device: report,
                    report_retained: false,
                    integration_epoch: None,
                },
            )
            .await
            .unwrap();
            state.flush_pending_frames().await;
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let event = events.recv().await.unwrap();
                    if matches!(event, Event::RoutineScriptResult { .. }) {
                        return event;
                    }
                }
            })
            .await
            .unwrap();
            state
                .helpers
                .set_value(&HelperId("mode".into()), json!(false))
                .unwrap();
            if manual_intent {
                state
                    .intents
                    .bump_device(&crate::types::device::DeviceKey::new(
                        "dummy".to_string().into(),
                        "lamp".to_string().into(),
                    ));
            }
            handle_event(&mut state, &result).await.unwrap();
            let status = &state.rules.get_runtime_statuses().0[&"conditional".to_string().into()];
            let v2 = status.v2.as_ref().unwrap();
            if let Some(expected) = expected {
                assert_eq!(v2.condition.truth, expected);
            } else {
                assert!(v2.condition.error.is_some());
            }
            if expected == Some(TruthValue::True) {
                let run = v2.last_run.as_ref().unwrap();
                assert_eq!(
                    run.steps.len(),
                    1,
                    "native branch selection must use captured mode=true"
                );
                assert_eq!(run.dropped, u64::from(manual_intent));
            } else {
                assert!(
                    events.try_recv().is_err(),
                    "blocked or errored conditions dispatch nothing"
                );
            }
        }
    }
}
fn visit_steps(steps: &mut [NativeAction], callback: &mut impl FnMut(&mut ConditionExpr)) {
    for step in steps {
        if let NativeAction::Choose { branches, .. } = step {
            for branch in branches {
                visit_condition(&mut branch.condition, callback);
                visit_steps(&mut branch.steps, callback);
            }
        }
    }
}
pub fn visit_definition(
    definition: &mut crate::types::automation_definition::RoutineDefinitionV2,
    callback: &mut impl FnMut(&mut ConditionExpr),
) {
    visit_condition(&mut definition.condition, callback);
    if let Program::Native(program) = &mut definition.program {
        visit_steps(&mut program.steps, callback);
    }
}
pub fn has_condition(condition: &ConditionExpr) -> bool {
    let mut found = false;
    visit_condition(&mut condition.clone(), &mut |_| found = true);
    found
}
pub fn has(definition: &crate::types::automation_definition::RoutineDefinitionV2) -> bool {
    let mut found = false;
    visit_definition(&mut definition.clone(), &mut |_| found = true);
    found
}

pub struct PendingConditions {
    pub compiled: CompiledDefinition,
    pub evaluation: RoutineFrameEvaluation,
    pub before: DevicesState,
    pub after: DevicesState,
    pub groups: crate::core::groups::Groups,
    pub helpers: crate::core::helpers::Helpers,
    pub intents: IntentTracker,
    pub mutations: Vec<DeviceMutation>,
    pub frame_id: EventId,
    pub origin: EventOrigin,
    pub now_ms: i64,
}
impl PendingConditions {
    pub fn resolve(&mut self, result: &Value) -> Result<(), String> {
        let results = result
            .get("results")
            .and_then(Value::as_array)
            .ok_or("Missing condition results")?;
        let mut index = 0;
        visit_definition(&mut self.compiled.normalized, &mut |condition| {
            if let ConditionExpr::Script { result, .. } = condition {
                *result = results.get(index).cloned();
                index += 1;
            }
        });
        if index != results.len() {
            return Err("Condition result count changed".into());
        }
        self.evaluation.condition = super::evaluate::evaluate_condition(
            &self.compiled.normalized.condition,
            super::evaluate::EvaluationView {
                devices: &self.after,
                groups: &self.groups,
                helpers: Some(&self.helpers),
            },
            "/condition",
        );
        self.evaluation.will_trigger = !self.evaluation.matched_trigger_ids.is_empty()
            && self.evaluation.condition.authorizes_execution();
        Ok(())
    }
    pub fn frame(&self) -> FrameContext<'_> {
        FrameContext {
            before: &self.before,
            after: &self.after,
            mutations: &self.mutations,
            groups: &self.groups,
            helpers: Some(&self.helpers),
            fired_timers: &[],
            predicate_fires: &[],
            schedule_fires: &[],
        }
    }
}

impl ScriptExecution {
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_conditions(
        &mut self,
        compiled: &CompiledDefinition,
        evaluation: &RoutineFrameEvaluation,
        frame: &FrameContext<'_>,
        intents: &IntentTracker,
        frame_id: EventId,
        origin: EventOrigin,
        causation: EventCausation,
        now_ms: i64,
        source: Option<DeviceKey>,
    ) -> Result<PreparedScriptRun, String> {
        if self.pending_conditions.len() >= 64 {
            return Err("Too many pending condition evaluations".into());
        }
        let owner = ScriptOwnerId::routine(evaluation.routine_id.0.clone());
        let mut specs = Vec::new();
        visit_definition(&mut compiled.normalized.clone(), &mut |condition| {
            if let ConditionExpr::Script { spec, .. } = condition {
                specs.push(spec.clone());
            }
        });
        let mut contexts = Vec::new();
        let mut body = String::from("const results=[];\n");
        for (i, spec) in specs.iter().enumerate() {
            contexts.push(
                self.build_handler_context(
                    &owner, spec, frame, frame_id, origin, causation, now_ms,
                )?,
            );
            body.push_str(&format!("try {{ results.push({{value:(function(ctx) {{\n{}\n}})(ctx.blocks[{}])}}); }} catch(e) {{ results.push({{error:String(e.message || e)}}); }}\n",spec.source_body,i));
        }
        body.push_str("return {results};");
        let spec = ScriptSpec {
            api_version: 1,
            source_body: body,
            functions: vec![],
            inputs: Default::default(),
            declarations: vec![],
            limits_profile: "default".into(),
        };
        let mut run = self.prepare_handler_invocation(
            &evaluation.routine_id,
            evaluation.definition_revision,
            &spec,
            compiled.normalized.execution.mode,
            frame,
            intents,
            frame_id,
            origin,
            causation,
            now_ms,
            source,
        )?;
        run.context["blocks"] = json!(contexts);
        self.pending_conditions.insert(
            run.token.request_id,
            PendingConditions {
                compiled: compiled.clone(),
                evaluation: evaluation.clone(),
                before: frame.before.clone(),
                after: frame.after.clone(),
                groups: frame.groups.clone(),
                helpers: frame.helpers.cloned().unwrap_or_default(),
                intents: intents.clone(),
                mutations: frame.mutations.to_vec(),
                frame_id,
                origin,
                now_ms,
            },
        );
        Ok(run)
    }
    pub fn take_conditions(&mut self, id: u64) -> Option<PendingConditions> {
        self.pending_conditions.remove(&id)
    }
}
