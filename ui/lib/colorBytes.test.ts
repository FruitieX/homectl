import assert from 'node:assert/strict';
import test from 'node:test';

import { hsToRgbBytes } from './colorBytes.ts';

// The floorplan renderer reads colour tuples as 0–255. Feeding it a normalised
// 0..1 tuple (what hsToRgb returns) made every proposed light render black.
test('hsToRgbBytes returns 0-255 components the renderer can use', () => {
  assert.deepEqual(hsToRgbBytes({ h: 0, s: 1 }), [255, 0, 0]);
  assert.deepEqual(hsToRgbBytes({ h: 120, s: 1 }), [0, 255, 0]);
  assert.deepEqual(hsToRgbBytes({ h: 240, s: 1 }), [0, 0, 255]);
});

test('a desaturated hue renders as bright white, not black', () => {
  assert.deepEqual(hsToRgbBytes({ h: 0, s: 0 }), [255, 255, 255]);
  assert.deepEqual(hsToRgbBytes({ h: 210, s: 0 }), [255, 255, 255]);
});

test('saturated hues never collapse to near-black', () => {
  for (const hue of [0, 60, 120, 180, 240, 300]) {
    const [r, g, b] = hsToRgbBytes({ h: hue, s: 1 });
    assert.ok(
      Math.max(r, g, b) > 1,
      `hue ${hue} produced rgb(${r}, ${g}, ${b}), which renders as black`,
    );
  }
});

test('hue wraps and saturation clamps like the device colour path', () => {
  assert.deepEqual(hsToRgbBytes({ h: 360, s: 1 }), [255, 0, 0]);
  assert.deepEqual(hsToRgbBytes({ h: -120, s: 1 }), [0, 0, 255]);
  assert.deepEqual(hsToRgbBytes({ h: 0, s: 2 }), [255, 0, 0]);
});
