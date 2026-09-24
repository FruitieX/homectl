import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeColorWords,
  describeSceneStateWords,
  groupSceneEffectOutcomes,
  resolveSceneEffects,
} from './sceneEffects.ts';
import { describeColorName } from './deviceColor.ts';

const context = {
  devices: {
    'mqtt/living_room_lamp': { name: 'Living room lamp' },
    'mqtt/hallway_strip': { name: 'Hallway strip' },
    'mqtt/kitchen_light': { name: 'Kitchen light' },
  },
  groups: {
    living_room: {
      name: 'Living room',
      device_keys: ['mqtt/living_room_lamp'],
    },
    kitchen: { name: 'Kitchen', device_keys: ['mqtt/kitchen_light'] },
  },
};

test('a room target expands to the devices it changes', () => {
  const effects = resolveSceneEffects(
    {
      group_states: {
        living_room: { power: true, brightness: 0.8, color: { h: 32, s: 0.3 } },
      },
    },
    context,
  );
  assert.equal(effects.affectedDeviceCount, 1);
  // The colour travels as a value plus its words, so the row can draw a
  // swatch from what the scene sets instead of parsing text back out.
  assert.deepEqual(effects.targets[0].devices[0], {
    deviceKey: 'mqtt/living_room_lamp',
    deviceLabel: 'Living room lamp',
    changes: ['on', '80%'],
    color: { h: 32, s: 0.3 },
    colorWords: 'orange',
  });
});

test('a device target after a room target wins, and says so', () => {
  const effects = resolveSceneEffects(
    {
      group_states: { living_room: { power: true, brightness: 0.8 } },
      device_states: { 'mqtt/living_room_lamp': { power: false } },
    },
    context,
  );
  assert.deepEqual(effects.finalByDevice, [
    {
      deviceKey: 'mqtt/living_room_lamp',
      deviceLabel: 'Living room lamp',
      changes: ['off'],
      color: null,
      colorWords: null,
      fromLabel: 'Living room lamp',
    },
  ]);
  assert.equal(effects.overrideNotes.length, 1);
  assert.match(effects.overrideNotes[0], /Living room lamp/);
});

test('later room targets win over earlier ones in saved order', () => {
  const effects = resolveSceneEffects(
    {
      group_states: {
        kitchen: { power: false },
        living_room: { power: true },
      },
      // Living room is walked first although it appears second in the JSON.
      group_state_order: ['living_room', 'kitchen'],
    },
    {
      ...context,
      groups: {
        ...context.groups,
        // Kitchen also contains the living room lamp, so both targets write it.
        kitchen: {
          name: 'Kitchen',
          device_keys: ['mqtt/kitchen_light', 'mqtt/living_room_lamp'],
        },
      },
    },
  );
  const lamp = effects.finalByDevice.find(
    (entry) => entry.deviceKey === 'mqtt/living_room_lamp',
  );
  assert.deepEqual(lamp?.changes, ['off']);
  assert.equal(lamp?.fromLabel, 'Kitchen');
});

test('an unresolved room explains itself and offers a repair', () => {
  const effects = resolveSceneEffects(
    { group_states: { attic: { power: true } } },
    context,
  );
  assert.equal(effects.unresolvedCount, 1);
  assert.match(effects.targets[0].unresolvedReason ?? '', /no longer exists/);
  assert.match(effects.targets[0].repair ?? '', /Pick another room/);
  assert.equal(effects.affectedDeviceCount, 0);
});

test('an unavailable device target is named, not silently dropped', () => {
  const effects = resolveSceneEffects(
    { device_states: { 'mqtt/attic_lamp': { power: true } } },
    context,
  );
  assert.equal(effects.unresolvedCount, 1);
  assert.match(effects.targets[0].unresolvedReason ?? '', /not available/);
  assert.equal(
    effects.targets[0].repair,
    'Choose another device, or remove this target.',
  );
});

test('a scene target that sets nothing is flagged rather than described as a change', () => {
  const effects = resolveSceneEffects(
    { device_states: { 'mqtt/hallway_strip': {} } },
    context,
  );
  assert.equal(effects.unresolvedCount, 1);
  assert.match(effects.targets[0].unresolvedReason ?? '', /sets no state/);
});

test('missing references are counted by where they live', () => {
  const effects = resolveSceneEffects(
    {
      group_states: { living_room: { power: true } },
      device_states: { 'mqtt/attic_lamp': { power: true } },
    },
    {
      ...context,
      groups: {
        living_room: {
          name: 'Living room',
          device_keys: ['mqtt/living_room_lamp', 'mqtt/hallway_strip'],
        },
      },
      devices: { 'mqtt/living_room_lamp': { name: 'Living room lamp' } },
    },
  );
  assert.deepEqual(effects.unresolvedByKind, {
    directTargets: 1,
    roomTargets: 0,
    roomMembers: 1,
  });
  assert.equal(effects.unresolvedCount, 2);
  assert.deepEqual(effects.targets[0].missingMembers, ['mqtt/hallway_strip']);
  // Only the member that still exists is reported as a change.
  assert.deepEqual(
    effects.targets[0].devices.map((device) => device.deviceKey),
    ['mqtt/living_room_lamp'],
  );
});

test('a missing room counts as a room target, not a member', () => {
  const effects = resolveSceneEffects(
    { group_states: { attic: { power: true } } },
    context,
  );
  assert.deepEqual(effects.unresolvedByKind, {
    directTargets: 0,
    roomTargets: 1,
    roomMembers: 0,
  });
  assert.equal(effects.unresolvedCount, 1);
});

test('colour words never leak raw hue numbers', () => {
  assert.equal(describeColorWords({ h: 32, s: 0.3 }), 'orange');
  assert.equal(describeColorWords({ h: 210, s: 0.05 }), 'cool white');
  assert.equal(describeColorWords({ h: 265, s: 0.9 }), 'purple');
  assert.equal(describeColorWords(null), null);
  assert.equal(describeColorWords({}), null);
});

test('state words read as an effect list', () => {
  assert.deepEqual(
    describeSceneStateWords({ power: false, transition: 2 }).changes,
    ['off', '2 s fade'],
  );
  assert.equal(describeSceneStateWords({}).empty, true);
});

test('room outcomes group shared colors while keeping each brightness exact', () => {
  const effects = resolveSceneEffects(
    {
      group_states: {
        living_room: {
          power: true,
          brightness: 0.15,
          color: { h: 260, s: 0.8 },
        },
      },
    },
    {
      ...context,
      groups: {
        living_room: {
          name: 'Living room',
          device_keys: ['mqtt/living_room_lamp', 'mqtt/hallway_strip'],
        },
      },
    },
  );

  const [group] = groupSceneEffectOutcomes(effects.finalByDevice);
  assert.equal(group.fromLabel, 'Living room');
  assert.equal(group.entries.length, 2);
  assert.deepEqual(
    group.entries.map((entry) => entry.changes),
    [
      ['on', '15%'],
      ['on', '15%'],
    ],
  );
  assert.deepEqual(group.changes, ['on']);
  assert.equal(effects.affectedDeviceCount, 2);
});

test('all untagged color forms keep their values and receive a human name', () => {
  const colors = [
    { h: 260, s: 0.8 },
    { r: 255, g: 128, b: 0 },
    { x: 0.46, y: 0.41 },
    { ct: 270 },
  ];

  for (const color of colors) {
    const effects = resolveSceneEffects(
      { device_states: { 'mqtt/living_room_lamp': { color } } },
      context,
    );
    assert.deepEqual(effects.finalByDevice[0].color, color);
    assert.equal(effects.finalByDevice[0].colorWords, describeColorName(color));
    assert.equal(describeColorWords(color), describeColorName(color));
  }
});

test('off and no-color outcomes remain distinct; a script is not predicted', () => {
  const off = resolveSceneEffects(
    {
      device_states: {
        'mqtt/living_room_lamp': {
          power: false,
          color: { h: 260, s: 0.8 },
        },
      },
    },
    context,
  );
  assert.deepEqual(off.finalByDevice[0].changes, ['off']);
  assert.deepEqual(off.finalByDevice[0].color, { h: 260, s: 0.8 });

  const noColor = resolveSceneEffects(
    { device_states: { 'mqtt/living_room_lamp': { power: true } } },
    context,
  );
  assert.equal(noColor.finalByDevice[0].color, null);

  const scripted = resolveSceneEffects(
    {
      device_states: { 'mqtt/living_room_lamp': { power: true } },
      script: 'return { power: false };',
    },
    context,
  );
  assert.equal(scripted.scripted, true);
  assert.deepEqual(scripted.finalByDevice[0].changes, ['on']);
});

test('scene links resolve the matching saved output and honor target scopes', () => {
  const linkedScene = {
    device_states: {
      'mqtt/living_room_lamp': { power: true, brightness: 0.4 },
      'mqtt/kitchen_light': { power: false },
    },
  };
  const effects = resolveSceneEffects(
    {
      device_states: {
        'mqtt/living_room_lamp': {
          scene_id: 'linked',
          device_keys: ['mqtt/living_room_lamp'],
        },
      },
    },
    {
      ...context,
      resolveSceneLink: (sceneId) =>
        sceneId === 'linked' ? linkedScene : undefined,
    },
  );

  assert.equal(effects.affectedDeviceCount, 1);
  assert.deepEqual(effects.finalByDevice[0].changes, ['on', '40%']);
  assert.equal(effects.finalByDevice[0].fromLabel, 'Living room lamp');

  const excluded = resolveSceneEffects(
    {
      device_states: {
        'mqtt/living_room_lamp': {
          scene_id: 'linked',
          device_keys: ['mqtt/kitchen_light'],
        },
      },
    },
    {
      ...context,
      resolveSceneLink: () => linkedScene,
    },
  );
  assert.equal(excluded.affectedDeviceCount, 0);
});

test('mirrored scene links show fallback effects and mark current output unknown', () => {
  const effects = resolveSceneEffects(
    {
      device_states: {
        'mqtt/living_room_lamp': {
          scene_id: 'linked',
          mirror_from_group: 'living_room',
        },
      },
    },
    {
      ...context,
      resolveSceneLink: () => ({
        device_states: {
          'mqtt/living_room_lamp': { power: true },
        },
      }),
    },
  );
  assert.equal(effects.affectedDeviceCount, 1);
  assert.equal(effects.unknownOutcomeCount, 1);
  assert.deepEqual(effects.finalByDevice[0].changes, ['on']);
});
