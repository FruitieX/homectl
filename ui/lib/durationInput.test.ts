import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDurationInput } from './durationInput.ts';

test('durations retain exact milliseconds across fractional units', () => {
  assert.deepEqual(parseDurationInput('1.001', 1000, true), { value: 1001 });
  assert.deepEqual(parseDurationInput('1.5', 60000, true), { value: 90000 });
  assert.deepEqual(parseDurationInput(String(1001 / 60000), 60000, true), {
    value: 1001,
  });
  assert.deepEqual(parseDurationInput('0', 1000, true), { value: 0 });
  assert.deepEqual(parseDurationInput('1e2', 1000, true), { value: 100000 });
});
test('duration validation distinguishes incomplete, optional and unsafe values', () => {
  assert.deepEqual(parseDurationInput('', 1000), { value: undefined });
  for (const raw of [
    '',
    '-',
    '1e',
    '-1',
    'Infinity',
    '0.0001',
    '9007199254740992',
  ])
    assert.ok(parseDurationInput(raw, 1000, true).error, raw);
});
