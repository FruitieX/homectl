import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FloorplanGrid } from '../ui/FloorplanGridEditor';
import {
  membershipAdditions,
  roomAtPlacement,
  roomMembershipSuggestions,
} from './floorplan-room-membership.ts';

const grid = {
  width: 6,
  height: 4,
  tileSize: 32,
  deviceScale: 1,
  tiles: [],
  devices: [
    { deviceKey: 'ble/AA', deviceName: 'Sensor', x: 1, y: 1 },
    { deviceKey: 'z2m/lamp', deviceName: 'Lamp', x: 2.4, y: 1.2 },
    { deviceKey: 'z2m/closet', deviceName: 'Closet light', x: 3, y: 1 },
    { deviceKey: 'ble/out', deviceName: 'Yard', x: 9, y: -2 },
  ],
  groups: {
    living: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
    closet: [{ x: 3, y: 1 }],
  },
} as unknown as FloorplanGrid;

const groups = [
  { id: 'living', name: 'Living room', device_keys: ['z2m/lamp'] },
  { id: 'closet', name: 'Closet', device_keys: [] },
];

test('a device belongs to the smallest room area covering its tile', () => {
  assert.equal(roomAtPlacement(grid, groups, { x: 3, y: 1 })?.id, 'closet');
  assert.equal(roomAtPlacement(grid, groups, { x: 1.4, y: 0.6 })?.id, 'living');
  assert.equal(roomAtPlacement(grid, groups, { x: 9, y: -2 }), undefined);
});

test('suggests only devices that are not yet members of their room', () => {
  assert.deepEqual(
    roomMembershipSuggestions(grid, groups).map((s) => [
      s.deviceKey,
      s.groupId,
    ]),
    [
      ['ble/AA', 'living'],
      ['z2m/closet', 'closet'],
    ],
  );
  const additions = membershipAdditions(
    roomMembershipSuggestions(grid, groups),
  );
  assert.deepEqual(additions.get('living'), [
    { integration_id: 'ble', device_id: 'AA' },
  ]);
});
