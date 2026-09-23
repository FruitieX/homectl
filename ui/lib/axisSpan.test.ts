import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  enforceMinimumSpan,
  MINIMUM_HUMIDITY_SPAN_PERCENT,
  MINIMUM_TEMPERATURE_SPAN_C,
  minimumSpanForUnit,
} from '../ui/charts/axisSpan.ts';

test('a flat temperature series is widened to the minimum span', () => {
  const [low, high] = enforceMinimumSpan(21.0, 21.2, MINIMUM_TEMPERATURE_SPAN_C);
  assert.equal(high - low, MINIMUM_TEMPERATURE_SPAN_C);
  assert.equal((low + high) / 2, 21.1);
});

test('a wide temperature series is untouched', () => {
  assert.deepEqual(enforceMinimumSpan(10, 24, MINIMUM_TEMPERATURE_SPAN_C), [10, 24]);
});

test('humidity uses its own floor', () => {
  const [low, high] = enforceMinimumSpan(42, 43.5, minimumSpanForUnit('%'));
  assert.equal(high - low, MINIMUM_HUMIDITY_SPAN_PERCENT);
});

test('units without a floor keep their range, and bad input passes through', () => {
  assert.equal(minimumSpanForUnit('m/s'), 0);
  assert.deepEqual(enforceMinimumSpan(1, 2, 0), [1, 2]);
  assert.deepEqual(enforceMinimumSpan(Number.NaN, 2, 2), [Number.NaN, 2]);
});
