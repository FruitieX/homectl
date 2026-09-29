import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  editableCondition,
  editableValueSource,
  valueSourceKey,
} from './conditionEditing.ts';

test('unknown or malformed condition fields remain unsupported instead of being coerced', () => {
  const malformed = [
    null,
    [],
    { kind: 'future', value: false },
    { kind: 'literal', value: null },
    { kind: 'all', conditions: null },
    { kind: 'comparison', source: { kind: 'future' }, operator: 'eq' },
    {
      kind: 'comparison',
      source: { kind: 'device', device: null, path: '/value' },
      operator: 'eq',
    },
    { kind: 'group', group_id: 'room', quantifier: 'future' },
    { kind: 'group', group_id: 'room', quantifier: 'all', power: null },
  ];
  for (const value of malformed) {
    const before = structuredClone(value);
    assert.equal(editableCondition(value), false);
    assert.deepEqual(value, before);
  }
  // Unsupported children are handled at their own node without hiding valid siblings.
  assert.equal(editableCondition({ kind: 'all', conditions: malformed }), true);
});
test('source identities distinguish kinds and preserve path-independent editor identity', () => {
  const sources = [
    {
      kind: 'device' as const,
      device: { integration_id: 'mqtt', device_id: 'room/lamp' },
      path: '/power',
    },
    { kind: 'helper' as const, helper: 'mqtt/room/lamp' },
    {
      kind: 'computed_source' as const,
      source: 'mqtt/room/lamp',
      path: '/brightness',
    },
  ];
  assert.equal(new Set(sources.map(valueSourceKey)).size, 3);
  for (const source of sources) {
    assert.equal(editableValueSource(source), true);
    for (const value of [false, 0, '', null, [], { future: [false, 0] }])
      assert.equal(
        editableCondition({
          kind: 'comparison',
          source,
          operator: 'eq',
          value,
        }),
        true,
      );
  }
  assert.equal(
    editableValueSource({ kind: 'computed_source', source: 'id', path: [] }),
    false,
  );
});
