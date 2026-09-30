import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from '../bindings/Device';
import { getSensorMarkerKind } from './sensorMarker.ts';

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
