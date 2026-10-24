import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveDeviceSnap,
  FLOORPLAN_DEVICE_MARGIN,
  isDevicePlacementInRange,
  snapDevicePoint,
} from './floorplan-snapping.ts';

test('whole and quarter snapping align device centres, free preserves precision', () => {
  const p = { x: 2.38, y: 3.12 };
  assert.deepEqual(snapDevicePoint(p, 8, 6, 1), { x: 2, y: 3 });
  assert.deepEqual(snapDevicePoint(p, 8, 6, 0.25), { x: 2.5, y: 3 });
  assert.deepEqual(snapDevicePoint(p, 8, 6, 0), p);
});
test('snapping at edges keeps both coordinates on the lattice and within the floorplan', () => {
  assert.deepEqual(snapDevicePoint({ x: 8.8, y: -2 }, 8, 6, 1, 0), {
    x: 7,
    y: 0,
  });
  assert.deepEqual(snapDevicePoint({ x: 8.8, y: 6.8 }, 8, 6, 0.25, 0), {
    x: 7.75,
    y: 5.75,
  });
  assert.deepEqual(snapDevicePoint({ x: 8.8, y: 6.8 }, 8, 6, 0, 0), {
    x: 7.999,
    y: 5.999,
  });
});
test('devices can sit in the margin outside the grid, but not beyond it', () => {
  assert.deepEqual(snapDevicePoint({ x: 8.8, y: -2.2 }, 8, 6, 1), {
    x: 9,
    y: -2,
  });
  assert.deepEqual(snapDevicePoint({ x: 99, y: -99 }, 8, 6, 1), {
    x: 8 + FLOORPLAN_DEVICE_MARGIN - 1,
    y: -FLOORPLAN_DEVICE_MARGIN,
  });
  assert.ok(isDevicePlacementInRange(-3, 8));
  assert.ok(!isDevicePlacementInRange(8 + FLOORPLAN_DEVICE_MARGIN, 8));
});
test('Alt bypass and Shift precision work without altering the chosen snap mode', () => {
  assert.equal(effectiveDeviceSnap(1, {}), 1);
  assert.equal(effectiveDeviceSnap(1, { shiftKey: true }), 0.25);
  assert.equal(effectiveDeviceSnap(0, { shiftKey: true }), 0.25);
  assert.equal(effectiveDeviceSnap(0.25, { altKey: true }), 0);
  assert.equal(effectiveDeviceSnap(1, { altKey: true, shiftKey: true }), 0);
});
