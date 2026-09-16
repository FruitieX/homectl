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
  matchingPointsFromProfile,
  pointForCurrentReference,
  getCurrentHsColor,
  canAmendReferencePoint,
  stepCalibrationValue,
  nextManualCalibrationPoint,
  removeCalibrationPoint,
  calibrationPointToUv,
} = load('../lib/colorCalibration.ts', {
  '@/lib/deviceCapabilities': load('../lib/deviceCapabilities.ts'),
});
const { compareDeviceNames } = load('../lib/deviceLabel.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('reference lights sort by name using natural alphanumeric order', () => {
  const devices = [
    { id: '10', integration_id: 'tuya', name: 'Kitchen downlight 10' },
    { id: '2', integration_id: 'tuya', name: 'Kitchen downlight 2' },
    { id: '1', integration_id: 'tuya', name: 'kitchen downlight 1' },
    {
      id: 'strip',
      integration_id: 'zigbee2mqtt',
      name: 'Kitchen lightstrip upper',
    },
  ];

  assert.deepEqual(
    devices.sort(compareDeviceNames).map((device) => device.name),
    [
      'kitchen downlight 1',
      'Kitchen downlight 2',
      'Kitchen downlight 10',
      'Kitchen lightstrip upper',
    ],
  );
});

test('guided pass starts with colors that commonly mismatch between lamps', () => {
  const points = suggestedMatchingPoints();
  assert.equal(points.length, 8);
  assert.equal(points.filter((point) => point.reference.s === 0).length, 1);
  assert.deepEqual(
    plain(points.map((point) => point.label)),
    [
      'Neutral white',
      'Warm white',
      'Cool white',
      'Red',
      'Green',
      'Cyan',
      'Blue',
      'Soft orange',
    ],
  );
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

test('batch calibration accepts every writable chromatic color format', () => {
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
  for (const capability of ['rgb', 'xy']) {
    device.data.Controllable.capabilities = { [capability]: true };
    assert.equal(canCalibrateDevice(device), true);
  }
  device.data.Controllable.capabilities = { ct: { start: 2700, end: 6500 } };
  assert.equal(canCalibrateDevice(device), false);
  device.data.Controllable.capabilities = { rgb: true };
  device.data.Controllable.disabled = true;
  assert.equal(canCalibrateDevice(device), false);
  device.data.Controllable.disabled = false;
  device.data.Controllable.managed = 'FullReadOnly';
  assert.equal(canCalibrateDevice(device), false);
  assert.equal(canCalibrateDevice({ data: { Sensor: {} } }), false);
});

test('existing profiles can be loaded into editable matching points', () => {
  const hsPoints = [
    { reference: { h: 30, s: 0.25 }, output: { h: 45, s: 0.3 } },
    { reference: { h: 120, s: 1 }, output: { h: 110, s: 0.9 } },
  ];
  const profile = {
    id: 'profile',
    name: 'Profile',
    reference_device_key: 'dummy/reference',
    brightness: 0.42,
    points: hsPoints.map(calibrationPointToUv),
  };
  const loaded = matchingPointsFromProfile(profile);
  assert.deepEqual(loaded.map((point) => point.label), ['Point 1', 'Point 2']);
  assert.ok(loaded.every((point) => point.matched));
  for (let index = 0; index < loaded.length; index += 1) {
    assert.ok(Math.abs(loaded[index].reference.h - hsPoints[index].reference.h) <= 1);
    assert.ok(Math.abs(loaded[index].reference.s - hsPoints[index].reference.s) < 0.01);
    assert.ok(Math.abs(loaded[index].output.h - hsPoints[index].output.h) <= 1);
    assert.ok(Math.abs(loaded[index].output.s - hsPoints[index].output.s) < 0.01);
  }
});

test('current reference calibration reuses saved output or existing interpolation', () => {
  const points = [
    {
      label: 'Point 1',
      reference: { h: 0, s: 0 },
      output: { h: 10, s: 0.2 },
      matched: true,
    },
    {
      label: 'Point 2',
      reference: { h: 120, s: 1 },
      output: { h: 110, s: 0.9 },
      matched: true,
    },
  ];
  const existing = pointForCurrentReference(points, { h: 0, s: 0 });
  assert.equal(existing.index, 0);
  assert.deepEqual(plain(existing.point.output), points[0].output);
  assert.equal(existing.point.matched, false);

  const current = { h: 60, s: 0.5 };
  const added = pointForCurrentReference(points, current);
  assert.equal(added.index, points.length);
  assert.deepEqual(plain(added.point.reference), current);
  assert.deepEqual(
    plain(added.point.output),
    plain(calibratedHsv(current, points)),
  );
  assert.equal(added.point.matched, false);
});

test('current reference state accepts HS, RGB, and XY but not color temperature', () => {
  const current = { h: 30, s: 0.25 };
  const device = {
    data: { Controllable: { state: { color: current } } },
  };
  assert.deepEqual(plain(getCurrentHsColor(device)), current);
  const rgbWhite = getCurrentHsColor({
    data: { Controllable: { state: { color: { r: 255, g: 255, b: 255 } } } },
  });
  assert.ok(rgbWhite.s < 0.000001);
  const xyRed = getCurrentHsColor({
    data: { Controllable: { state: { color: { x: 0.64, y: 0.33 } } } },
  });
  assert.ok(xyRed.h <= 2 || xyRed.h >= 358);
  assert.equal(
    getCurrentHsColor({
      data: { Controllable: { state: { color: { ct: 2700 } } } },
    }),
    null,
  );
  const points = [
    { reference: current, output: { h: 45, s: 0.3 } },
    { reference: { h: 120, s: 1 }, output: { h: 110, s: 0.9 } },
  ];
  assert.equal(canAmendReferencePoint(current, points, 0), true);
  assert.equal(canAmendReferencePoint(current, points, 1), false);
  assert.equal(canAmendReferencePoint({ h: 60, s: 0.5 }, points, 1), true);
});

test('calibration sliders step in their displayed units and clamp at bounds', () => {
  assert.equal(stepCalibrationValue(3, -5, 0, 359), 0);
  assert.equal(stepCalibrationValue(357, 5, 0, 359), 359);
  assert.equal(stepCalibrationValue(42.3, -1, 0, 100, 10), 41.3);
});

test('manual points use a unique reference and deletion keeps a valid selection', () => {
  const points = [
    {
      label: 'Point 1',
      reference: { h: 0, s: 0 },
      output: { h: 0, s: 0 },
      matched: true,
    },
  ];
  const added = plain(nextManualCalibrationPoint(points, { h: 0, s: 0 }));
  assert.equal(added.label, 'Point 2');
  assert.notDeepEqual(added.reference, points[0].reference);
  assert.deepEqual(added.output, added.reference);
  assert.equal(added.matched, false);

  const removed = removeCalibrationPoint([...points, added], 1);
  assert.deepEqual(plain(removed.points), points);
  assert.equal(removed.index, 0);
  const preserved = removeCalibrationPoint(points, 0);
  assert.deepEqual(plain(preserved.points), points);
  assert.equal(preserved.index, 0);
});
