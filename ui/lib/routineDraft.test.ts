import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  moveSibling,
  duplicateRoutineNode,
  stringifyConfig,
  validateRoutineDraft,
  isEditableSceneSelection,
} from './routineDraft.ts';
test('future and malformed dynamic selections remain outside the editable renderer', () => {
  for (const selection of [
    null,
    [],
    { kind: 'future_selection', group_id: 'room' },
    { kind: 'helper_enum', helper: 'mode', mapping: null },
    { kind: 'helper_enum', helper: 'mode', mapping: { on: 2 } },
    { kind: 'group_active', group_id: ['room'] },
  ]) {
    assert.equal(isEditableSceneSelection(selection), false);
  }
  assert.equal(
    isEditableSceneSelection({
      kind: 'helper_enum',
      helper: '',
      mapping: {},
      fallback_scene_id: null,
      future: 42,
    }),
    true,
  );
  assert.equal(
    isEditableSceneSelection({
      kind: 'group_active',
      group_id: 'room',
      fallback_scene_id: 'scene',
    }),
    true,
  );
  assert.equal(
    isEditableSceneSelection(
      JSON.parse(
        '{"kind":"helper_enum","helper":"mode","mapping":{"__proto__":"night"}}',
      ),
    ),
    true,
  );
});
const steps = [
  {
    id: 'one',
    action: 'choose',
    future: 42,
    branches: [
      {
        id: 'branch',
        condition: { kind: 'literal', value: true },
        steps: [{ id: 'nested', action: 'cancel_timer', timer: 'still-same' }],
      },
    ],
  },
  { id: 'two', action: 'cancel_timer', timer: 'other' },
];
test('reordering preserves node and branch identities, scopes and unknown values', () => {
  const moved = moveSibling(steps, 0, 1);
  assert.equal(moved[1], steps[0]);
  assert.deepEqual(moved[1].branches, steps[0].branches);
  assert.equal(moved[1].future, 42);
  assert.deepEqual(moveSibling(steps, 0, -1), steps);
});
test('duplicating a branch allocates new identities throughout without renaming timer references', () => {
  const copy = duplicateRoutineNode(steps[0]);
  assert.notEqual(copy.id, steps[0].id);
  assert.notEqual(copy.branches![0].id, 'branch');
  assert.notEqual(copy.branches![0].steps[0].id, 'nested');
  assert.equal(copy.branches![0].steps[0].timer, 'still-same');
  assert.equal(copy.future, 42);
});
test('JSON transport converts safe bigint durations and refuses precision loss and nonfinite values', () => {
  assert.equal(stringifyConfig({ duration_ms: 1500n }), '{"duration_ms":1500}');
  assert.throws(
    () => stringifyConfig({ duration_ms: 9007199254740993n }),
    /precision/,
  );
  assert.throws(
    () => stringifyConfig({ duration_ms: Number.MAX_SAFE_INTEGER + 1 }),
    /safe integer/,
  );
  assert.throws(() => stringifyConfig({ brightness: NaN }), /finite/);
});
test('empty logic groups and duplicate nested IDs have visible validation errors', () => {
  const row = {
    id: 'test',
    name: 'Test',
    enabled: true,
    semantics_version: 2,
    rules: [],
    actions: [],
    definition_v2: {
      condition: { kind: 'all', conditions: [] },
      program: { kind: 'native', steps: [...steps, steps[0]] },
    },
  };
  const errors = validateRoutineDraft(row);
  assert.ok(errors.some((error) => error.message.includes('empty')));
  assert.ok(errors.some((error) => error.message.includes('unique')));
});
test('empty scene cycles validate inside branches without reading opaque payloads', () => {
  const cycle = {
    id: 'cycle',
    action: 'cycle_scenes',
    scenes: [] as unknown[],
  };
  const row = {
    id: 'r',
    name: 'R',
    enabled: false,
    semantics_version: 2,
    rules: [],
    actions: [],
    definition_v2: {
      program: {
        kind: 'native',
        steps: [
          {
            id: 'branch',
            action: 'choose',
            branches: [
              {
                id: 'if',
                condition: { kind: 'literal', value: true },
                steps: [cycle],
              },
            ],
          },
          { id: 'script', action: 'run_script', spec: { future: cycle } },
        ],
      },
    },
  };
  assert.deepEqual(validateRoutineDraft(row), [
    {
      field: 'step/cycle/cycle_scenes/scenes',
      message: 'Add at least one scene to this cycle, or remove the action.',
    },
  ]);
  cycle.scenes.push({ scene_id: 'evening' });
  assert.deepEqual(validateRoutineDraft(row), []);
});
test('arbitrary JSON payload identities and unknown fields survive duplication and validation', () => {
  const payload = {
    id: 'customer-reference',
    nested: { id: 'customer-reference', kind: 'all', conditions: [] },
  };
  const definition = {
    triggers: [{ id: 'start', kind: 'manual' as const, future: payload }],
    condition: {
      kind: 'comparison',
      source: { kind: 'helper', helper_id: 'input' },
      operator: 'eq',
      value: payload,
    },
    program: {
      kind: 'native',
      steps: [{ id: 'action', action: 'integration_action', payload }],
    },
    future: payload,
  };
  const copy = duplicateRoutineNode(definition);
  assert.notEqual(copy.triggers[0].id, 'start');
  assert.notEqual(copy.program.steps[0].id, 'action');
  assert.deepEqual(copy.future, payload);
  assert.deepEqual(copy.triggers[0].future, payload);
  assert.deepEqual(copy.program.steps[0].payload, payload);
  assert.deepEqual(copy.condition.value, payload);
  assert.deepEqual(
    validateRoutineDraft({
      id: 'r',
      name: 'R',
      enabled: false,
      semantics_version: 2,
      rules: [],
      actions: [],
      definition_v2: definition,
    }),
    [],
  );
});
