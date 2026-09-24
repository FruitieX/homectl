import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeColorWords,
  describeSceneStateWords,
  resolveSceneEffects,
} from './sceneEffects.ts';

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
  assert.deepEqual(effects.targets[0].devices[0], {
    deviceKey: 'mqtt/living_room_lamp',
    deviceLabel: 'Living room lamp',
    changes: ['on', '80%', 'warm white'],
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

test('colour words never leak raw hue numbers', () => {
  assert.equal(describeColorWords({ h: 32, s: 0.3 }), 'warm white');
  assert.equal(describeColorWords({ h: 210, s: 0.05 }), 'cool white');
  assert.equal(describeColorWords({ h: 265, s: 0.9 }), 'blue');
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
