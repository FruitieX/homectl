import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getGroupFocusBounds,
  resolveGroupDeviceKeys,
  selectGroupFloorplan,
  type FloorplanPreviewSource,
} from './group-floorplan-preview.ts';

const floorplan = (
  id: string,
  deviceKeys: string[],
  groups: Record<string, unknown[]> = {},
): FloorplanPreviewSource => ({
  id,
  name: id,
  grid: {
    devices: deviceKeys.map((deviceKey) => ({ deviceKey })),
    groups,
  },
});

test('resolveGroupDeviceKeys flattens nested groups and deduplicates', () => {
  const groups = {
    room: {
      device_keys: ['mqtt/lamp'],
      linked_groups: ['wing'],
    },
    wing: {
      device_keys: ['mqtt/lamp', 'mqtt/sensor'],
      linked_groups: ['room'],
    },
  };

  assert.deepEqual(resolveGroupDeviceKeys('room', groups), [
    'mqtt/lamp',
    'mqtt/sensor',
  ]);
});

test('resolveGroupDeviceKeys falls back to raw device refs', () => {
  const groups = {
    room: {
      devices: [{ integration_id: 'mqtt', device_id: 'lamp' }],
      linked_groups: ['wing'],
    },
    wing: {
      devices: [{ integration_id: 'dummy', device_id: 'sensor' }],
    },
  };

  assert.deepEqual(resolveGroupDeviceKeys('room', groups), [
    'dummy/sensor',
    'mqtt/lamp',
  ]);
});

test('selectGroupFloorplan prefers an explicit placement mask', () => {
  const withMask = floorplan('b', ['mqtt/lamp'], { room: [[0, 0]] });
  const withDevices = floorplan('a', ['mqtt/lamp', 'mqtt/sensor']);

  const selection = selectGroupFloorplan(
    'room',
    ['mqtt/lamp', 'mqtt/sensor'],
    [withDevices, withMask],
  );

  assert.equal(selection?.floorplan.id, 'b');
  assert.equal(selection?.reason, 'placement');
  assert.deepEqual(selection?.placedDeviceKeys, ['mqtt/lamp']);
});

test('selectGroupFloorplan picks the floorplan with the most devices', () => {
  const selection = selectGroupFloorplan(
    'room',
    ['mqtt/lamp', 'mqtt/sensor'],
    [
      floorplan('a', ['mqtt/lamp']),
      floorplan('b', ['mqtt/lamp', 'mqtt/sensor']),
    ],
  );

  assert.equal(selection?.floorplan.id, 'b');
  assert.equal(selection?.reason, 'devices');
  assert.deepEqual(selection?.placedDeviceKeys, ['mqtt/lamp', 'mqtt/sensor']);
});

test('selectGroupFloorplan tie-breaks deterministically by id', () => {
  const selection = selectGroupFloorplan(
    'room',
    ['mqtt/lamp'],
    [floorplan('z', ['mqtt/lamp']), floorplan('a', ['mqtt/lamp'])],
  );

  assert.equal(selection?.floorplan.id, 'a');
});

test('selectGroupFloorplan returns null when nothing is placed', () => {
  assert.equal(
    selectGroupFloorplan('room', ['mqtt/lamp'], [floorplan('a', [])]),
    null,
  );
  assert.equal(selectGroupFloorplan('room', ['mqtt/lamp'], []), null);
});

test('getGroupFocusBounds pads and clamps to the floorplan', () => {
  const bounds = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 10, y: 20 }, 'mqtt/sensor': { x: 30, y: 20 } },
    ['mqtt/lamp', 'mqtt/sensor'],
    { width: 100, height: 100 },
    0.5,
  );

  // minSpan = 25 (25% of the longest edge), padding = 12.5.
  assert.deepEqual(bounds, { x: 0, y: 0, width: 50, height: 50 });
});

test('getGroupFocusBounds ignores unplaced devices and empty input', () => {
  assert.equal(
    getGroupFocusBounds({}, ['mqtt/lamp'], { width: 100, height: 100 }),
    null,
  );

  const bounds = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 50, y: 50 } },
    ['mqtt/lamp', 'mqtt/missing'],
    { width: 100, height: 100 },
    0,
  );
  assert.deepEqual(bounds, { x: 37.5, y: 37.5, width: 25, height: 25 });
});

test('getGroupFocusBounds caps a lone device zoom with a minimum span', () => {
  const bounds = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 600, y: 400 } },
    ['mqtt/lamp'],
    { width: 1200, height: 800 },
  );

  // minSpan = 300 (25% of 1200), padding = 75 -> 450x450 box.
  assert.deepEqual(bounds, { x: 375, y: 175, width: 450, height: 450 });
});

test('getGroupFocusBounds keeps tight bounds when the minimum span is disabled', () => {
  const bounds = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 600, y: 400 } },
    ['mqtt/lamp'],
    { width: 1200, height: 800 },
    0,
    0,
  );

  assert.deepEqual(bounds, { x: 600, y: 400, width: 1, height: 1 });
});

test('getGroupFocusBounds shifts at floorplan edges to keep the minimum span', () => {
  const nearLeft = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 2, y: 50 } },
    ['mqtt/lamp'],
    { width: 100, height: 100 },
    0,
  );
  assert.deepEqual(nearLeft, { x: 0, y: 37.5, width: 25, height: 25 });

  const nearRight = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 98, y: 50 } },
    ['mqtt/lamp'],
    { width: 100, height: 100 },
    0,
  );
  assert.deepEqual(nearRight, { x: 75, y: 37.5, width: 25, height: 25 });
});

test('getGroupFocusBounds keeps wide clusters at their own span', () => {
  const bounds = getGroupFocusBounds(
    { 'mqtt/lamp': { x: 0, y: 100 }, 'mqtt/sensor': { x: 600, y: 100 } },
    ['mqtt/lamp', 'mqtt/sensor'],
    { width: 1200, height: 800 },
    0,
  );

  assert.deepEqual(bounds, { x: 0, y: 0, width: 600, height: 300 });
});
