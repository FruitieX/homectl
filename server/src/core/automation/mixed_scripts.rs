//! Sandboxed action blocks expand inside a frozen native plan. No effects run
//! until every selected block succeeds. Branches, native targets and their
//! intent guards stay frozen while the worker executes off the actor.
use super::plan::{plan_script_actions, PlanInputs, PlannedStepBody, RoutinePlan};
use crate::types::{automation_definition::NativeAction, device::DeviceKey};

pub fn contains_scripts(plan: &RoutinePlan) -> bool {
    plan.steps
        .iter()
        .any(|step| matches!(step.body, PlannedStepBody::Script { .. }))
}

pub fn expand_plan(
    mut plan: RoutinePlan,
    actions: &[NativeAction],
    inputs: &PlanInputs<'_>,
    source_device: Option<DeviceKey>,
) -> Result<RoutinePlan, String> {
    let expected: Vec<_> = plan
        .steps
        .iter()
        .filter(|s| matches!(s.body, PlannedStepBody::Script { .. }))
        .map(|s| s.action_id.clone())
        .collect();
    if actions.len() != expected.len()
        || actions
            .iter()
            .zip(&expected)
            .any(|(action, id)| action.id() != id)
    {
        return Err("script step results do not match the selected action blocks".into());
    }
    let mut results = actions.iter();
    let mut expanded = Vec::new();
    for step in std::mem::take(&mut plan.steps) {
        if matches!(step.body, PlannedStepBody::Script { .. }) {
            let result = results.next().expect("result count checked");
            let NativeAction::Choose { branches, .. } = result else {
                return Err("script block result envelope is invalid".into());
            };
            if branches.len() != 1
                || branches[0].condition
                    != (crate::types::automation_definition::ConditionExpr::Literal { value: true })
            {
                return Err("script block result branch is invalid".into());
            }
            let part = plan_script_actions(
                &plan.routine_id,
                plan.definition_revision,
                &branches[0].steps,
                inputs,
                source_device.clone(),
            );
            if contains_scripts(&part) {
                return Err("a script cannot return another script action".into());
            }
            expanded.extend(part.steps);
            plan.suppressions.extend(part.suppressions);
        } else {
            expanded.push(step);
        }
    }
    if expanded.len() > super::plan::MAX_PLANNED_STEPS {
        return Err("expanded script actions exceed the run limit".into());
    }
    plan.steps = expanded;
    Ok(plan)
}
