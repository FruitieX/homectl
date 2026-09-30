import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from '../bindings/Device';
import {
  resolveSensorInteraction,
  getSensorEventButtons,
} from './sensorInteraction.ts';
const sensor = (value: unknown) =>
  ({
    id: 'button',
    name: 'Office button',
    integration_id: 'mqtt',
    data: { Sensor: { value } },
    raw: null,
  }) as Device;

test('observed button events keep controls stable when the current value is off or on', () => {
  for (const current of ['single', 'double', 'hold', 'off', 'on']) {
    const values = [current, 'off', 'hold', 'single', 'double'];
    const interaction = resolveSensorInteraction(sensor(current), null, values);
    assert.equal(interaction.kind, 'button_events');
    const buttons = getSensorEventButtons(interaction, values);
    assert.deepEqual(
      buttons.slice(0, 4).map((b) => b.label),
      ['Press', 'Double press', 'Hold', 'Off'],
    );
    assert.deepEqual(
      buttons.slice(0, 4).map((b) => b.value),
      ['single', 'double', 'hold', 'off'],
    );
  }
});
test('auto controls offer only exact observed values without inventing payloads', () => {
  const values = ['single', 'single', ' Custom Event ', false, 8];
  assert.deepEqual(
    getSensorEventButtons(resolveSensorInteraction(sensor('single')), values),
    [
      { label: 'Press', value: 'single' },
      { label: ' Custom Event ', value: ' Custom Event ' },
    ],
  );
});
test('saved button event mappings override history and permit hiding unused events', () => {
  const interaction = resolveSensorInteraction(
    sensor('double'),
    {
      device_ref: 'mqtt/button',
      interaction_kind: 'button_events',
      config: {
        single_value: 'press_1',
        hold_value: 'long_press',
        off_value: '',
      },
    },
    ['single', 'double', 'hold', 'off'],
  );
  assert.deepEqual(getSensorEventButtons(interaction, ['single']), [
    { label: 'Press', value: 'press_1' },
    { label: 'Double press', value: 'double' },
    { label: 'Hold', value: 'long_press' },
  ]);
  assert.equal(
    resolveSensorInteraction(sensor('single'), {
      device_ref: 'mqtt/button',
      interaction_kind: 'text',
      config: {},
    }).kind,
    'text',
  );
});
test('typed sensors and existing dimmer/on-off mappings keep their controls', () => {
  assert.equal(
    resolveSensorInteraction(sensor(false), null, ['single']).kind,
    'boolean',
  );
  assert.equal(
    resolveSensorInteraction(sensor(21.5), null, ['hold']).kind,
    'number',
  );
  assert.equal(resolveSensorInteraction(sensor('on_press')).kind, 'hue_dimmer');
  assert.equal(resolveSensorInteraction(sensor('off')).kind, 'on_off_buttons');
});
