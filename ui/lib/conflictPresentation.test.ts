import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeConflictValue } from './conflictPresentation.ts';
test('conflict reviews mask credentials throughout nested objects and arrays', () => {
  const value = {
    password: 'do-not-print',
    sources: [
      {
        token: 'hide-this',
        endpoint: 'https://user:pass@example.test?api_key=another-secret',
      },
    ],
    custom: { sensitive: 'classified' },
    harmless: 'visible',
  };
  const text = describeConflictValue(value, '/config', [
    '/config/custom/sensitive',
  ]);
  for (const secret of [
    'do-not-print',
    'hide-this',
    'user:pass',
    'another-secret',
    'classified',
  ])
    assert.ok(!text.includes(secret));
  assert.ok(text.includes('visible'));
  assert.equal(
    describeConflictValue('sensitive-text', '/config/password'),
    'Hidden value',
  );
  assert.equal(
    describeConflictValue(undefined, '/config/password'),
    'Not specified',
  );
});

test('configuration review displays generated bigint cadence and revisions without losing precision', () => {
  const text = describeConflictValue(
    { refresh_ms: 60000n, revision: 9007199254740993n, token: 1234n },
    '/compute',
  );
  assert.ok(text.includes('60000'));
  assert.ok(text.includes('9007199254740993'));
  assert.ok(!text.includes('1234'));
  assert.equal(describeConflictValue(60000n, '/compute/refresh_ms'), '60000');
});
