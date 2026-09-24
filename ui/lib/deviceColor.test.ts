import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  colorParts,
  colorToCss,
  colorToRgb,
  defaultColorFor,
  describeColorName,
  formatColorExact,
  getColorMode,
  isDeviceColor,
  withColorPart,
} from './deviceColor.ts';

// The four real wire shapes, exactly as the server sends them (untagged).
const hs = { h: 260, s: 0.8 };
const rgb = { r: 255, g: 128, b: 0 };
const xy = { x: 0.46, y: 0.41 };
const ct = { ct: 270 };

describe('device colour wire format', () => {
  it('recognises every untagged variant', () => {
    assert.equal(getColorMode(hs), 'hs');
    assert.equal(getColorMode(rgb), 'rgb');
    assert.equal(getColorMode(xy), 'xy');
    assert.equal(getColorMode(ct), 'ct');
  });

  it('does not recognise the tagged shapes the old editor assumed', () => {
    assert.equal(getColorMode({ Hs: hs }), undefined);
    assert.equal(getColorMode({ Rgb: rgb }), undefined);
  });

  it('keeps a saved HS value (screenshot 7 regression)', () => {
    assert.equal(isDeviceColor(hs), true);
    assert.equal(getColorMode(hs), 'hs');
    assert.equal(describeColorName(hs), 'purple');
    assert.equal(formatColorExact(hs), 'h 260° · s 80%');
    assert.notEqual(colorToCss(hs), 'transparent');
  });

  it('loads, changes, saves, and reloads each variant unchanged', () => {
    for (const [mode, color] of [
      ['hs', hs],
      ['rgb', rgb],
      ['xy', xy],
      ['ct', ct],
    ] as const) {
      const parts = colorParts(color);
      assert.ok(parts.length > 0, `${mode} has editable parts`);
      const first = parts[0];
      const changed = withColorPart(color, first.key, first.display + 1);
      assert.equal(getColorMode(changed), mode, `${mode} keeps its variant`);
      // Nothing else about the shape changes.
      assert.deepEqual(
        Object.keys(changed).sort(),
        Object.keys(color).sort(),
        `${mode} keeps its keys`,
      );
      // A round trip through JSON (the save/reload path) is lossless.
      assert.deepEqual(JSON.parse(JSON.stringify(changed)), changed);
    }
  });

  it('does not silently drop an XY value it cannot edit directly', () => {
    const changed = withColorPart(xy, 'x', 0.5);
    assert.equal(getColorMode(changed), 'xy');
    assert.equal((changed as { y: number }).y, xy.y);
  });

  it('gives each mode a valid starting value', () => {
    for (const mode of ['hs', 'rgb', 'xy', 'ct'] as const) {
      const color = defaultColorFor(mode);
      assert.equal(getColorMode(color), mode);
      assert.equal(isDeviceColor(color), true);
    }
  });

  it('names colours accessibly without colour being the only signal', () => {
    assert.equal(describeColorName({ h: 32, s: 0.4 }), 'orange');
    assert.equal(describeColorName({ h: 32, s: 0.05 }), 'warm white');
    assert.equal(describeColorName({ h: 200, s: 0.05 }), 'cool white');
    assert.equal(describeColorName(ct), 'soft white');
    assert.equal(describeColorName(rgb), 'orange');
  });

  it('previews brightness without changing the colour itself', () => {
    const full = colorToRgb(hs);
    const dim = colorToCss(hs, 0.5);
    assert.notEqual(dim, colorToCss(hs));
    assert.deepEqual(colorToRgb(hs), full);
  });
});
