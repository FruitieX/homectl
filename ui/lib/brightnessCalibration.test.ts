import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addBrightnessPoint,
  brightnessClampSummary,
  brightnessCurveError,
  brightnessPointError,
  brightnessReviewRows,
  formatPercent,
  isDimmableDevice,
  mapBrightnessInput,
  mapBrightnessOutput,
  parsePercent,
  removeBrightnessPoint,
  setBrightnessPoint,
  sortBrightnessPoints,
  stepBrightnessValue,
  suggestedBrightnessPoints,
} from './brightnessCalibration.ts';

const curve = [
  { logical: 0.1, output: 0.04 },
  { logical: 0.5, output: 0.3 },
  { logical: 1, output: 0.8 },
];

test('suggestions are editable points, not a required sequence', () => {
  const points = suggestedBrightnessPoints();
  assert.deepEqual(
    points.map((point) => point.logical),
    [1, 0.5, 0.1],
  );
  assert.ok(points.every((point) => point.logical === point.output));

  // A point can be added anywhere and the curve stays ordered.
  const withNew = addBrightnessPoint(points, 0.3);
  assert.deepEqual(
    withNew.map((point) => point.logical),
    [0.1, 0.3, 0.5, 1],
  );
  assert.equal(withNew[1].output, 0.3, 'a new point starts as identity');
  // Adding the same level twice replaces rather than duplicates.
  assert.equal(addBrightnessPoint(withNew, 0.3).length, 4);
  assert.equal(removeBrightnessPoint(withNew, 0.3).length, 3);
});

test('percentages round-trip through typed text and steps', () => {
  assert.equal(parsePercent('4.2'), 0.042);
  assert.equal(parsePercent('4,2%'), 0.042);
  assert.equal(parsePercent('100'), 1);
  assert.equal(parsePercent('0'), null, 'zero is never a positive level');
  assert.equal(parsePercent(''), null, 'an empty field is not zero');
  assert.equal(parsePercent('120'), null);
  assert.equal(formatPercent(0.042), '4.2%');
  assert.equal(formatPercent(0.5), '50%');
  assert.equal(formatPercent(1), '100%');

  assert.equal(stepBrightnessValue(0.5, 'up'), 0.51);
  assert.equal(stepBrightnessValue(0.5, 'down', 0.001), 0.499);
  assert.equal(stepBrightnessValue(0.001, 'down', 0.001), 0.001);
  assert.equal(stepBrightnessValue(1, 'up'), 1);
});

test('validation names the row that is wrong', () => {
  const duplicate = [
    { logical: 0.5, output: 0.2 },
    { logical: 0.5, output: 0.6 },
  ];
  assert.match(
    brightnessPointError(duplicate, 1) ?? '',
    /same desired brightness/,
  );

  const descending = [
    { logical: 0.2, output: 0.6 },
    { logical: 0.4, output: 0.3 },
  ];
  assert.match(brightnessPointError(descending, 1) ?? '', /cannot drop/);

  const outOfRange = [
    { logical: 0.2, output: 0.6 },
    { logical: 1.2, output: 0.7 },
  ];
  assert.match(brightnessPointError(outOfRange, 1) ?? '', /up to 100%/);

  // Fewer than two points blocks Save, and an untouched suggestion is valid.
  assert.match(
    brightnessCurveError([{ logical: 0.5, output: 0.5 }]) ?? '',
    /at least 2/,
  );
  assert.equal(brightnessCurveError(suggestedBrightnessPoints()), null);
  assert.equal(brightnessCurveError([]), null, 'no curve means identity');

  // Editing keeps the exact entered value.
  const edited = setBrightnessPoint(curve, 0, 'output', 0.0375);
  assert.equal(edited[0].output, 0.0375);
  assert.deepEqual(
    sortBrightnessPoints(edited).map((point) => point.logical),
    [0.1, 0.5, 1],
  );
});

test('the client maps brightness exactly like the server does', () => {
  assert.equal(mapBrightnessOutput([], 0.42), 0.42);
  assert.equal(mapBrightnessOutput(curve, 0), 0);
  assert.equal(
    mapBrightnessOutput(curve, 0.02),
    0.04,
    'below the floor clamps to it',
  );
  assert.equal(
    mapBrightnessOutput(curve, 1),
    0.8,
    'a custom top anchor caps the ceiling',
  );
  const middle = mapBrightnessOutput(curve, 0.3);
  assert.ok(Math.abs(middle - 0.17) < 1e-6, `got ${middle}`);

  assert.equal(mapBrightnessInput(curve, 0.3), 0.5);
  const back = mapBrightnessInput(curve, 0.17);
  assert.ok(Math.abs(back - 0.3) < 1e-5, `got ${back}`);

  const plateau = [
    { logical: 0.2, output: 0.3 },
    { logical: 0.6, output: 0.3 },
  ];
  assert.equal(
    mapBrightnessInput(plateau, 0.3),
    0.2,
    'a plateau resolves to its floor',
  );
  assert.equal(mapBrightnessInput(curve, 0.01), 0.1);
  assert.equal(mapBrightnessInput(curve, 0.95), 1);
});

test('the review says what the edges do, including a capped ceiling', () => {
  const capped = brightnessClampSummary(curve);
  assert.match(capped.floor, /10% the light stays at 4%/);
  assert.match(capped.ceiling, /100% no longer means full/);

  const identity = brightnessClampSummary([
    { logical: 0.1, output: 0.1 },
    { logical: 1, output: 1 },
  ]);
  assert.match(identity.ceiling, /100% still sends 100%/);

  const none = brightnessClampSummary([]);
  assert.match(none.floor, /Unchanged/);

  const rows = brightnessReviewRows(curve);
  assert.deepEqual(rows[0], { logical: '10%', output: '4%', changes: true });
  assert.deepEqual(rows[2], { logical: '100%', output: '80%', changes: true });
  assert.equal(
    brightnessReviewRows([{ logical: 0.5, output: 0.5 }])[0].changes,
    false,
  );
});

test('dimmable means the brightness capability, colour or not', () => {
  assert.equal(
    isDimmableDevice({
      data: { Controllable: { capabilities: { brightness: true } } },
    }),
    true,
  );
  assert.equal(
    isDimmableDevice({
      data: { Controllable: { capabilities: { brightness: null } } },
    }),
    false,
  );
  assert.equal(isDimmableDevice({ data: { Sensor: {} } }), false);
});
