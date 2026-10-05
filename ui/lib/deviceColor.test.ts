import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  colorParts,
  colorToCss,
  colorToRgb,
  convertColor,
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
const ct = { ct: 4000 };

describe('device colour wire format', () => {
  it('edits and previews Kelvin directly, matching the backend DeviceColor contract', () => {
    assert.equal(colorParts({ ct: 2700 })[0].display, 2700);
    assert.equal(colorParts({ ct: 2700 })[0].unit, ' K');
    assert.deepEqual(withColorPart({ ct: 2700 }, 'ct', 6500), { ct: 6500 });
    assert.equal(formatColorExact({ ct: 2700 }), '2700 K');
    assert.equal(describeColorName({ ct: 2700 }), 'warm white');
    assert.equal(describeColorName({ ct: 6500 }), 'cool white');
    assert.ok(colorToRgb({ ct: 2700 }).b < colorToRgb({ ct: 6500 }).b);
    assert.deepEqual(defaultColorFor('ct'), { ct: 2700 });
  });
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

  it('uses full-value HSV so zero saturation is white and hue stays vivid', () => {
    assert.deepEqual(colorToRgb({ h: 0, s: 0 }), { r: 255, g: 255, b: 255 });
    assert.deepEqual(colorToRgb({ h: 0, s: 1 }), { r: 255, g: 0, b: 0 });
    assert.deepEqual(colorToRgb({ h: 120, s: 1 }), { r: 0, g: 255, b: 0 });
  });
});

describe('convertColor', () => {
  it('converts between hs and rgb without drifting the hue', () => {
    assert.deepEqual(convertColor({ h: 0, s: 1 }, 'rgb'), {
      r: 255,
      g: 0,
      b: 0,
    });
    assert.deepEqual(convertColor({ r: 0, g: 0, b: 255 }, 'hs'), {
      h: 240,
      s: 1,
    });
    const round = convertColor(convertColor({ h: 200, s: 0.6 }, 'rgb'), 'hs');
    assert.ok(Math.abs((round as { h: number }).h - 200) <= 1);
    assert.ok(Math.abs((round as { s: number }).s - 0.6) < 0.01);
  });

  it('keeps the value when the mode is unchanged', () => {
    const color = { h: 12, s: 0.3 };
    assert.equal(convertColor(color, 'hs'), color);
  });

  it('maps colour temperature through the Planckian locus and back', () => {
    const xy = convertColor({ ct: 2700 }, 'xy') as { x: number; y: number };
    assert.ok(Math.abs(xy.x - 0.46) < 0.01 && Math.abs(xy.y - 0.41) < 0.01);
    const ct = convertColor(xy, 'ct') as { ct: number };
    assert.ok(Math.abs(ct.ct - 2700) < 100);
    const warm = convertColor({ ct: 2700 }, 'rgb') as { r: number; b: number };
    assert.equal(warm.r, 255);
    assert.ok(warm.b < 200);
  });

  it('clamps converted temperatures to the target range', () => {
    const daylight = { x: 0.3127, y: 0.329 };
    assert.deepEqual(convertColor(daylight, 'ct', { start: 2200, end: 4000 }), {
      ct: 4000,
    });
  });
});
