import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sourceDefaults,
  validateSourceDraft,
  computationKey,
} from '../app/config/sources/shared.ts';

test('source script params preserve every JSON shape and require exactly one body or pin', () => {
  for (const params of [
    null,
    false,
    0,
    '',
    [],
    [0, null],
    {},
    { future: [false, 0, null] },
  ]) {
    const source = {
      ...sourceDefaults(),
      id: 'source',
      name: 'Source',
      compute: {
        kind: 'script' as const,
        source_body: 'return { value: {} };',
        params,
      },
    };
    const before = structuredClone(source);
    assert.deepEqual(validateSourceDraft(source), []);
    assert.deepEqual(source, before);
    assert.ok(
      validateSourceDraft({
        ...source,
        compute: { ...source.compute, preset: { id: 'circadian', version: 1 } },
      }).some((e) => e.field === 'compute'),
    );
    assert.ok(
      validateSourceDraft({
        ...source,
        compute: { ...source.compute, source_body: '  ' },
      }).some((e) => e.field === 'compute'),
    );
  }
});
test('source aliases distinguish omission and empty lists from malformed or duplicate entries', () => {
  const source = { ...sourceDefaults(), id: 'source', name: 'Source' };
  for (const aliases of [
    undefined,
    [],
    ['legacy/one'],
    ['legacy/one', 'legacy/two'],
  ])
    assert.deepEqual(validateSourceDraft({ ...source, aliases }), []);
  for (const aliases of [null, {}, ['a'], ['a/b/c'], ['a/b', 'a/b'], [0]])
    assert.ok(
      validateSourceDraft({ ...source, aliases } as typeof source).some(
        (e) => e.field === 'aliases',
      ),
    );
});
test('unknown built-in versions and script pins retain separate identities', () => {
  assert.equal(computationKey(sourceDefaults().compute), 'circadian_compat');
  assert.equal(
    computationKey({
      kind: 'circadian_compat',
      preset_version: 99,
      params: { future: true },
    }),
    'circadian_compat@99',
  );
  assert.equal(
    computationKey({
      kind: 'script',
      preset: { id: 'circadian', version: 99 },
      params: null,
    }),
    'circadian@99',
  );
});
