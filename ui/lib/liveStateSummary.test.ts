import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeLiveStates } from './liveStateSummary.ts';

const state = {
  power: true,
  brightness: 0.6,
  color: { ct: 2700 },
  transition: null,
};
test('equal state previews do not depend on color key order', () => {
  const result = summarizeLiveStates([
    { ...state, color: { h: 20, s: 0.4 } },
    { ...state, color: { s: 0.4, h: 20 } },
  ]);
  assert.equal(result.certainty, 'known');
  assert.equal(result.brightness, 0.6);
});
test('mixed brightness never becomes an average shared value', () => {
  const result = summarizeLiveStates([state, { ...state, brightness: 0.2 }]);
  assert.equal(result.certainty, 'mixed');
  assert.equal(result.brightness, null);
  assert.deepEqual(result.color, state.color);
});
test('unknown members prevent a misleading complete preview', () => {
  assert.equal(summarizeLiveStates([state, undefined]).certainty, 'mixed');
  assert.equal(summarizeLiveStates([]).certainty, 'unresolved');
  assert.equal(summarizeLiveStates([undefined]).certainty, 'unresolved');
});
test('off and unspecified values retain their meaning', () => {
  const result = summarizeLiveStates([
    { ...state, power: false, brightness: null, color: null },
  ]);
  assert.equal(result.power, false);
  assert.equal(result.brightness, null);
  assert.equal(result.color, null);
  assert.deepEqual(result.samples, []);
});
