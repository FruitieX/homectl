import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  exceedsLongPressTolerance,
  longPressDelayMs,
  longPressMoveTolerancePx,
} from './longPress.ts';

test('a press that stays within the tolerance stays a hold', () => {
  assert.equal(
    exceedsLongPressTolerance({ x: 100, y: 100 }, { x: 106, y: 108 }),
    false,
  );
});

test('a press that travels past the tolerance is a scroll', () => {
  assert.equal(
    exceedsLongPressTolerance({ x: 100, y: 100 }, { x: 100, y: 111 }),
    true,
  );
});

test('the tolerance is a straight-line distance, not per axis', () => {
  assert.equal(exceedsLongPressTolerance({ x: 0, y: 0 }, { x: 8, y: 8 }), true);
  assert.equal(
    exceedsLongPressTolerance({ x: 0, y: 0 }, { x: 6, y: 6 }),
    false,
  );
});

test('a custom tolerance overrides the default', () => {
  assert.equal(
    exceedsLongPressTolerance({ x: 0, y: 0 }, { x: 0, y: 12 }, 20),
    false,
  );
  assert.equal(exceedsLongPressTolerance({ x: 0, y: 0 }, { x: 0, y: 12 }), true);
});

test('the shared defaults match the gesture contract', () => {
  assert.equal(longPressDelayMs, 500);
  assert.equal(longPressMoveTolerancePx, 10);
});
