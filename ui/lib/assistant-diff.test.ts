import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  acceptedByDefault,
  assistantFieldLabel,
  collectChangedDeviceKeys,
  collectChangedGroupIds,
  describeJsonValue,
  describeRoutineDefinition,
  diffTopLevelFields,
  formatJson,
  isDestructiveOperation,
  operationChangeSummary,
  operationDetails,
  operationFieldChanges,
  operationTarget,
  planOperationCounts,
  planTouchesFloorplanEntities,
  routineDefinitionLines,
  stableStringify,
  upsertAssistantAttachment,
} from './assistant-diff.ts';

import type { AssistantOperation } from '../bindings/AssistantOperation.ts';
import type { AssistantPlan } from '../bindings/AssistantPlan.ts';

const baseOperation: AssistantOperation = {
  opId: 'op-1',
  op: 'update',
  kind: 'scene',
  targetId: 'evening',
  label: 'Evening scene',
};

test('stableStringify sorts object keys deterministically', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(stableStringify({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(
    stableStringify([1, { b: true, a: null }]),
    '[1,{"a":null,"b":true}]',
  );
});

test('diffTopLevelFields reports added, removed, and changed fields', () => {
  const fields = diffTopLevelFields(
    { name: 'Old', hidden: false, script: 'x' },
    { name: 'New', hidden: false, extra: 1 },
  );
  assert.deepEqual(
    fields.map((field) => [field.key, field.kind]),
    [
      ['name', 'changed'],
      ['script', 'removed'],
      ['extra', 'added'],
    ],
  );
});

test('diffTopLevelFields is order-insensitive for nested objects', () => {
  const fields = diffTopLevelFields(
    { config: { a: 1, b: 2 } },
    { config: { b: 2, a: 1 } },
  );
  assert.equal(fields.length, 0);
});

test('assistantFieldLabel uses per-kind labels and humanizes the rest', () => {
  assert.equal(assistantFieldLabel('scene', 'device_states'), 'Device targets');
  assert.equal(
    assistantFieldLabel('scene', 'refresh_interval_ms'),
    'Refresh interval ms',
  );
  assert.equal(assistantFieldLabel('routine', 'definition_v2'), 'Definition');
});

test('describeJsonValue summarizes values', () => {
  assert.equal(describeJsonValue(null), 'null');
  assert.equal(describeJsonValue(undefined), '—');
  assert.equal(describeJsonValue(true), 'true');
  assert.equal(describeJsonValue([1, 2, 3]), '3 items');
  assert.equal(describeJsonValue({ a: 1 }), '1 field');
  assert.equal(describeJsonValue('hello'), '"hello"');
  assert.match(describeJsonValue('x'.repeat(100)), /…"$/);
});

test('formatJson pretty prints values', () => {
  assert.equal(formatJson({ a: 1 }), '{\n  "a": 1\n}');
});

test('operationTarget resolves create and existing entities', () => {
  assert.deepEqual(operationTarget(baseOperation), {
    kind: 'scene',
    id: 'evening',
    label: 'Evening scene',
  });
  assert.deepEqual(
    operationTarget({
      opId: 'op-2',
      op: 'create',
      kind: 'group',
      label: 'Kitchen',
      after: { id: 'kitchen', name: 'Kitchen' },
    }),
    { kind: 'group', id: 'kitchen', label: 'Kitchen' },
  );
  assert.equal(
    operationTarget({ opId: 'op-3', op: 'create', kind: 'group', label: 'x' }),
    null,
  );
});

test('operationChangeSummary describes creates, deletes, and updates', () => {
  assert.equal(
    operationChangeSummary({
      opId: 'op-1',
      op: 'create',
      kind: 'routine',
      label: 'x',
    }),
    'Create routine',
  );
  assert.equal(
    operationChangeSummary({
      opId: 'op-2',
      op: 'delete',
      kind: 'group',
      label: 'x',
    }),
    'Delete group',
  );
  assert.equal(
    operationChangeSummary({
      ...baseOperation,
      before: { name: 'Old', hidden: false },
      after: { name: 'New', hidden: false },
    }),
    'Change Name',
  );
  assert.equal(
    operationChangeSummary({ ...baseOperation, before: {}, after: {} }),
    'No visible field changes',
  );
});

test('operationFieldChanges ignores server bookkeeping fields', () => {
  const routineFields = operationFieldChanges({
    opId: 'op-1',
    op: 'update',
    kind: 'routine',
    targetId: 'hallway',
    label: 'Hallway',
    before: { name: 'Hallway', enabled: false, revision: 7 },
    after: { name: 'Hallway', enabled: true, revision: 1 },
  });
  assert.deepEqual(
    routineFields.map((field) => field.key),
    ['enabled'],
  );
  const deviceFields = operationFieldChanges({
    opId: 'op-2',
    op: 'update',
    kind: 'device',
    targetId: 'mqtt/lamp',
    label: 'Lamp',
    before: { device_key: 'mqtt/lamp', name: 'lamp', kind: 'controllable' },
    after: { device_key: 'mqtt/lamp', display_name: 'Desk lamp' },
  });
  assert.deepEqual(
    deviceFields.map((field) => field.key),
    ['display_name'],
  );
});

test('operationDetails summarizes scene target changes', () => {
  const details = operationDetails({
    ...baseOperation,
    before: {
      device_states: { 'mqtt/a': {}, 'mqtt/b': {} },
      group_states: { kitchen: {} },
    },
    after: {
      device_states: { 'mqtt/a': {}, 'mqtt/c': {} },
      group_states: { kitchen: {}, hall: {} },
    },
  });
  assert.deepEqual(details, ['Devices: +mqtt/c · −mqtt/b', 'Groups: +hall']);
});

test('operationDetails summarizes group membership changes', () => {
  const details = operationDetails({
    opId: 'op-1',
    op: 'update',
    kind: 'group',
    targetId: 'kitchen',
    label: 'Kitchen',
    before: {
      devices: [
        { integration_id: 'mqtt', device_id: 'a' },
        { integration_id: 'mqtt', device_id: 'b' },
      ],
      linked_groups: ['upstairs'],
    },
    after: {
      devices: [{ integration_id: 'mqtt', device_id: 'a' }],
      linked_groups: ['upstairs', 'downstairs'],
    },
  });
  assert.deepEqual(details, ['Devices: −mqtt/b', 'Linked groups: +downstairs']);
});

test('operationDetails summarizes routine section changes', () => {
  const details = operationDetails({
    opId: 'op-1',
    op: 'update',
    kind: 'routine',
    targetId: 'hallway',
    label: 'Hallway',
    before: {
      definition_v2: {
        triggers: [{ id: 't1', kind: 'report' }],
        condition: { kind: 'literal', value: true },
        program: { kind: 'native', steps: [] },
      },
    },
    after: {
      definition_v2: {
        triggers: [
          { id: 't1', kind: 'report' },
          { id: 't2', kind: 'schedule' },
        ],
        condition: { kind: 'literal', value: false },
        program: { kind: 'native', steps: [{ action: 'set_power' }] },
      },
    },
  });
  assert.deepEqual(details, [
    'Triggers: +t2',
    'Condition changed',
    'Program: native (0 steps) → native (1 step)',
  ]);
});

test('operationDetails summarizes integration config changes', () => {
  const details = operationDetails({
    opId: 'op-1',
    op: 'update',
    kind: 'integration',
    targetId: 'mqtt-main',
    label: 'MQTT',
    before: { config: { host: 'old', port: 1883 } },
    after: { config: { host: 'new', port: 1883 } },
  });
  assert.deepEqual(details, ['Config fields: Host']);
});

test('destructive and default acceptance rules', () => {
  assert.equal(
    isDestructiveOperation({ ...baseOperation, op: 'delete' }),
    true,
  );
  assert.equal(acceptedByDefault({ ...baseOperation, op: 'delete' }), false);
  assert.equal(acceptedByDefault({ ...baseOperation, op: 'update' }), true);
  assert.equal(acceptedByDefault({ ...baseOperation, op: 'create' }), true);
});

test('collectChangedDeviceKeys unions scene, group, and device operations', () => {
  const keys = collectChangedDeviceKeys([
    {
      ...baseOperation,
      before: { device_states: { 'mqtt/a': {} } },
      after: { device_states: { 'mqtt/a': {}, 'mqtt/b': {} } },
    },
    {
      opId: 'op-2',
      op: 'update',
      kind: 'group',
      targetId: 'kitchen',
      label: 'Kitchen',
      after: {
        devices: [{ integration_id: 'mqtt', device_id: 'c' }],
      },
    },
    {
      opId: 'op-3',
      op: 'update',
      kind: 'device',
      targetId: 'mqtt/d',
      label: 'Lamp',
      after: { device_key: 'mqtt/d', display_name: 'Lamp' },
    },
  ]);
  assert.deepEqual(keys, ['mqtt/a', 'mqtt/b', 'mqtt/c', 'mqtt/d']);
});

test('collectChangedGroupIds unions group and scene operations', () => {
  const ids = collectChangedGroupIds([
    {
      opId: 'op-1',
      op: 'update',
      kind: 'group',
      targetId: 'kitchen',
      label: 'Kitchen',
    },
    {
      opId: 'op-2',
      op: 'update',
      kind: 'scene',
      targetId: 'evening',
      label: 'Evening',
      before: { group_states: { hall: {} } },
      after: { group_states: { hall: {}, office: {} } },
    },
  ]);
  assert.deepEqual(ids, ['hall', 'kitchen', 'office']);
});

test('planOperationCounts counts each operation kind', () => {
  const plan = {
    planId: 'plan-1',
    summary: 'Test',
    createdAtMs: 0n,
    operations: [
      { opId: 'op-1', op: 'create', kind: 'group', label: 'a' },
      { opId: 'op-2', op: 'update', kind: 'scene', label: 'b' },
      { opId: 'op-3', op: 'delete', kind: 'scene', label: 'c' },
      { opId: 'op-4', op: 'delete', kind: 'routine', label: 'd' },
    ],
  } as AssistantPlan;
  assert.deepEqual(planOperationCounts(plan), {
    create: 1,
    update: 1,
    delete: 2,
  });
  assert.equal(planTouchesFloorplanEntities(plan), true);
  assert.equal(
    planTouchesFloorplanEntities({
      ...plan,
      operations: [{ opId: 'op-1', op: 'create', kind: 'helper', label: 'a' }],
    }),
    false,
  );
});

test('describeRoutineDefinition summarizes triggers and program', () => {
  const lines = describeRoutineDefinition({
    triggers: [
      { id: 't1', kind: 'report' },
      { id: 't2', kind: 'report' },
      { id: 't3', kind: 'schedule' },
    ],
    condition: { kind: 'literal', value: true },
    program: { kind: 'script', spec: {} },
  });
  assert.deepEqual(lines, [
    'Triggers: 3 (Report ×2, Schedule ×1)',
    'Condition: 2 fields',
    'Program: script',
  ]);
  assert.deepEqual(describeRoutineDefinition(null), ['No routine definition']);
  assert.deepEqual(
    routineDefinitionLines({ definition_v2: { triggers: [] } }),
    ['Triggers: none', 'Condition: always', 'Program: none'],
  );
});

test('upsertAssistantAttachment replaces matching kind/id pairs', () => {
  const routine = { kind: 'routine' as const, id: 'a', label: 'A' };
  const scene = { kind: 'scene' as const, id: 'b', label: 'B' };
  assert.deepEqual(upsertAssistantAttachment([routine], scene), [
    routine,
    scene,
  ]);
  assert.deepEqual(
    upsertAssistantAttachment([routine, scene], { ...routine, label: 'A2' }),
    [{ ...routine, label: 'A2' }, scene],
  );
});
