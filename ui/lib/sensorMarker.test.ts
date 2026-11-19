import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from '../bindings/Device';
import type { SensorValueMetadata } from '../bindings/SensorValueMetadata';
import { getSensorMarkerKind } from './sensorMarker.ts';
import {
  formatSensorReadings,
  getSensorDetails,
  describeSensorReadings,
  sensorValueText,
} from './sensorInteraction.ts';

const device = (value: unknown): Device => ({
  id: 'input',
  integration_id: 'mqtt',
  name: 'Temperature sensor',
  data: { Sensor: { value } } as Device['data'],
  raw: null,
});

const collection = (
  values: Record<string, boolean | string | number>,
  metadata: Record<string, SensorValueMetadata> = {},
  order: string[] = [],
): Device => ({
  ...device(null),
  data: {
    Sensors: {
      values: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value }]),
      ),
      metadata,
      order,
    },
  },
});

test('sensor icons follow payload types and known events, without guessing from names', () => {
  for (const [value, expected] of [
    [true, 'boolean_on'],
    [false, 'boolean'],
    [21.5, 'number'],
    ['single', 'button'],
    ['hold', 'button'],
    ['up_press', 'dimmer'],
    ['off', 'power'],
    ['custom', 'text'],
    ['__homectl_unknown_sensor__', 'unknown'],
  ] as const) {
    assert.equal(getSensorMarkerKind(device(value)), expected);
  }
  assert.equal(
    getSensorMarkerKind({
      ...device(null),
      data: {
        Sensor: { power: true, brightness: 0.5, color: null, transition: null },
      },
    }),
    'state',
  );
});

test('saved sensor interaction keeps button and dimmer icons stable across values', () => {
  for (const value of [
    'off',
    'on',
    'custom event',
    '__homectl_unknown_sensor__',
  ]) {
    assert.equal(
      getSensorMarkerKind(device(value), {
        device_ref: 'mqtt/input',
        interaction_kind: 'button_events',
        config: {},
      }),
      'button',
    );
    assert.equal(
      getSensorMarkerKind(device(value), {
        device_ref: 'mqtt/input',
        interaction_kind: 'hue_dimmer',
        config: {},
      }),
      'dimmer',
    );
  }
});

test('multi-reading climate sensors keep every unformatted value without inferred units', () => {
  const climate = collection({
    temperature: 21.44,
    humidity: 45.6,
    battery: 68,
  });
  assert.equal(getSensorMarkerKind(climate), 'climate');
  const details = getSensorDetails(climate);
  assert.ok(details.kind === 'readings');
  assert.equal(formatSensorReadings(details.value), '21.44 · 45.6 · 68');
  assert.equal(formatSensorReadings({ battery: 90 }), '90');
});

test('readings keep text and boolean values', () => {
  const details = getSensorDetails(
    collection({
      temperature: '21.5 °C',
      humidity: 40,
      battery: '85%',
      charging: true,
      state: 'idle',
    }),
  );
  assert.equal(details.kind, 'readings');
  if (details.kind !== 'readings') return;
  assert.equal(
    formatSensorReadings(details.value),
    '21.5 °C · 40 · 85% · true · idle',
  );
});

test('sensor list values show readings, numbers and on/off but not button events', () => {
  assert.equal(sensorValueText(device(21.456)), '21.46');
  assert.equal(sensorValueText(device(true)), 'On');
  assert.equal(sensorValueText(device('on_press_release')), undefined);
  assert.equal(
    sensorValueText(collection({ temperature: 21.4, humidity: 45 })),
    '21.4 · 45',
  );
});

test('discovered collections show every value with expose labels and units', () => {
  const sensor = collection(
    {
      temperature: 72.5,
      energy_total: 0,
      contact: false,
      status: 'false',
      message: '',
    },
    {
      temperature: { label: 'Room temperature', unit: '°F' },
      energy_total: { label: 'Total energy', unit: 'kWh' },
      contact: { label: 'Contact', unit: null },
      status: { label: 'Status', unit: null },
      message: { label: 'Message', unit: null },
    },
    ['contact', 'status', 'temperature', 'energy_total', 'message'],
  );
  const details = getSensorDetails(sensor);
  assert.ok(details.kind === 'readings');
  const described = describeSensorReadings(
    details.value,
    details.metadata,
    details.order,
  );
  assert.deepEqual(
    described.map((reading) => reading.metric),
    details.order,
  );
  assert.deepEqual(
    described.find((r) => r.metric === 'temperature'),
    {
      metric: 'temperature',
      label: 'Room temperature',
      value: '72.5°F',
    },
  );
  assert.equal(
    described.find((r) => r.metric === 'energy_total')?.value,
    '0kWh',
  );
  assert.equal(described.find((r) => r.metric === 'contact')?.value, 'false');
  assert.equal(described.find((r) => r.metric === 'status')?.value, 'false');
  assert.equal(described.find((r) => r.metric === 'message')?.value, '');
  assert.equal(sensorValueText(sensor), 'false · false · 72.5°F · 0kWh · ');
  assert.equal(
    formatSensorReadings(details.value, {
      metadata: details.metadata,
      order: details.order,
      labels: true,
    }),
    'Contact false · Status false · Room temperature 72.5°F · Total energy 0kWh · Message ',
  );
});

test('reading order handles missing reports, integer properties and undeclared values', () => {
  const readings = { '1': 1.2345, '2': 0, extra: false, message: '' };
  const rows = describeSensorReadings(readings, {}, [
    '2',
    'not_reported',
    '1',
    '2',
  ]);
  assert.deepEqual(
    rows.map((row) => row.metric),
    ['2', '1', 'extra', 'message'],
  );
  assert.deepEqual(
    rows.map((row) => row.value),
    ['0', '1.2345', 'false', ''],
  );
  assert.equal(
    formatSensorReadings(
      { text: 'ready', boolean: true },
      {
        labels: true,
        metadata: {
          text: { label: 'Status', unit: '!' },
          boolean: { label: 'Binary', unit: null },
        },
      },
    ),
    'Status ready! · Binary true',
  );
});
