import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deepCopy,
  deepEqual,
  firstInvalidField,
  formatFreshness,
  mergeFields,
  pickFields,
  sectionChangedElsewhere,
} from './configSection.ts';

test('deepCopy isolates nested values', () => {
  const source = { name: 'Bedroom', devices: [{ id: 'lamp' }] };
  const copy = deepCopy(source);
  copy.devices[0].id = 'changed';
  assert.equal(source.devices[0].id, 'lamp');
  assert.notEqual(copy, source);
});

test('deepEqual compares nested objects without identity', () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }) === false);
  assert.ok(deepEqual({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(deepEqual([1, 2, 3], [1, 2, 3]));
  assert.ok(!deepEqual([1, 2], [1, 2, 3]));
});

test('pickFields returns only the section fields', () => {
  const item = { id: 'bedroom', name: 'Bedroom', hidden: false, devices: [] };
  assert.deepEqual(pickFields(item, ['name', 'hidden']), {
    name: 'Bedroom',
    hidden: false,
  });
  assert.deepEqual(pickFields(item, ['missing']), { missing: undefined });
});

test('mergeFields keeps fields outside the section', () => {
  const item = {
    id: 'bedroom',
    name: 'Bedroom',
    hidden: false,
    devices: ['a'],
  };
  const merged = mergeFields(item, { name: 'Bedroom 2' });
  assert.deepEqual(merged, {
    id: 'bedroom',
    name: 'Bedroom 2',
    hidden: false,
    devices: ['a'],
  });
  // the original is untouched
  assert.equal(item.name, 'Bedroom');
});

test('sectionChangedElsewhere detects concurrent edits to the same fields', () => {
  const baseline = { name: 'Bedroom', hidden: false };
  assert.equal(
    sectionChangedElsewhere(baseline, { name: 'Bedroom', hidden: false }),
    false,
  );
  assert.equal(
    sectionChangedElsewhere(baseline, { name: 'Bedroom', hidden: true }),
    true,
  );
  // live values outside the section do not count as a conflict
  assert.equal(
    sectionChangedElsewhere(baseline, { name: 'Bedroom', hidden: false }, [
      'devices',
    ]),
    false,
  );
});

test('formatFreshness describes known and unknown freshness', () => {
  const now = 1_000_000;
  assert.equal(formatFreshness(now - 5_000, now), 'just now');
  assert.equal(formatFreshness(now - 45_000, now), '45 seconds ago');
  assert.equal(formatFreshness(now - 60_000, now), '1 minute ago');
  assert.equal(formatFreshness(now - 47 * 60_000, now), '47 minutes ago');
  assert.equal(formatFreshness(now - 3 * 3_600_000, now), '3 hours ago');
  assert.equal(formatFreshness(null, now), 'no fresh report');
  assert.equal(formatFreshness(undefined, now), 'no fresh report');
  assert.equal(formatFreshness(Number.NaN, now), 'no fresh report');
});

test('firstInvalidField points at the first invalid subsection', () => {
  assert.equal(firstInvalidField([]), null);
  assert.equal(
    firstInvalidField([
      { field: 'schedule', message: 'Pick a time' },
      { field: 'name', message: 'Required' },
    ]),
    'schedule',
  );
});

test('pickFields keeps nested paths nested so sections can own sub-fields', () => {
  const item = {
    id: 'morning',
    definition_v2: {
      triggers: [{ id: 't1' }],
      condition: { kind: 'literal', value: true },
      program: { kind: 'native', steps: [] },
    },
  };
  const picked = pickFields(item, ['definition_v2.triggers']);
  assert.deepEqual(picked, { definition_v2: { triggers: [{ id: 't1' }] } });
});

test('mergeFields merges nested paths without dropping sibling fields', () => {
  const item = {
    definition_v2: {
      triggers: [{ id: 't1' }],
      condition: { kind: 'literal', value: true },
      program: { kind: 'native', steps: [] },
    },
  };
  const merged = mergeFields(item, {
    definition_v2: { triggers: [{ id: 't2' }] },
  } as Partial<typeof item>);
  assert.deepEqual(merged.definition_v2.triggers, [{ id: 't2' }]);
  // Sections that own no part of the definition leave it untouched.
  assert.deepEqual(merged.definition_v2.condition, {
    kind: 'literal',
    value: true,
  });
  assert.deepEqual(merged.definition_v2.program, { kind: 'native', steps: [] });
});

test('mergeFields creates missing parents and replaces arrays wholesale', () => {
  const item = { id: 'x' } as Record<string, unknown>;
  const merged = mergeFields(
    item as object,
    {
      definition_v2: { program: { kind: 'native', steps: [{ id: 's1' }] } },
    } as never,
  ) as Record<string, unknown>;
  assert.deepEqual(merged.definition_v2, {
    program: { kind: 'native', steps: [{ id: 's1' }] },
  });
  const replaced = mergeFields(
    { definition_v2: { triggers: [{ id: 'a' }, { id: 'b' }] } } as object,
    { definition_v2: { triggers: [{ id: 'c' }] } } as never,
  ) as Record<string, unknown>;
  assert.deepEqual(
    (replaced.definition_v2 as Record<string, unknown>).triggers,
    [{ id: 'c' }],
  );
});

test('sectionChangedElsewhere compares only the fields the section owns', () => {
  const baseline = { definition_v2: { triggers: [{ id: 't1' }] } };
  assert.equal(
    sectionChangedElsewhere(baseline, {
      definition_v2: {
        triggers: [{ id: 't1' }],
        condition: { kind: 'literal', value: false },
      },
    }),
    false,
  );
  assert.equal(
    sectionChangedElsewhere(baseline, {
      definition_v2: { triggers: [{ id: 't2' }] },
    }),
    true,
  );
  // Deeper nesting inside an owned path is compared all the way down.
  assert.equal(
    sectionChangedElsewhere({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }),
    true,
  );
  assert.equal(
    sectionChangedElsewhere({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }),
    false,
  );
  // A key the section does not own never raises a conflict.
  assert.equal(
    sectionChangedElsewhere(
      { definition_v2: { triggers: [{ id: 't1' }] } },
      { definition_v2: { triggers: [{ id: 't1' }] }, name: 'renamed' },
    ),
    false,
  );
});
