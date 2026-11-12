import assert from 'node:assert/strict';
import { test } from 'node:test';

import { priceWindow } from './widgetData.ts';

test('priceWindow keeps all available prices beyond 24 hours', () => {
  const now = Date.UTC(2026, 10, 12, 17, 0);
  const rows = Array.from({ length: 40 }, (_, i) => ({
    _time: new Date(now + i * 3600000),
    _value: i,
  }));
  const result = priceWindow(rows, now);
  assert.equal(result.data.length, 40);
  assert.equal(result.data.at(-1)?.end, now + 40 * 3600000);
});
