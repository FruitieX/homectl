//! Draft previews capture data in the actor, then execute workers outside it.
use super::*;
use crate::core::automation::{
    evaluate::FrameContext, reuse, script_coordinator::ScriptOwnerId,
    script_runtime::ScriptExecution,
};
use crate::types::{
    automation_block::{AutomationBlock, BlockKind},
    automation_definition::{Program, RoutineDefinitionV2, ScriptSpec},
    automation_event::{EventCausation, EventId, EventOrigin},
};
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum PreviewRequest {
    Block {
        block: AutomationBlock,
        #[serde(default)]
        inputs: BTreeMap<String, Value>,
    },
    Helper {
        helper: HelperDefinition,
    },
}

pub(super) fn routes(
    handle: &StateHandle,
) -> impl Filter<Extract = (impl Reply,), Error = warp::Rejection> + Clone {
    warp::path("reuse-preview")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::content_length_limit(131072))
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(preview)
}

async fn preview(
    request: PreviewRequest,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let captured = handle
        .mutate(|state| {
            Box::pin(async move {
                (
                    state.runtime_config.clone(),
                    state.devices.get_state().clone(),
                    state.groups.clone(),
                    state.helpers.clone(),
                    state.intents.clone(),
                    state.clock.wall_ms(),
                )
            })
        })
        .await;
    let (mut config, devices, groups, helpers, intents, now) = match captured {
        Ok(value) => value,
        Err(_) => return Ok(actor_unavailable()),
    };
    let result:Result<Value,String>=async {
        let mut scripts=ScriptExecution::default();
        let frame=FrameContext {before:&devices,after:&devices,mutations:&[],groups:&groups,helpers:Some(&helpers),fired_timers:&[],predicate_fires:&[],schedule_fires:&[]};
        let context=|scripts:&mut ScriptExecution,spec:&ScriptSpec| scripts.build_handler_context(&ScriptOwnerId::routine("preview"),spec,&frame,EventId::default(),EventOrigin::Derived,EventCausation::default(),now);
        match request {
            PreviewRequest::Helper {helper}=>{
                let compute=helper.compute.as_ref().ok_or("Choose a computed helper to preview.")?;
                config.helpers.retain(|existing|existing.id!=helper.id);config.helpers.push(helper.clone());
                let catalog=ConfigCatalog::new(devices.0.keys().cloned(),&config).with_group(crate::types::group::GroupId("preview_placeholder".into()));
                reuse::validate_helpers(&config,&catalog)?;
                let spec=reuse::resolve_spec(&compute.script,&catalog)?;
                let mut ctx=context(&mut scripts,&spec)?;
                if let Some(values)=ctx["values"]["helpers"].as_object_mut() {values.retain(|id,_|compute.helpers.iter().any(|helper|helper.as_str()==id));}
                let value=reuse::preview_execute(&spec.source_body,ctx).await?;
                helper.kind.validate_value(&value)?;
                Ok(json!({"value":value,"kind":"helper"}))
            },
            PreviewRequest::Block {block,inputs}=>{
                automation::blocks::validate_block(&block).map_err(|error|error.to_string())?;
                config.blocks.retain(|existing|existing.id!=block.id);config.blocks.push(block.clone());
                let catalog=ConfigCatalog::new(devices.0.keys().cloned(),&config).with_group(crate::types::group::GroupId("preview_placeholder".into()));
                automation::blocks::validate_catalog(&catalog).map_err(|error|error.to_string())?;
                if block.kind==BlockKind::Function {
                    let spec=ScriptSpec {api_version:1,source_body:format!("return api.functions.call({},inputs);",serde_json::to_string(&block.id).map_err(|error|error.to_string())?),functions:vec![block.id.clone()],inputs,declarations:vec![],limits_profile:"default".into()};
                    let spec=reuse::resolve_spec(&spec,&catalog)?;
                    let value=reuse::preview_execute(&spec.source_body,context(&mut scripts,&spec)?).await?;
                    return Ok(json!({"kind":"function","value":value}));
                }
                let call=json!({"id":"preview","block_id":block.id,"inputs":inputs});
                let definition=if block.kind==BlockKind::Action {
                    json!({"triggers":[{"kind":"manual","id":"preview_trigger"}],"program":{"kind":"native","steps":[{"action":"call_block","id":"preview","block_id":block.id,"inputs":inputs}]}})
                } else {json!({"triggers":[{"kind":"manual","id":"preview_trigger"}],"condition":{"kind":"block","block_id":call["block_id"],"inputs":call["inputs"]},"program":{"kind":"native","steps":[{"action":"dim","id":"preview_dim","step":0.1,"targets":{"groups":["preview_placeholder"]}}]}})};
                let mut compiled=automation::compile_definition_value(&definition,&catalog).map_err(|report|report.summary())?;
                let mut specs=Vec::new();
                automation::conditions::visit_definition(&mut compiled.normalized,&mut |condition| if let crate::types::automation_definition::ConditionExpr::Script {spec,..}=condition {specs.push(spec.clone());});
                let mut results=Vec::new();
                for spec in specs {results.push(json!({"value":reuse::preview_execute(&spec.source_body,context(&mut scripts,&spec)?).await?}));}
                let mut index=0;
                automation::conditions::visit_definition(&mut compiled.normalized,&mut |condition|if let crate::types::automation_definition::ConditionExpr::Script {result,..}=condition {*result=results.get(index).cloned();index+=1;});
                if block.kind==BlockKind::Condition {
                    let condition=automation::evaluate_condition(&compiled.normalized.condition,automation::EvaluationView {devices:&devices,groups:&groups,helpers:Some(&helpers)},"/condition");
                    return Ok(json!({"kind":"condition","value":condition}));
                }
                let Program::Native(program)=&compiled.normalized.program else {return Err("Unexpected block expansion.".into());};
                let inputs=automation::PlanInputs {devices:&devices,groups:&groups,helpers:&helpers,intents:&intents};
                let plan=automation::plan_script_actions(&"preview".to_string().into(),1,&program.steps,&inputs,None);
                let mut actions=Vec::new();
                for step in &plan.steps {
                    if let automation::PlannedStepBody::Script {spec}=&step.body {
                        let output=reuse::preview_execute(&spec.source_body,context(&mut scripts,spec)?).await?;
                        let output=automation::parse_routine_handler_outcome(&output,automation::MAX_SCRIPT_STATE_BYTES)?;
                        let steps=output.actions.into_iter().enumerate().map(|(index,action)|{
                            let mut value=serde_json::to_value(action).map_err(|error|error.to_string())?;
                            value["id"]=json!(format!("{}/{}",step.action_id.0,index));
                            serde_json::from_value(value).map_err(|error|error.to_string())
                        }).collect::<Result<Vec<crate::types::automation_definition::NativeAction>,String>>()?;
                        actions.push(crate::types::automation_definition::NativeAction::Choose {
                            id:step.action_id.clone(), branches:vec![crate::types::automation_definition::ChooseBranch {
                                id:crate::types::automation_definition::NodeId(format!("{}/result",step.action_id.0)),
                                condition:crate::types::automation_definition::ConditionExpr::Literal {value:true},steps
                            }]
                        });
                    }
                }
                // Compile returned actions and expand the selected plan, never dispatch it.
                if !actions.is_empty() {
                    let validation:RoutineDefinitionV2=serde_json::from_value(json!({"triggers":[{"kind":"manual","id":"preview_trigger"}],"program":{"kind":"native","steps":actions}})).map_err(|error|error.to_string())?;
                    automation::compile_definition(&validation,&catalog).map_err(|report|report.summary())?;
                }
                let plan=automation::mixed_scripts::expand_plan(plan,&actions,&inputs,None)?;
                let steps:Vec<_>=plan.steps.iter().map(|step|automation::step_status(step,crate::types::automation_trace::StepDisposition::Dispatched,None)).collect();
                Ok(json!({"kind":"action","script_results":actions,"steps":steps,"suppressions":plan.suppressions,"dispatched":false}))
            }
        }
    }.await;
    match result {
        Ok(value) => Ok(ApiResponse::success(value)),
        Err(error) => Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    async fn run(request: PreviewRequest, handle: &StateHandle) -> (StatusCode, Value) {
        let response = preview(request, handle.clone())
            .await
            .unwrap()
            .into_response();
        let status = response.status();
        let body = warp::hyper::body::to_bytes(response.into_body())
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }
    #[tokio::test]
    async fn previews_check_typed_contracts_select_branches_and_dispatch_nothing() {
        let (mut state, mut events) = crate::core::event::tests::test_state();
        let helper = HelperDefinition::new(
            "flag",
            "Flag",
            crate::types::automation_value::HelperKind::Boolean,
        );
        state.runtime_config.helpers = vec![helper];
        state.apply_runtime_helpers();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), tx);
        let function:AutomationBlock=serde_json::from_value(json!({"id":"double","name":"Double","kind":"function","inputs":{"n":{"label":"Number","kind":{"kind":"number"}}},"body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return inputs.n*2;","declarations":[],"limits_profile":"default"},"output":{"kind":"number"}}})).unwrap();
        let (status, body) = run(
            PreviewRequest::Block {
                block: function.clone(),
                inputs: BTreeMap::from([("n".into(), json!(3))]),
            },
            &handle,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["value"], 6);
        assert_eq!(
            run(
                PreviewRequest::Block {
                    block: function,
                    inputs: BTreeMap::from([("n".into(), json!("bad"))])
                },
                &handle
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let condition:AutomationBlock=serde_json::from_value(json!({"id":"ready","name":"Ready","kind":"condition","body":{"kind":"javascript","spec":{"api_version":1,"source_body":"return true;","declarations":[],"limits_profile":"default"}}})).unwrap();
        let (status, body) = run(
            PreviewRequest::Block {
                block: condition,
                inputs: BTreeMap::new(),
            },
            &handle,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["value"]["truth"], "true");
        let action:AutomationBlock=serde_json::from_value(json!({"id":"mixed","name":"Mixed","kind":"action","inputs":{"value":{"label":"Value","kind":{"kind":"boolean"}}},"body":[{"action":"choose","id":"choose","branches":[{"id":"skip","condition":{"kind":"literal","value":false},"steps":[{"action":"run_script","id":"never","spec":{"api_version":1,"source_body":"throw new Error('wrong branch');","declarations":[],"limits_profile":"default"}}]},{"id":"selected","condition":{"kind":"literal","value":true},"steps":[{"action":"run_script","id":"write","spec":{"api_version":1,"source_body":"return {actions:[api.actions.setHelper({helper:'flag',value:inputs.value})]};","declarations":[],"limits_profile":"default"}}]}]}]})).unwrap();
        let (status, body) = run(
            PreviewRequest::Block {
                block: action,
                inputs: BTreeMap::from([("value".into(), json!(true))]),
            },
            &handle,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["steps"].as_array().unwrap().len(), 1);
        assert_eq!(body["data"]["dispatched"], false);
        let computed:HelperDefinition=serde_json::from_value(json!({"id":"calculated","name":"Calculated","kind":{"kind":"number"},"initial_value":0,"persistence":"durable","compute":{"enabled":true,"revision":1,"refresh_ms":1000,"helpers":[],"script":{"api_version":1,"source_body":"return 42;","declarations":[],"limits_profile":"default"}}})).unwrap();
        let (status, body) = run(PreviewRequest::Helper { helper: computed }, &handle).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["value"], 42);
        assert_eq!(snapshot.load().helper_statuses[0].value, json!(false));
        assert!(snapshot.load().runtime_config.blocks.is_empty());
        assert!(
            events.try_recv().is_err(),
            "draft previews never dispatch commands"
        );
    }
}
