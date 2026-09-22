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

  assert.deepEqual(bounds, { x: 0, y: 10, width: 40, height: 20 });
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
  assert.deepEqual(bounds, { x: 50, y: 50, width: 1, height: 1 });
});
