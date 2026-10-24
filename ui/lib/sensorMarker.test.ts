import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from '../bindings/Device';
import { getSensorMarkerKind } from './sensorMarker.ts';
import {
  formatSensorReadings,
  getSensorDetails,
  sensorValueText,
} from './sensorInteraction.ts';

const device = (value: unknown): Device => ({
  id: 'input',
  integration_id: 'mqtt',
  name: 'Temperature sensor',
  data: { Sensor: { value } } as Device['data'],
  raw: null,
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

test('multi-reading climate sensors get a thermometer and a compact summary', () => {
  const climate: Device = {
    ...device(null),
    data: {
      Sensor: { readings: { temperature: 21.44, humidity: 45.6, battery: 68 } },
    },
  };
  assert.equal(getSensorMarkerKind(climate), 'climate');
  const details = getSensorDetails(climate);
  assert.equal(details.kind, 'readings');
  assert.ok(details.kind === 'readings');
  assert.equal(formatSensorReadings(details.value), '21.4 °C · 46%');
  assert.equal(
    formatSensorReadings(details.value, { full: true }),
    '21.4 °C · 46% · Battery 68%',
  );
  assert.equal(formatSensorReadings({ battery: 90 }), 'Battery 90%');
});

test('sensor list values show readings, numbers and on/off but not button events', () => {
  assert.equal(sensorValueText(device(21.456)), '21.46');
  assert.equal(sensorValueText(device(true)), 'On');
  assert.equal(sensorValueText(device('on_press_release')), undefined);
  assert.equal(
    sensorValueText({
      ...device(null),
      data: { Sensor: { readings: { temperature: 21.4, humidity: 45 } } },
    }),
    '21.4 °C · 45%',
  );
});
