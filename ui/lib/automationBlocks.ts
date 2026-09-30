import type { AutomationBlock } from '../bindings/AutomationBlock';
import type { BlockInput } from '../bindings/BlockInput';
import type { JsonValue } from '../bindings/serde_json/JsonValue';

export const inputToken = (name: string) => `__block_input__${name}`;
export function inputReference(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 1 && typeof row.$input === 'string'
    ? row.$input
    : undefined;
}
export function inputExample(name: string, input: BlockInput): JsonValue {
  switch (input.kind.kind) {
    case 'group':
    case 'scene':
    case 'helper':
    case 'string':
      return inputToken(name);
    case 'device':
      return { integration_id: '__block_input__', device_id: name };
    case 'targets':
      return { groups: [inputToken(name)] };
    case 'rollout':
      return (
        input.default ?? {
          style: 'spatial',
          duration_ms: 1500,
          source: { kind: 'triggering_device' },
        }
      );
    case 'boolean':
      return input.default ?? true;
    case 'number':
      return input.default ?? 0.1;
    case 'duration':
      return input.default ?? 1000;
    case 'enum':
      return input.default ?? input.kind.options[0] ?? '';
  }
}
export function materializeBlock(
  body: JsonValue,
  inputs: AutomationBlock['inputs'],
  actual?: Record<string, JsonValue>,
): JsonValue {
  const reference = inputReference(body);
  if (reference)
    return actual
      ? Object.hasOwn(actual, reference)
        ? actual[reference]!
        : (inputs[reference]?.default ?? null)
      : inputs[reference]
        ? inputExample(reference, inputs[reference])
        : inputToken(reference);
  if (Array.isArray(body))
    return body.map((item) => materializeBlock(item, inputs, actual));
  if (body && typeof body === 'object')
    return Object.fromEntries(
      Object.entries(body).map(([key, item]) => [
        key,
        materializeBlock(item, inputs, actual),
      ]),
    );
  return body;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function withoutNodeIds(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withoutNodeIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, item]) => [key, withoutNodeIds(item)]),
    );
  return value;
}
function bindSelectedInputs(
  value: JsonValue,
  inputs: AutomationBlock['inputs'],
): JsonValue {
  for (const [name, input] of Object.entries(inputs)) {
    if (
      ['group', 'scene', 'helper', 'string', 'device', 'targets'].includes(
        input.kind.kind,
      ) &&
      same(value, inputExample(name, input))
    )
      return { $input: name };
  }
  if (Array.isArray(value))
    return value.map((item) => bindSelectedInputs(item, inputs));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['id', 'block_id'].includes(key)
          ? item
          : bindSelectedInputs(item, inputs),
      ]),
    );
  return value;
}
/** Match moved actions by ID and moved predicates by their materialized value. */
export function retainInputBindings(
  template: JsonValue,
  edited: JsonValue,
  inputs: AutomationBlock['inputs'],
): JsonValue {
  const before = materializeBlock(template, inputs);
  if (inputReference(template)) return same(before, edited) ? template : edited;
  if (Array.isArray(template) && Array.isArray(edited)) {
    return edited.map((item, index) => {
      const id =
        item && typeof item === 'object' && !Array.isArray(item)
          ? item.id
          : undefined;
      let match = template.findIndex((old) =>
        id !== undefined &&
        old &&
        typeof old === 'object' &&
        !Array.isArray(old)
          ? old.id === id
          : same(materializeBlock(old, inputs), item),
      );
      if (match < 0 && id !== undefined)
        match = template.findIndex((old) =>
          same(
            withoutNodeIds(materializeBlock(old, inputs)),
            withoutNodeIds(item),
          ),
        );
      const original =
        template[match < 0 ? (id === undefined ? index : -1) : match];
      return original === undefined
        ? bindSelectedInputs(item, inputs)
        : retainInputBindings(original, item, inputs);
    });
  }
  if (
    template &&
    edited &&
    typeof template === 'object' &&
    typeof edited === 'object' &&
    !Array.isArray(template) &&
    !Array.isArray(edited)
  ) {
    if (template.kind !== edited.kind || template.action !== edited.action)
      return bindSelectedInputs(edited, inputs);
    return Object.fromEntries(
      Object.entries(edited).map(([key, item]) => [
        key,
        Object.hasOwn(template, key)
          ? retainInputBindings(template[key]!, item, inputs)
          : bindSelectedInputs(item, inputs),
      ]),
    );
  }
  return bindSelectedInputs(edited, inputs);
}
export function replaceInputName(
  value: JsonValue,
  before: string,
  after: string,
): JsonValue {
  if (inputReference(value) === before) return { $input: after };
  if (Array.isArray(value))
    return value.map((v) => replaceInputName(v, before, after));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        replaceInputName(v, before, after),
      ]),
    );
  return value;
}
export function setBodyPath(
  body: JsonValue,
  path: (string | number)[],
  value: JsonValue,
): JsonValue {
  if (!path.length) return value;
  const [key, ...rest] = path;
  if (Array.isArray(body))
    return body.map((v, i) => (i === key ? setBodyPath(v, rest, value) : v));
  if (body && typeof body === 'object')
    return {
      ...body,
      [key!]: setBodyPath(body[String(key)] ?? null, rest, value),
    };
  return body;
}
export type InputBindingField = {
  path: (string | number)[];
  label: string;
  kinds: string[];
  value: JsonValue;
};
/** Only authoring fields are bindable; IDs, script source and metadata remain literal. */
function fieldLabel(path: (string | number)[]): string {
  const labels: Record<string, string> = {
    group_id: 'Group',
    scene_id: 'Scene',
    scene: 'Scene',
    helper: 'Helper',
    device: 'Device',
    targets: 'Targets',
    detection: 'Scene detection',
    power: 'Power',
    value: 'Value',
    step: 'Dim amount',
    duration_ms: 'Spread duration',
    transition_ms: 'Transition',
    min_saturation: 'Minimum saturation',
    max_saturation: 'Maximum saturation',
    branches: 'Branch',
    steps: 'Action',
    condition: 'Condition',
    conditions: 'Check',
    groups: 'Group',
    scenes: 'Scene',
    rollout: 'Spread',
    source: 'Origin',
  };
  return path
    .map((key) =>
      typeof key === 'number' ? String(key + 1) : (labels[key] ?? key),
    )
    .join(' / ');
}
export function bindingFields(
  body: JsonValue,
  blocks: AutomationBlock[] = [],
): InputBindingField[] {
  const result: InputBindingField[] = [];
  const kinds: Record<string, string[]> = {
    rollout: ['rollout'],
    group_id: ['group'],
    scene_id: ['scene'],
    scene: ['scene'],
    helper: ['helper'],
    device: ['device'],
    targets: ['targets'],
    detection: ['targets'],
    power: ['boolean'],
    value: ['boolean', 'number', 'string', 'enum'],
    step: ['number'],
    duration_ms: ['duration'],
    transition_ms: ['duration'],
    min_saturation: ['number'],
    max_saturation: ['number'],
  };
  function visit(value: JsonValue, path: (string | number)[], field?: string) {
    if (field && kinds[field])
      result.push({
        path,
        label: fieldLabel(path),
        kinds: kinds[field]!,
        value,
      });
    if (inputReference(value)) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (field === 'groups')
          result.push({
            path: [...path, i],
            label: fieldLabel([...path, i]),
            kinds: ['group'],
            value: v,
          });
        else visit(v, [...path, i]);
      });
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (key === 'inputs') {
          const called = blocks.find((b) => b.id === value.block_id);
          if (item && typeof item === 'object' && !Array.isArray(item))
            for (const [name, arg] of Object.entries(item)) {
              const input = called?.inputs[name];
              if (input)
                result.push({
                  path: [...path, key, name],
                  label: fieldLabel(path) + ' / Input: ' + input.label,
                  kinds: [input.kind.kind],
                  value: arg,
                });
            }
          continue;
        }
        visit(item, [...path, key], key);
      }
  }
  visit(body, []);
  return result;
}
export function blockUsers(
  id: string,
  blocks: AutomationBlock[],
  routines: Array<{ id: string; name: string; definition_v2?: unknown }>,
) {
  const affected = new Set([id]);
  let size = 0;
  while (size !== affected.size) {
    size = affected.size;
    for (const block of blocks)
      if (
        [...affected].some(
          (child) => block.id !== child && blockCalls(block.body, child),
        )
      )
        affected.add(block.id);
  }
  return {
    blocks: blocks.filter((block) => block.id !== id && affected.has(block.id)),
    routines: routines.filter((routine) =>
      [...affected].some((child) => blockCalls(routine.definition_v2, child)),
    ),
  };
}
export function blockCalls(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((v) => blockCalls(v, id));
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (row.kind === 'block' || row.action === 'call_block')
    return row.block_id === id;
  if (row.kind === 'all' || row.kind === 'any')
    return blockCalls(row.conditions, id);
  if (row.kind === 'not') return blockCalls(row.condition, id);
  if (row.action === 'choose')
    return (
      Array.isArray(row.branches) &&
      row.branches.some(
        (b) =>
          b &&
          typeof b === 'object' &&
          (blockCalls(b.condition, id) || blockCalls(b.steps, id)),
      )
    );
  if (row.kind || row.action) return false;
  const program = row.program as Record<string, unknown> | undefined;
  return (
    blockCalls(row.condition, id) ||
    (program?.kind === 'native' && blockCalls(program.steps, id)) ||
    (Array.isArray(row.triggers) &&
      row.triggers.some(
        (t) =>
          t &&
          typeof t === 'object' &&
          ['predicate_transition', 'predicate_for'].includes(t.kind) &&
          blockCalls(t.predicate, id),
      ))
  );
}
