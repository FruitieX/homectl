//! Computed helpers use worker invocations; the actor only captures and publishes data.
use super::{
    compile::ConfigCatalog,
    evaluate::FrameContext,
    script_coordinator::{CompleteResult, InvocationToken, ScriptOwnerId},
};
use crate::{
    core::{helpers::ComputationCursor, snapshot::SnapshotChanges, state::AppState},
    types::{
        automation_definition::HelperId,
        automation_event::{EventCausation, EventId, EventOrigin},
        automation_value::HelperComputeStatus,
    },
};
use serde_json::{json, Value};

impl AppState {
    pub async fn dispatch_due_helpers(&mut self) -> SnapshotChanges {
        let definitions: Vec<_> = self
            .helpers
            .definitions()
            .values()
            .filter(|helper| {
                helper
                    .compute
                    .as_ref()
                    .is_some_and(|compute| compute.enabled)
            })
            .cloned()
            .collect();
        if definitions.is_empty() {
            return SnapshotChanges::none();
        }
        let now = self.clock.wall_ms();
        let catalog = ConfigCatalog::new(
            self.devices.get_state().0.keys().cloned(),
            &self.runtime_config,
        );
        let mut changed = false;
        for definition in definitions {
            let compute = definition.compute.as_ref().expect("computed helper");
            let result = self.capture_helper(&definition, now);
            let (context, fingerprint) = match result {
                Ok(result) => result,
                Err(error) => {
                    self.helper_failure(&definition.id, error, now);
                    changed = true;
                    continue;
                }
            };
            if self
                .helpers
                .computations
                .get(&definition.id)
                .is_some_and(|cursor| {
                    cursor.fingerprint == fingerprint
                        && now.saturating_sub(cursor.dispatched_at_ms) < compute.refresh_ms as i64
                })
            {
                continue;
            }
            // Mark before admission, so a failure retries at the cadence instead of every command.
            let keep_fresh = self
                .helpers
                .computations
                .get(&definition.id)
                .is_some_and(|cursor| {
                    cursor.fingerprint == fingerprint
                        && cursor
                            .status
                            .as_ref()
                            .is_some_and(|status| status.state == "fresh")
                });
            let publishable = self.helpers.value_is_known(&definition.id);
            let previous = self
                .helpers
                .computations
                .get(&definition.id)
                .and_then(|cursor| cursor.status.as_ref())
                .and_then(|status| status.evaluated_at_ms);
            self.helpers.computations.insert(
                definition.id.clone(),
                ComputationCursor {
                    fingerprint,
                    dispatched_at_ms: now,
                    request_id: None,
                    status: Some(HelperComputeStatus {
                        state: if keep_fresh {
                            "fresh"
                        } else if publishable {
                            "updating"
                        } else {
                            "pending"
                        }
                        .into(),
                        evaluated_at_ms: previous,
                        error: None,
                    }),
                },
            );
            changed = true;
            self.helpers.changed = true;
            let spec = match super::reuse::resolve_spec(&compute.script, &catalog) {
                Ok(spec) => spec,
                Err(error) => {
                    self.helper_failure(&definition.id, error, now);
                    continue;
                }
            };
            let body = format!(
                "return {{value:(function(ctx) {{\n{}\n}})(ctx)}};",
                spec.source_body
            );
            let run = match self.scripts.prepare_helper_invocation(
                &definition.id,
                compute.revision,
                body,
                context,
            ) {
                Ok(run) => run,
                Err(error) => {
                    self.helper_failure(&definition.id, error, now);
                    continue;
                }
            };
            self.helpers
                .computations
                .get_mut(&definition.id)
                .expect("cursor")
                .request_id = Some(run.token.request_id);
            match self.scripts.ensure_pool().await {
                Ok(pool) => self
                    .scripts
                    .spawn_helper_execution(pool, self.event_tx.clone(), run),
                Err(error) => {
                    self.scripts.abandon_source(&run.token).ok();
                    self.helper_failure(&definition.id, error, now);
                }
            }
        }
        SnapshotChanges {
            helper_statuses: changed,
            ..SnapshotChanges::none()
        }
    }

    fn capture_helper(
        &mut self,
        definition: &crate::types::automation_value::HelperDefinition,
        now: i64,
    ) -> Result<(Value, String), String> {
        let compute = definition
            .compute
            .as_ref()
            .ok_or("Helper is not computed")?;

        let frame = FrameContext {
            before: self.devices.get_state(),
            after: self.devices.get_state(),
            mutations: &[],
            groups: &self.groups,
            helpers: Some(&self.helpers),
            fired_timers: &[],
            predicate_fires: &[],
            schedule_fires: &[],
        };
        let mut context = self.scripts.build_handler_context(
            &ScriptOwnerId::helper(definition.id.to_string()),
            &compute.script,
            &frame,
            EventId::default(),
            EventOrigin::Derived,
            EventCausation::default(),
            now,
        )?;
        if let Some(helpers) = context["values"]["helpers"].as_object_mut() {
            helpers.retain(|id, _| compute.helpers.iter().any(|helper| helper.as_str() == id));
        }
        let fingerprint=serde_json::to_string(&json!({"devices":context["after"],"helpers":context["values"],"revision":compute.revision})).map_err(|error| error.to_string())?;
        Ok::<_, String>((context, fingerprint))
    }

    fn helper_failure(&mut self, id: &HelperId, error: String, now: i64) {
        self.helpers.capture_before();
        let cursor = self.helpers.computations.entry(id.clone()).or_default();
        let evaluated_at_ms = cursor
            .status
            .as_ref()
            .and_then(|status| status.evaluated_at_ms);
        cursor.status = Some(HelperComputeStatus {
            state: "stale".into(),
            evaluated_at_ms,
            error: Some(super::bounded_text(&error)),
        });
        cursor.dispatched_at_ms = now;
        cursor.request_id = None;
        self.helpers.changed = true;
    }

    pub(crate) fn complete_helper(
        &mut self,
        id: &HelperId,
        token: &InvocationToken,
        value: Option<&Value>,
        error: Option<&String>,
    ) -> Option<crate::types::automation_value::HelperValueState> {
        // A newer dependency frame may already have been admitted.
        if self
            .helpers
            .computations
            .get(id)
            .and_then(|cursor| cursor.request_id)
            != Some(token.request_id)
        {
            self.scripts.abandon_source(token).ok();
            return None;
        }
        let now = self.clock.wall_ms();
        let definition = self.helpers.definition(id)?.clone();
        let (_, fingerprint) = self.capture_helper(&definition, now).ok()?;
        if self
            .helpers
            .computations
            .get(id)
            .is_none_or(|cursor| cursor.fingerprint != fingerprint)
        {
            self.scripts.abandon_source(token).ok();
            if let Some(cursor) = self.helpers.computations.get_mut(id) {
                cursor.request_id = None;
            }
            return None;
        }
        let result = match (value, error) {
            (_, Some(error)) => self
                .scripts
                .abandon_source(token)
                .map(|_| Err(error.clone()))
                .ok(),
            (Some(value), None) => match self.scripts.complete_computed_source(token, value) {
                CompleteResult::Applied { value, .. } => Some(Ok(value.value)),
                CompleteResult::ContractError { message } => Some(Err(message)),
                CompleteResult::Stale(_) => None,
            },
            _ => {
                self.scripts.abandon_source(token).ok();
                Some(Err("Worker returned no helper value.".into()))
            }
        }?;
        match result.and_then(|value| {
            self.helpers
                .write_value(id, value)
                .map_err(|error| error.to_string())
        }) {
            Ok(updated) => {
                let cursor = self.helpers.computations.get_mut(id)?;
                cursor.request_id = None;
                cursor.status = Some(HelperComputeStatus {
                    state: "fresh".into(),
                    evaluated_at_ms: Some(now),
                    error: None,
                });
                self.helpers.changed = true;
                Some(updated)
            }
            Err(error) => {
                self.helper_failure(id, error, now);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::event::{handle_event, tests::test_state};
    use crate::types::{
        automation_value::{HelperDefinition, HelperKind},
        event::Event,
    };

    fn fixture(source: &str) -> (AppState, crate::types::event::RxEventChannel) {
        let (mut state, events) = test_state();
        let mut binary = std::env::current_exe().unwrap();
        binary.pop();
        binary.pop();
        binary.push("script-worker");
        state.scripts.worker_binary = Some(binary);
        let input = HelperDefinition::new(
            "input",
            "Input",
            HelperKind::Number {
                min: None,
                max: None,
            },
        );
        let derived:HelperDefinition=serde_json::from_value(json!({"id":"derived","name":"Derived","kind":{"kind":"number"},"initial_value":0,"compute":{"script":{"api_version":1,"source_body":source,"declarations":[],"limits_profile":"default"},"helpers":["input"],"refresh_ms":60000,"enabled":true,"revision":1}})).unwrap();
        state.runtime_config.helpers = vec![input, derived];
        state.apply_runtime_helpers();
        (state, events)
    }
    async fn result(events: &mut crate::types::event::RxEventChannel) -> Event {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let event = events.recv().await.unwrap();
                if matches!(event, Event::HelperScriptResult { .. }) {
                    return event;
                }
            }
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn computed_helpers_publish_only_current_inputs_and_are_read_only() {
        let (mut state, mut events) = fixture("return api.values.get('input').value * 2;");
        let input = HelperId("input".into());
        let derived = HelperId("derived".into());
        state.dispatch_due_helpers().await;
        let obsolete = result(&mut events).await;
        // A value changed in an API mutate closure before the old worker completion.
        state.helpers.set_value(&input, json!(3)).unwrap();
        handle_event(&mut state, &obsolete).await.unwrap();
        assert_eq!(
            state.helpers.value(&derived),
            Some(&json!(0)),
            "old result must never publish"
        );
        let current = result(&mut events).await;
        handle_event(&mut state, &current).await.unwrap();
        assert_eq!(state.helpers.value(&derived), Some(&json!(6)));
        assert!(state.helpers.value_is_known(&derived));
        assert!(state.helpers.set_value(&derived, json!(99)).is_err());
        assert_eq!(
            state
                .helpers
                .statuses()
                .iter()
                .find(|helper| helper.id == derived)
                .unwrap()
                .compute_status
                .as_ref()
                .unwrap()
                .state,
            "fresh"
        );
    }

    #[tokio::test]
    async fn failures_retain_last_good_but_resolve_unknown_and_edits_reject_old_results() {
        let (mut state, mut events) = fixture(
            "const value=api.values.get('input').value; return value === 0 ? 10 : 'wrong type';",
        );
        let derived = HelperId("derived".into());
        let input = HelperId("input".into());
        state.dispatch_due_helpers().await;
        let event = result(&mut events).await;
        handle_event(&mut state, &event).await.unwrap();
        assert_eq!(state.helpers.value(&derived), Some(&json!(10)));
        state.helpers.set_value(&input, json!(1)).unwrap();
        state.dispatch_due_helpers().await;
        let event = result(&mut events).await;
        handle_event(&mut state, &event).await.unwrap();
        assert_eq!(state.helpers.value(&derived), Some(&json!(10)));
        assert!(!state.helpers.value_is_known(&derived));
        let resolved = super::super::evaluate::resolve_value(
            &crate::types::automation_definition::ValueSource::Helper {
                helper: derived.clone(),
            },
            super::super::evaluate::EvaluationView {
                devices: state.devices.get_state(),
                groups: &state.groups,
                helpers: Some(&state.helpers),
            },
        );
        assert!(resolved.value.is_none());
        state.helpers.set_value(&input, json!(0)).unwrap();
        state.dispatch_due_helpers().await;
        let obsolete = result(&mut events).await;
        state.runtime_config.helpers[1]
            .compute
            .as_mut()
            .unwrap()
            .revision = 2;
        state.runtime_config.helpers[1]
            .compute
            .as_mut()
            .unwrap()
            .script
            .source_body = "return 20;".into();
        state.apply_runtime_helpers();
        handle_event(&mut state, &obsolete).await.unwrap();
        assert_ne!(
            state.helpers.value(&derived),
            Some(&json!(0)),
            "definition reload must retain last good value"
        );
        let current = result(&mut events).await;
        handle_event(&mut state, &current).await.unwrap();
        assert_eq!(state.helpers.value(&derived), Some(&json!(20)));
    }

    #[tokio::test]
    async fn computed_changes_drive_native_helper_predicate_transitions() {
        let (mut state, mut events) = fixture("return api.values.get('input').value * 2;");
        let fired = HelperDefinition::new("fired", "Fired", HelperKind::Boolean);
        state.runtime_config.helpers.push(fired);
        state.apply_runtime_helpers();
        state.runtime_config.routines=serde_json::from_value(json!([{"id":"edge","name":"Edge","enabled":true,"semantics_version":2,"revision":1,"rules":[],"actions":[],"definition_v2":{"triggers":[{"kind":"predicate_transition","id":"rise","predicate":{"kind":"comparison","source":{"kind":"helper","helper":"derived"},"operator":"gt","value":3}}],"program":{"kind":"native","steps":[{"action":"set_helper","id":"fired","helper":"fired","value":true}]}}}])).unwrap();
        state.apply_runtime_routines();
        state.dispatch_due_helpers().await;
        let event = result(&mut events).await;
        handle_event(&mut state, &event).await.unwrap();
        state.flush_pending_frames().await;
        state
            .helpers
            .set_value(&HelperId("input".into()), json!(3))
            .unwrap();
        state.dispatch_due_helpers().await;
        let event = result(&mut events).await;
        handle_event(&mut state, &event).await.unwrap();
        state.flush_pending_frames().await;
        let action = tokio::time::timeout(std::time::Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(action, Event::RoutineSetHelper { .. }));
        handle_event(&mut state, &action).await.unwrap();
        assert_eq!(
            state.helpers.value(&HelperId("fired".into())),
            Some(&json!(true))
        );
    }
}
