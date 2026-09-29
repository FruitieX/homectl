import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHomectlQueryClient } from './query-client.ts';
import { shareQueryData } from './shareQueryData.ts';

test('cache sharing preserves nested special keys, omission, null and non-JSON leaf values', () => {
  const before = {
    nested: { old: true },
    same: { count: 0 },
    empty: undefined,
  };
  const next = JSON.parse(
    '{"nested":{"__proto__":{"safe":true},"constructor":0,"prototype":false},"same":{"count":0},"none":null}',
  );
  const shared = shareQueryData(before, next) as typeof next;
  assert.deepEqual(shared, next);
  assert.equal(shared.same, before.same);
  assert.equal(Object.getPrototypeOf(shared.nested), Object.prototype);
  assert.equal(Object.hasOwn(shared, 'empty'), false);
  assert.deepEqual(shareQueryData({ value: 1 }, { value: undefined }), {
    value: undefined,
  });
  const date = new Date();
  assert.equal(shareQueryData(new Date(0), date), date);
});

test('configuration cache preserves arbitrary JSON keys through repeated updates', () => {
  const client = createHomectlQueryClient();
  const key = ['config', 'routines'];
  const original = [
    { id: 'routine', mapping: { on: 'normal' }, unchanged: { value: 42 } },
  ];
  client.setQueryData(key, original);
  const next = JSON.parse(
    '[{"id":"routine","mapping":{"on":"normal","__proto__":"night"},"unchanged":{"value":42}}]',
  );
  client.setQueryData(key, next);
  const saved = client.getQueryData<typeof next>(key)!;
  assert.deepEqual(saved, next);
  assert.equal(Object.hasOwn(saved[0].mapping, '__proto__'), true);
  assert.equal(saved[0].unchanged, original[0].unchanged);
  client.setQueryData(key, JSON.parse(JSON.stringify(next)));
  assert.equal(client.getQueryData(key), saved);
  client.setQueryData(key, original);
  assert.equal(
    Object.hasOwn(
      client.getQueryData<typeof original>(key)![0].mapping,
      '__proto__',
    ),
    false,
  );
  client.clear();
});
