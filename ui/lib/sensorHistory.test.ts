import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ValueHistoryEntry } from '../bindings/ValueHistoryEntry';
import { sensorHistoryFields } from './sensorHistory.ts';

test('history graphs follow expose order across partial reports and keep samples chronological', () => {
  const entries: ValueHistoryEntry[] = [
    {
      changed_at_ms: 20n,
      value: { battery: 80, humidity: 42, temperature: 22 },
    },
    { changed_at_ms: 10n, value: { temperature: 21 } },
  ];
  const fields = sensorHistoryFields(entries, [
    'temperature',
    'occupancy',
    'humidity',
    'battery',
  ]);
  assert.deepEqual(
    fields.map((field) => field.name),
    ['temperature', 'humidity', 'battery'],
  );
  assert.deepEqual(fields[0].samples, [
    { time: 10, value: 21 },
    { time: 20, value: 22 },
  ]);
});

test('history retains fields outside the current exposes and works without discovery order', () => {
  const entries: ValueHistoryEntry[] = [
    {
      changed_at_ms: 20n,
      value: { old_reading: 0, battery: 80, temperature: 22 },
    },
  ];
  assert.deepEqual(
    sensorHistoryFields(entries, ['temperature', 'battery', 'battery']).map(
      (field) => field.name,
    ),
    ['temperature', 'battery', 'old_reading'],
  );
  assert.deepEqual(
    sensorHistoryFields(entries).map((field) => field.name),
    ['old_reading', 'battery', 'temperature'],
  );
});
