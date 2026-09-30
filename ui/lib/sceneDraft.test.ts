import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  patchSceneTarget,
  resolveDraftTarget,
  validateSceneDraft,
  type SceneDraftContext,
} from './sceneDraft.ts';
import { orderedSceneTargets, resolveDeviceLink } from './sceneTargets.ts';

test('raw malformed targets survive unrelated validation and never create a known preview', () => {
  const targets = {
    'test/a': null,
    'test/b': { color: { future: 123 } },
    'test/c': false,
  };
  const rawScene = {
    id: 'raw',
    name: 'Raw',
    hidden: false,
    group_states: {},
    device_states: targets,
  };
  const before = JSON.stringify(rawScene);
  assert.deepEqual(
    validateSceneDraft(
      rawScene as unknown as Parameters<typeof validateSceneDraft>[0],
    ),
    [],
  );
  for (const value of Object.values(targets))
    assert.ok(
      resolveDraftTarget(
        value as unknown as Parameters<typeof resolveDraftTarget>[0],
        'test/a',
        { scenes: [], groups: [], devices: {} },
      ).reason,
    );
  assert.equal(JSON.stringify(rawScene), before);
});
const scene = {
  id: 'source',
  name: 'Source',
  hidden: false,
  device_states: {},
  group_states: {
    b: { brightness: 0.8 },
    a: { brightness: 0.2, color: { ct: 4000 } },
  },
};
const context: SceneDraftContext = {
  scenes: [scene],
  groups: ['a', 'b'].map((id) => ({
    id,
    name: id,
    hidden: false,
    devices: [{ integration_id: 'test', device_id: 'lamp' }],
    linked_groups: [],
  })),
  devices: {
    'test/source': {
      id: 'source',
      name: 'Source',
      integration_id: 'test',
      raw: null,
      data: {
        Sensor: {
          power: true,
          brightness: 0.6,
          color: { x: 0.3, y: 0.4 },
          transition: null,
        },
      },
    },
  },
};
test('draft target preview follows the same device through ordered scene group targets', () => {
  assert.equal(
    resolveDraftTarget({ scene_id: 'source' }, 'test/lamp', context).brightness,
    0.8,
  );
  const ordered = {
    ...context,
    scenes: [{ ...scene, group_state_order: ['b', 'a'] }],
  };
  assert.deepEqual(
    resolveDraftTarget({ scene_id: 'source' }, 'test/lamp', ordered).color,
    { ct: 4000 },
  );
  assert.equal(
    resolveDraftTarget(
      { scene_id: 'source', device_keys: ['other/device'] },
      'test/lamp',
      ordered,
    ).brightness,
    0.2,
  );
});
test('device link scales brightness and preserves source color representation', () => {
  const state = resolveDraftTarget(
    { integration_id: 'test', device_id: 'source', brightness: 0.5 },
    'test/lamp',
    context,
  );
  assert.equal(state.brightness, 0.3);
  assert.deepEqual(state.color, { x: 0.3, y: 0.4 });
});
test('omission, zero, off and unknown fields remain distinct during editing', () => {
  assert.equal(resolveDraftTarget({}, 'test/lamp', context).power, true);
  assert.equal(resolveDraftTarget({}, 'test/lamp', context).brightness, 1);
  const original = {
    power: true,
    brightness: 0.5,
    color: { r: 12, g: 34, b: 56 },
    future: ['preserved'],
  };
  assert.deepEqual(patchSceneTarget(original, { power: false }), {
    ...original,
    power: false,
  });
  assert.equal(
    'brightness' in patchSceneTarget(original, { brightness: undefined }),
    false,
  );
  assert.equal(
    resolveDraftTarget({ brightness: 0, transition: 0 }, 'test/lamp', context)
      .brightness,
    0,
  );
});
test('links neither invent aliases nor recurse forever', () => {
  assert.deepEqual(resolveDeviceLink('old/lamp', ['new/lamp']), {
    state: 'missing',
  });
  assert.deepEqual(
    resolveDeviceLink('old/lamp', ['old/lamp', 'new/lamp'], {
      'old/lamp': 'new/lamp',
    }),
    { state: 'known' },
  );
  const cyclic = {
    ...scene,
    device_states: { 'test/lamp': { scene_id: 'source' } },
  };
  assert.match(
    resolveDraftTarget({ scene_id: 'source' }, 'test/lamp', {
      ...context,
      scenes: [cyclic],
    }).reason ?? '',
    /loop/,
  );
});
test('group order is deduplicated and remaining IDs are alphabetical', () => {
  assert.deepEqual(
    orderedSceneTargets({ z: {}, b: {}, a: {} }, ['z', 'z', 'missing']).map(
      ([key]) => key,
    ),
    ['z', 'a', 'b'],
  );
});
test('invalid color and nonfinite brightness are rejected without changing a draft', () => {
  const invalid = {
    ...scene,
    device_states: {
      'test/lamp': { color: { r: 500, g: 0, b: 0 }, brightness: NaN },
    },
  };
  assert.equal(validateSceneDraft(invalid).length, 2);
});
