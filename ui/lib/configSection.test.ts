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
