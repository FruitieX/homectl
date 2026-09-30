import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCreatedScene } from './routineSceneReturn.ts';

test('scene return updates a nested action and preserves opaque lookalikes', () => {
  const lookalike = {
    id: 'target',
    action: 'activate_scene',
    scene_id: 'opaque',
    select: { future: true },
  };
  const definition = {
    condition: { kind: 'literal', value: lookalike },
    future: lookalike,
    program: {
      kind: 'native',
      future: lookalike,
      steps: [
        { id: 'script', action: 'run_script', spec: { params: lookalike } },
        {
          id: 'branch',
          action: 'choose',
          branches: [
            {
              id: 'if',
              condition: lookalike,
              steps: [
                {
                  id: 'target',
                  action: 'activate_scene',
                  select: { kind: 'group_active', group_id: 'room' },
                  targets: { groups: ['room'] },
                  future: lookalike,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const before = structuredClone(definition);
  const result = applyCreatedScene(definition, 'target', 'new-scene');
  assert.equal(result.applied, true);
  const updated = result.definition.program.steps[1].branches![0]
    .steps[0] as Record<string, unknown>;
  assert.equal(updated.scene_id, 'new-scene');
  assert.equal(Object.hasOwn(updated, 'select'), false);
  assert.deepEqual(updated.targets, { groups: ['room'] });
  assert.equal(result.definition.future, lookalike);
  assert.equal(updated.future, lookalike);
  assert.equal(result.definition.program.steps[0], definition.program.steps[0]);
  assert.deepEqual(definition, before);
});

test('missing or changed actions and scripted programs do not report a selection', () => {
  for (const definition of [
    undefined,
    {
      program: {
        kind: 'script',
        spec: { id: 'target', action: 'activate_scene' },
      },
    },
    {
      program: {
        kind: 'native',
        steps: [
          null,
          { id: 'target', action: 'dim' },
          { action: 'choose', branches: [null, { steps: 'unknown' }] },
        ],
      },
    },
  ]) {
    const result = applyCreatedScene(definition, 'target', 'scene');
    assert.equal(result.applied, false);
    assert.equal(result.definition, definition);
  }
});
