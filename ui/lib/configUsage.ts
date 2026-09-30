import type { AutomationBlock } from '../bindings/AutomationBlock';
import type { JsonValue } from '../bindings/serde_json/JsonValue';
import { materializeBlock } from './automationBlocks.ts';
// Inspect declared fields only. JSON operands, script bodies and extension data
// can resemble references without declaring a dependency.
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const deviceKey = (value: unknown) => {
  const ref = object(value);
  return typeof ref.integration_id === 'string' &&
    typeof ref.device_id === 'string'
    ? `${ref.integration_id}/${ref.device_id}`
    : undefined;
};
export function sceneUsesDeviceKeys(value: unknown, keys: ReadonlySet<string>) {
  const scene = object(value);
  return [scene.device_states, scene.group_states].some((states) =>
    Object.values(object(states)).some((target) => {
      const key = deviceKey(target);
      return key !== undefined && keys.has(key);
    }),
  );
}
export function groupUsesDeviceKeys(value: unknown, keys: ReadonlySet<string>) {
  const group = object(value);
  return (
    list(group.devices).some((device) => {
      const key = deviceKey(device);
      return key !== undefined && keys.has(key);
    }) ||
    list(group.device_keys).some(
      (key) => typeof key === 'string' && keys.has(key),
    )
  );
}
export function routineReferences(
  value: unknown,
  blocks: AutomationBlock[] = [],
) {
  const helpers = new Set<string>(),
    sources = new Set<string>(),
    devices = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    if (typeof value === 'string') set.add(value);
  };
  const device = (value: unknown) => add(devices, deviceKey(value));
  const targets = (value: unknown) =>
    list(object(value).devices).forEach(device);
  const active = new Set<string>();
  const call = (
    row: Record<string, unknown>,
    kind: AutomationBlock['kind'],
    visit: (body: unknown) => void,
  ) => {
    const block = blocks.find((b) => b.id === row.block_id && b.kind === kind);
    if (!block || active.has(block.id) || active.size >= 8) return;
    active.add(block.id);
    try {
      visit(
        materializeBlock(
          block.body,
          block.inputs,
          object(row.inputs) as Record<string, JsonValue>,
        ),
      );
    } finally {
      active.delete(block.id);
    }
  };
  const condition = (value: unknown) => {
    const row = object(value);
    if (row.kind === 'block') call(row, 'condition', condition);
    else if (row.kind === 'all' || row.kind === 'any')
      list(row.conditions).forEach(condition);
    else if (row.kind === 'not') condition(row.condition);
    else if (row.kind === 'comparison') {
      const source = object(row.source);
      if (source.kind === 'helper') add(helpers, source.helper);
      else if (source.kind === 'computed_source') add(sources, source.source);
      else if (source.kind === 'device') device(source.device);
    }
  };
  const script = (value: unknown) => {
    for (const entry of list(object(value).declarations)) {
      const declaration = object(entry);
      if (declaration.kind === 'device') device(declaration.device);
    }
  };
  const action = (value: unknown) => {
    const row = object(value);
    switch (row.action) {
      case 'call_block':
        call(row, 'action', (body) => list(body).forEach(action));
        break;
      case 'activate_scene':
        if (object(row.select).kind === 'helper_enum')
          add(helpers, object(row.select).helper);
        targets(row.targets);
        break;
      case 'set_helper':
        add(helpers, row.helper);
        break;
      case 'set_power':
        device(row.device);
        break;
      case 'dim':
      case 'randomize_color':
        targets(row.targets);
        break;
      case 'schedule_timer':
      case 'replace_timer':
        targets(row.capture_target_intents);
        break;
      case 'cycle_scenes':
        targets(row.detection);
        list(row.scenes).forEach((scene) => targets(object(scene).targets));
        break;
      case 'run_script':
        script(row.spec);
        break;
      case 'choose':
        list(row.branches).forEach((value) => {
          const branch = object(value);
          condition(branch.condition);
          list(branch.steps).forEach(action);
        });
        break;
    }
    if (['activate_scene', 'cycle_scenes'].includes(String(row.action))) {
      const source = object(object(row.rollout).source);
      if (source.kind === 'device') device(source.device);
    }
  };
  const definition = object(value);
  list(definition.triggers).forEach((value) => {
    const trigger = object(value);
    if (trigger.kind === 'report' || trigger.kind === 'state_change')
      device(trigger.device);
    else if (
      trigger.kind === 'predicate_transition' ||
      trigger.kind === 'predicate_for'
    )
      condition(trigger.predicate);
  });
  condition(definition.condition);
  const program = object(definition.program);
  if (program.kind === 'native') list(program.steps).forEach(action);
  else if (program.kind === 'script') script(program.spec);
  return { helpers, sources, devices };
}
