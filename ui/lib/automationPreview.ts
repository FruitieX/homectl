import type { ConditionEvaluation } from '../bindings/ConditionEvaluation';
import type { PlannedStepStatus } from '../bindings/PlannedStepStatus';
import type { LogEntityReference } from '../bindings/LogEntityReference';

/** The read-only reuse-preview response; values can be any serializable JSON. */
export type ReusePreviewResponse =
  | { kind: 'function' | 'helper'; value: unknown }
  | { kind: 'condition'; value: ConditionEvaluation }
  | {
      kind: 'action';
      steps: PlannedStepStatus[];
      suppressions: PlannedStepStatus[];
      script_results: unknown[];
      dispatched: false;
    };

export function conditionResult(
  condition: Pick<ConditionEvaluation, 'truth' | 'error'>,
) {
  if (condition.error !== undefined)
    return { label: 'Could not evaluate', tone: 'error' as const };
  if (condition.truth === 'true')
    return { label: 'Condition met', tone: 'success' as const };
  if (condition.truth === 'false')
    return { label: 'Condition not met', tone: 'neutral' as const };
  return { label: 'Condition unknown', tone: 'warning' as const };
}

const actionLabels: Record<string, string> = {
  activate_scene: 'Activate scene',
  cycle_scenes: 'Cycle scenes',
  dim: 'Adjust brightness',
  set_power: 'Set power',
  set_brightness: 'Set brightness',
  set_color: 'Set color',
  set_device_state: 'Set device state',
  set_helper: 'Set helper value',
  toggle_helper: 'Toggle helper',
  force_trigger_routine: 'Run routine',
  integration_action: 'Run integration action',
  timer_start: 'Start timer',
  timer_cancel: 'Cancel timer',
  timer_restart: 'Restart timer',
  run_script: 'Run script',
  schedule_timer: 'Schedule timer',
  replace_timer: 'Replace timer',
  cancel_timer: 'Cancel timer',
  invoke_routine: 'Run routine',
  randomize_color: 'Randomize color',
};
export function previewActionLabel(kind: string) {
  return (
    actionLabels[kind] ??
    kind.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

/** Older routine previews lack typed references. Infer only unambiguous targets. */
export function previewReferences(step: {
  kind: string;
  targets: string[];
  references?: LogEntityReference[];
}): LogEntityReference[] {
  if (step.references !== undefined) return step.references;
  if (step.kind === 'set_helper' || step.kind === 'toggle_helper')
    return step.targets.map((entity_id) => ({ entity: 'helper', entity_id }));
  if (step.kind === 'force_trigger_routine' || step.kind === 'invoke_routine')
    return step.targets.map((entity_id) => ({ entity: 'routine', entity_id }));
  if (step.kind === 'activate_scene')
    return step.targets.map((entity_id, i) => ({
      entity: i === 0 ? 'scene' : entity_id.includes('/') ? 'device' : 'group',
      entity_id,
    }));
  if (
    [
      'dim',
      'set_power',
      'set_brightness',
      'set_color',
      'set_device_state',
      'randomize_color',
    ].includes(step.kind)
  )
    return step.targets.map((entity_id) => ({
      entity: entity_id.includes('/') ? 'device' : 'group',
      entity_id,
    }));
  return [];
}

export function scalarPreviewValue(value: unknown): string | undefined {
  if (value === null) return 'Null';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || 'Empty text';
  return undefined;
}
