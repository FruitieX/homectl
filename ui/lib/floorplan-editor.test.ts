import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyGrid,
  applyTilePoints,
  applyGroupPoints,
  cropGridState,
  resizeGridState,
  moveDeviceOnGrid,
  placeSelectedDeviceOnGrid,
} from './floorplan-editor.ts';
const fixture = () => ({
  ...createEmptyGrid(5, 4, 20),
  future: { kept: true },
  devices: [
    {
      deviceKey: 'mqtt/lamp',
      deviceName: 'Lamp',
      x: 2.7,
      y: 1.3,
      future: 'device',
    },
  ],
  groups: { room: [{ x: 2, y: 1, future: 'mask' }] },
});
test('painting is immutable and preserves unrelated cells, masks, placements and extensions', () => {
  const original = fixture();
  const next = applyTilePoints(
    original,
    [
      { x: 0, y: 0 },
      { x: 4, y: 3 },
    ],
    'wall',
  )!;
  assert.equal(original.tiles[0][0], 'floor');
  assert.equal(next.tiles[0][0], 'wall');
  assert.equal(next.tiles[3][4], 'wall');
  assert.deepEqual(next.future, original.future);
  assert.equal(next.devices, original.devices);
  assert.equal(next.groups, original.groups);
  assert.equal(applyTilePoints(next, [{ x: 0, y: 0 }], 'wall'), null);
});
test('room painting adds unique points and erases only the selected mask', () => {
  const original = fixture(),
    next = applyGroupPoints(
      original,
      'room',
      [
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 3, y: 2 },
      ],
      'paint',
    )!;
  assert.equal(next.groups.room.length, 2);
  assert.equal(next.groups.room[0], original.groups.room[0]);
  assert.equal(next.tiles, original.tiles);
  const erased = applyGroupPoints(next, 'room', next.groups.room, 'erase')!;
  assert.deepEqual(erased.groups, {});
  assert.deepEqual(original.groups.room, [{ x: 2, y: 1, future: 'mask' }]);
});
test('crop frames fractional placements without losing them or extension fields', () => {
  const original = fixture(),
    cropped = cropGridState(original)!;
  assert.equal(cropped.width, 1);
  assert.equal(cropped.height, 1);
  assert.ok(Math.abs(cropped.devices[0].x - 0.7) < 1e-9);
  assert.ok(Math.abs(cropped.devices[0].y - 0.3) < 1e-9);
  assert.equal(cropped.devices[0].future, 'device');
  assert.deepEqual(cropped.groups.room, [{ x: 0, y: 0, future: 'mask' }]);
  assert.deepEqual(cropped.future, original.future);
});
test('left/top resize shifts placements and masks together and prunes only out-of-bounds geometry', () => {
  const original = fixture(),
    grown = resizeGridState(original, 7, 6, 'left', 'top')!;
  assert.equal(grown.devices[0].x, 4.7);
  assert.equal(grown.devices[0].y, 3.3);
  assert.deepEqual(grown.groups.room, [{ x: 4, y: 3, future: 'mask' }]);
  assert.deepEqual(grown.future, original.future);
  const shrunk = resizeGridState(grown, 2, 2, 'right', 'bottom')!;
  assert.equal(shrunk.devices.length, 0);
  assert.deepEqual(shrunk.groups, {});
});
test('moving and placing keep fractional coordinates and preserve unknown fields', () => {
  const original = fixture(),
    moved = moveDeviceOnGrid(original, 'mqtt/lamp', 1.5, 0.4)!;
  assert.equal(moved.devices[0].future, 'device');
  assert.equal(moved.devices[0].x, 1.5);
  assert.equal(original.devices[0].x, 2.7);
  const next = placeSelectedDeviceOnGrid(
    moved,
    'mqtt/other',
    [{ key: 'mqtt/other', name: 'Other', type: 'sensor', groupIds: [] }],
    0.2,
    2.7,
  )!;
  assert.equal(next.devices[1].x, 0.2);
  assert.equal(next.devices[1].y, 2.7);
  assert.equal(placeSelectedDeviceOnGrid(next, 'missing', [], 0, 0), null);
});
