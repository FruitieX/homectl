import type { Routine } from '../hooks/useConfig';
import type { FieldError } from './configSection.ts';
import { createUuid } from './uuid.ts';
import type { SceneSelection } from '../bindings/SceneSelection';

/** Future or malformed selection definitions stay visible without being coerced. */
export function isEditableSceneSelection(
  value: unknown,
): value is SceneSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  if (
    selection.fallback_scene_id != null &&
    typeof selection.fallback_scene_id !== 'string'
  )
    return false;
  if (selection.kind === 'group_active')
    return typeof selection.group_id === 'string';
  return (
    selection.kind === 'helper_enum' &&
    typeof selection.helper === 'string' &&
    selection.mapping !== null &&
    typeof selection.mapping === 'object' &&
    !Array.isArray(selection.mapping) &&
    Object.values(selection.mapping).every((scene) => typeof scene === 'string')
  );
}
/** These are JSON numbers on the wire. Never silently round a u64 into an unsafe JS integer. */
export function stringifyConfig(value: unknown): string {
  return JSON.stringify(value, (key, entry) => {
    if (typeof entry === 'bigint') {
      const number = Number(entry);
      if (!Number.isSafeInteger(number))
        throw new Error(
          `${key || 'Value'} exceeds the supported integer precision.`,
        );
      return number;
    }
    if (
      typeof entry === 'number' &&
      (!Number.isFinite(entry) ||
        ((key.endsWith('_ms') || key === 'revision') &&
          !Number.isSafeInteger(entry)))
    )
      throw new Error(`${key || 'Value'} must be a finite, safe integer.`);
    return entry;
  });
}
export function moveSibling<T>(
  values: readonly T[],
  index: number,
  offset: number,
): T[] {
  const next = [...values],
    destination = index + offset;
  if (
    index < 0 ||
    index >= next.length ||
    destination < 0 ||
    destination >= next.length
  )
    return next;
  const [value] = next.splice(index, 1);
  next.splice(destination, 0, value);
  return next;
}
/** Only schema-defined node identities are renewed; IDs in payloads stay intact. */
export function duplicateRoutineNode<T>(value: T): T {
  const copy = structuredClone(value);
  const object = (item: unknown): Record<string, unknown> | undefined =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : undefined;
  const renew = (item: Record<string, unknown>) => {
    item.id = createUuid();
  };
  const steps = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const step = object(item);
      if (!step) continue;
      renew(step);
      if (step.action === 'choose' && Array.isArray(step.branches)) {
        for (const item of step.branches) {
          const branch = object(item);
          if (branch) {
            renew(branch);
            steps(branch.steps);
          }
        }
      }
    }
  };
  const root = object(copy);
  if (!root) return copy;
  if ('action' in root) steps([root]);
  else {
    if (Array.isArray(root.triggers))
      for (const item of root.triggers) {
        const trigger = object(item);
        if (trigger) renew(trigger);
      }
    const program = object(root.program);
    if (program?.kind === 'native') steps(program.steps);
  }
  return copy;
}
export function validateRoutineDraft(routine: Routine): FieldError[] {
  const errors: FieldError[] = [];
  if (!routine.name.trim())
    errors.push({ field: 'name', message: 'Give this routine a name.' });
  if (!routine.id.trim())
    errors.push({ field: 'id', message: 'Choose a routine ID.' });
  try {
    stringifyConfig(routine);
  } catch (error) {
    errors.push({ field: 'definition_v2', message: (error as Error).message });
  }
  const ids = new Set<string>();
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const checkId = (node: Record<string, unknown>, path: string) => {
    if (typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id))
      errors.push({
        field: 'definition_v2',
        message: `Node IDs must be nonempty and unique at ${path} (${String(node.id)}).`,
      });
    else ids.add(node.id);
  };
  const condition = (value: unknown, path: string) => {
    const node = object(value);
    if (!node) return;
    if (
      (node.kind === 'all' || node.kind === 'any') &&
      Array.isArray(node.conditions)
    ) {
      if (!node.conditions.length)
        errors.push({
          field: 'definition_v2',
          message: `Add a condition or remove the empty All/Any group at ${path}.`,
        });
      node.conditions.forEach((child, index) =>
        condition(child, `${path}/conditions/${index}`),
      );
    } else if (node.kind === 'not')
      condition(node.condition, path + '/condition');
  };
  const steps = (value: unknown, path: string) => {
    if (!Array.isArray(value)) return;
    value.forEach((value, index) => {
      const step = object(value),
        stepPath = `${path}/${index}`;
      if (!step) return;
      checkId(step, stepPath);
      if (
        step.action === 'cycle_scenes' &&
        Array.isArray(step.scenes) &&
        step.scenes.length === 0
      )
        errors.push({
          field: `step/${step.id}/cycle_scenes/scenes`,
          message:
            'Add at least one scene to this cycle, or remove the action.',
        });
      if (step.action === 'choose' && Array.isArray(step.branches))
        step.branches.forEach((value, index) => {
          const branch = object(value),
            branchPath = `${stepPath}/branches/${index}`;
          if (!branch) return;
          checkId(branch, branchPath);
          condition(branch.condition, branchPath + '/condition');
          steps(branch.steps, branchPath + '/steps');
        });
    });
  };
  if (routine.semantics_version === 2) {
    const definition = object(routine.definition_v2);
    if (definition) {
      if (Array.isArray(definition.triggers))
        definition.triggers.forEach((value, index) => {
          const trigger = object(value),
            path = `triggers/${index}`;
          if (trigger) {
            checkId(trigger, path);
            condition(trigger.predicate, path + '/predicate');
          }
        });
      condition(definition.condition, 'condition');
      const program = object(definition.program);
      if (program?.kind === 'native') steps(program.steps, 'program/steps');
    }
  }
  return errors;
}
