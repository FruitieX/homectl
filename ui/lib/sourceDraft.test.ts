import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sourceDefaults,
  validateSourceDraft,
  computationKey,
  validateSourceTiming,
  sourceParamField,
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

test('circadian timing rejects invalid windows and focuses the editable parameter', () => {
  const compute = sourceDefaults().compute;
  const params = compute.params as Record<string, unknown>;
  for (const [field, values] of Object.entries({
    day_fade_duration_hours: [0, -1, 1.5, 24, '2', null],
    night_fade_duration_hours: [4, 5], // Midnight itself also wraps to the next day.
    day_fade_start: ['', '24:00', '06:60', '6am'],
    day_brightness: [-0.1, 1.1, '0', Infinity],
  })) {
    for (const value of values) {
      const invalid = { ...compute, params: { ...params, [field]: value } };
      assert.ok(
        validateSourceTiming(invalid).some(
          (e) => e.field === sourceParamField(compute, field),
        ),
        `${field}: ${value}`,
      );
    }
  }
  assert.ok(
    validateSourceTiming({
      ...compute,
      params: { ...params, day_fade_duration_hours: 15 },
    }).some((e) => e.field === sourceParamField(compute, 'night_fade_start')),
  );
  for (const brightness of [undefined, null, 0, 1]) {
    // Adjacent fades are allowed; an unspecified brightness is preserved.
    assert.deepEqual(
      validateSourceTiming({
        ...compute,
        params: {
          ...params,
          day_fade_duration_hours: 14,
          day_brightness: brightness,
        },
      }),
      [],
    );
  }
});

test('only known circadian versions use the circadian parameter contract', () => {
  const invalid = { day_fade_duration_hours: 0 };
  assert.ok(
    validateSourceTiming({
      kind: 'script',
      preset: { id: 'circadian', version: 1 },
      params: invalid,
    }).length,
  );
  for (const compute of [
    { kind: 'script' as const, source_body: 'return {};', params: invalid },
    {
      kind: 'script' as const,
      preset: { id: 'circadian', version: 99 },
      params: invalid,
    },
    { kind: 'circadian_compat' as const, preset_version: 99, params: invalid },
  ])
    assert.deepEqual(validateSourceTiming(compute), []);
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
