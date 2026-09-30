import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deviceLinkAliasNote,
  describeSceneTarget,
  orderedSceneTargets,
  sceneTargetMode,
  sceneTargetIssue,
  sceneTargetsSummary,
  sourceAliasKeys,
} from './sceneTargets.ts';

type Config = Record<string, unknown>;

test('malformed raw targets remain unresolved instead of inventing a state', () => {
  for (const raw of [
    null,
    false,
    3,
    'state',
    [],
    { power: 'on' },
    { brightness: '0.2' },
    { scene_id: [] },
    { scene_id: null },
    { integration_id: null },
    { scene_id: 'a', use_scene_transition: null },
    { scene_id: 'a', integration_id: 'b' },
    { group_keys: [null] },
    { color: false },
    { color: { h: 10 } },
    { color: { future: 123 } },
  ]) {
    assert.ok(sceneTargetIssue(raw));
    assert.equal(sceneTargetMode(raw), 'unsupported');
    const descriptor = describeSceneTarget(
      'a',
      { kind: 'device' },
      raw as Config,
    );
    assert.equal(descriptor.mode, 'unsupported');
    assert.ok(descriptor.unresolvedReason);
  }
  assert.equal(
    sceneTargetIssue({
      power: false,
      brightness: 0,
      transition: null,
      color: null,
      future: [false, null],
    }),
    null,
  );
  assert.equal(
    sceneTargetIssue({
      scene_id: 'a',
      device_keys: [],
      group_keys: null,
      future: true,
    }),
    null,
  );
  assert.equal(sceneTargetIssue({}), null);
});

const WAY_TOO_LONG = 'x';

test('sceneTargetMode classifies the three target shapes', () => {
  assert.equal(sceneTargetMode({ power: true }), 'state');
  assert.equal(
    sceneTargetMode({ integration_id: 'zigbee2mqtt', device_id: 'lamp' }),
    'device-link',
  );
  assert.equal(sceneTargetMode({ scene_id: 'evening' }), 'scene-link');
});

test('describeSceneTarget summarizes an explicit device state', () => {
  const target = describeSceneTarget(
    'living_room_lamp',
    { kind: 'device' },
    {
      power: true,
      brightness: 0.8,
    },
  );
  assert.equal(target.mode, 'state');
  assert.equal(target.summary, 'On · 80% brightness');
  assert.equal(target.unresolvedReason, null);
});

test('describeSceneTarget reports a precise reason when a linked scene is gone', () => {
  const target = describeSceneTarget(
    'kitchen',
    { kind: 'group' },
    { scene_id: 'evening' },
    {
      sceneIds: ['night'],
    },
  );
  assert.equal(target.mode, 'scene-link');
  assert.match(target.summary, /evening/);
  assert.equal(
    target.unresolvedReason,
    'Links to scene "evening", which no longer exists',
  );
});

test('describeSceneTarget reports a precise reason when a tracked device is gone', () => {
  const target = describeSceneTarget(
    'office',
    { kind: 'group' },
    {
      integration_id: 'zigbee2mqtt',
      device_id: 'office_desk',
    },
    { deviceKeys: ['zigbee2mqtt/living_room_lamp'] },
  );
  assert.equal(target.mode, 'device-link');
  assert.equal(target.summary, 'Tracks zigbee2mqtt/office_desk');
  assert.equal(
    target.unresolvedReason,
    'Tracks zigbee2mqtt/office_desk, which no longer exists',
  );
});

test('describeSceneTarget accepts omitted explicit state and flags unchosen links', () => {
  assert.equal(
    describeSceneTarget('a', { kind: 'device' }, { power: undefined })
      .unresolvedReason,
    null,
  );
  assert.equal(
    describeSceneTarget('b', { kind: 'device' }, { integration_id: 'x' })
      .unresolvedReason,
    'Tracks a device that is not chosen yet',
  );
  assert.equal(
    describeSceneTarget('c', { kind: 'group' }, { scene_id: '' })
      .unresolvedReason,
    'Links to a scene that is not chosen yet',
  );
});

test('orderedSceneTargets honors the saved order and keeps unknown keys out', () => {
  const items = { b: { power: false }, a: { power: true }, c: { power: true } };
  const ordered = orderedSceneTargets(items, ['c', 'missing', 'a']);
  assert.deepEqual(
    ordered.map(([key]) => key),
    ['c', 'a', 'b'],
  );
});

test('sceneTargetsSummary counts targets, unresolved references, and a script', () => {
  const summary = sceneTargetsSummary(
    {
      script: 'return {};',
      device_states: { lamp: { power: true }, gone: { scene_id: 'nope' } },
      group_states: { kitchen: { power: true } },
    },
    { sceneIds: ['night'], deviceKeys: ['zigbee2mqtt/lamp'] },
  );
  assert.deepEqual(summary, {
    deviceCount: 2,
    groupCount: 1,
    total: 3,
    unresolvedCount: 1,
    scripted: true,
  });
});

test('a device link survives an integration rename instead of reading as gone', () => {
  // The computed source keeps the legacy keys it replaced and publishes them as
  // `aliases`; a saved `circadian/color` reference is valid, not gone.
  const aliases = sourceAliasKeys([
    { id: 'circadian', aliases: ['circadian/color'] },
  ]);
  assert.deepEqual(aliases, { 'circadian/color': 'computed/circadian' });

  const descriptor = describeSceneTarget(
    'hue',
    { kind: 'device' },
    { integration_id: 'circadian', device_id: 'color', brightness: 0.5 },
    { deviceKeys: ['computed/circadian', 'zigbee2mqtt/hue'], aliases },
  );

  assert.equal(descriptor.unresolvedReason, null);
  assert.equal(descriptor.resolvedKey, 'computed/circadian');
  assert.equal(
    deviceLinkAliasNote('circadian/color', 'computed/circadian'),
    'Saved as circadian/color; the same device is published as computed/circadian.',
  );
});

test('a device link is only reported missing when the id is gone too', () => {
  const renamed = describeSceneTarget(
    'hue',
    { kind: 'device' },
    { integration_id: 'circadian', device_id: 'color' },
    {
      deviceKeys: ['computed/circadian'],
      aliases: sourceAliasKeys([
        { id: 'circadian', aliases: ['circadian/color'] },
      ]),
    },
  );
  assert.equal(renamed.unresolvedReason, null);

  const gone = describeSceneTarget(
    'hue',
    { kind: 'device' },
    { integration_id: 'circadian', device_id: 'rainbow' },
    { deviceKeys: ['computed/circadian'] },
  );
  assert.match(gone.unresolvedReason ?? '', /no longer exists/);

  // While the catalog is still loading there is no verdict to give.
  const loading = describeSceneTarget(
    'hue',
    { kind: 'device' },
    { integration_id: 'circadian', device_id: 'rainbow' },
    {},
  );
  assert.equal(loading.unresolvedReason, null);
});
