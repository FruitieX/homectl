const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}) {
  const context = {
    exports: {},
    require: (name) => imports[name] ?? require(name),
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context,
  );
  return context.exports;
}
const {
  suggestedMatchingPoints,
  verificationColors,
  calibratedHsv,
  toggleSelection,
  canCalibrateDevice,
} = load('../lib/colorCalibration.ts', {
  '@/lib/deviceCapabilities': load('../lib/deviceCapabilities.ts'),
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test('guided pass covers distinct whites plus the hue circle at two saturations', () => {
  const points = suggestedMatchingPoints();
  assert.equal(points.length, 15);
  assert.equal(points.filter((point) => point.reference.s === 0).length, 1);
  for (const saturation of [1, 0.45]) {
    assert.deepEqual(
      plain(
        points
          .filter((point) => point.reference.s === saturation)
          .map((point) => point.reference.h),
      ),
      [0, 60, 120, 180, 240, 300],
    );
  }
  assert.equal(
    new Set(points.map((point) => JSON.stringify(point.reference))).size,
    points.length,
  );
  assert.ok(points.every((point) => !point.matched));
  assert.ok(
    verificationColors.every(
      ({ color }) =>
        !points.some(
          (point) =>
            point.reference.h === color.h && point.reference.s === color.s,
        ),
    ),
  );
  points[0].output.s = 0.2;
  assert.equal(suggestedMatchingPoints()[0].output.s, 0);
});

test('verification previews honor measured points and handle wrap and clipping', () => {
  const points = [{ reference: { h: 350, s: 0.5 }, output: { h: 10, s: 1 } }];
  assert.deepEqual(
    plain(calibratedHsv(points[0].reference, points)),
    points[0].output,
  );
  const wrapped = calibratedHsv({ h: 355, s: 0.9 }, points);
  assert.ok(wrapped.h < 20);
  assert.equal(wrapped.s, 1);
  const identity = suggestedMatchingPoints();
  for (const { color } of verificationColors)
    assert.deepEqual(plain(calibratedHsv(color, identity)), plain(color));
});

test('white correction stays continuous regardless of incoming hue', () => {
  const points = [{ reference: { h: 0, s: 0 }, output: { h: 30, s: 0.2 } }];
  for (let h = 0; h < 360; h += 30) {
    const output = calibratedHsv({ h, s: 0.001 }, points);
    assert.equal(output.h, 30);
    assert.ok(Math.abs(output.s - 0.2) < 0.0011);
  }
});

test('batch selection preserves hidden selections and never duplicates keys', () => {
  assert.deepEqual(plain(toggleSelection(['hidden'], ['a', 'b'])), [
    'hidden',
    'a',
    'b',
  ]);
  assert.deepEqual(plain(toggleSelection(['hidden', 'a', 'b'], ['a', 'b'])), [
    'hidden',
  ]);
  assert.deepEqual(plain(toggleSelection(['a'], ['a', 'b'])), ['a', 'b']);
  assert.deepEqual(plain(toggleSelection(['hidden'], [])), ['hidden']);
});

test('batch calibration only accepts writable HSV lights', () => {
  const device = {
    data: {
      Controllable: {
        capabilities: { hs: true },
        managed: 'Full',
        disabled: false,
      },
    },
  };
  assert.equal(canCalibrateDevice(device), true);
  device.data.Controllable.disabled = true;
  assert.equal(canCalibrateDevice(device), false);
  device.data.Controllable.disabled = false;
  device.data.Controllable.managed = 'FullReadOnly';
  assert.equal(canCalibrateDevice(device), false);
  assert.equal(canCalibrateDevice({ data: { Sensor: {} } }), false);
});
