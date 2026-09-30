import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  integrationFieldVisible,
  integrationMode,
  readConfigPath,
  writeConfigPath,
  validateIntegrationDraft,
} from './integrationDraft.ts';
import type { IntegrationConfigFieldSchema } from '../hooks/useConfig';
const field: IntegrationConfigFieldSchema = {
  key: 'topic',
  label: 'State topic',
  kind: 'text',
  required: true,
  description: null,
  placeholder: null,
  options: [],
  default_value: null,
  min: null,
  max: null,
  step: null,
  help_text: null,
  section: null,
  advanced: false,
  visible_when: { key: 'mode', equals: 'generic' },
};
test('editing a nested field preserves omission, false, zero, ordered collections and unknown siblings', () => {
  const config = {
    outbound_device_updates: { future: 'keep' },
    sensor_value_fields: ['/temperature', '/humidity'],
    future: { id: 'same', value: null },
  };
  const changed = writeConfigPath(
    config,
    'outbound_device_updates.min_interval_ms',
    0,
  );
  assert.deepEqual(changed, {
    ...config,
    outbound_device_updates: { future: 'keep', min_interval_ms: 0 },
  });
  assert.deepEqual(config.outbound_device_updates, { future: 'keep' });
  assert.deepEqual(
    writeConfigPath(
      changed,
      'outbound_device_updates.min_interval_ms',
      undefined,
    ),
    config,
  );
  assert.equal(
    readConfigPath(writeConfigPath(config, 'enabled', false), 'enabled'),
    false,
  );
});
test('legacy MQTT inference controls visibility without materializing an explicit mode', () => {
  const config = { zigbee2mqtt_base_topic: 'zigbee2mqtt' };
  assert.equal(integrationMode(config), 'zigbee2mqtt');
  assert.equal(integrationFieldVisible(field, config), false);
  assert.equal(integrationFieldVisible(field, { mode: 'generic' }), true);
  assert.deepEqual(config, { zigbee2mqtt_base_topic: 'zigbee2mqtt' });
});
test('nested extension names stay own properties without changing prototypes', () => {
  const changed = writeConfigPath({}, '__proto__.name', 'extension');
  assert.equal(Object.getPrototypeOf(changed), Object.prototype);
  assert.equal(readConfigPath(changed, '__proto__.name'), 'extension');
  assert.equal(Object.hasOwn({}, 'name'), false);
});
test('capability temperature ranges use positive ascending Kelvin values', () => {
  const row = {
    id: 'mqtt',
    plugin: 'mqtt',
    enabled: false,
    config: {
      capabilities_override: {
        ct: { start: 2000, end: 6500 },
        brightness: false,
      },
    },
  };
  assert.deepEqual(validateIntegrationDraft(row), []);
  assert.equal(
    validateIntegrationDraft({
      ...row,
      config: { capabilities_override: { ct: { start: 6500, end: 2000 } } },
    })[0].field,
    'config.capabilities_override',
  );
  assert.equal(
    validateIntegrationDraft({
      ...row,
      config: { capabilities_override: { ct: { start: 0, end: 6500 } } },
    })[0].field,
    'config.capabilities_override',
  );
});
test('validation checks all sensor pointers, range bounds and integer ports', () => {
  const row = {
    id: 'test',
    plugin: 'mqtt',
    enabled: false,
    config: {
      sensor_value_fields: ['/valid', '/invalid~'],
      brightness_range: [255, 0],
      port: 1883.5,
    },
  };
  const errors = validateIntegrationDraft(row, {
    plugin: 'mqtt',
    name: 'MQTT',
    description: '',
    fields: [
      {
        ...field,
        key: 'port',
        label: 'Port',
        kind: 'number',
        visible_when: null,
        step: 1,
        min: 1,
        max: 65535,
      },
    ],
  });
  assert.deepEqual(errors.map((error) => error.field).sort(), [
    'config.brightness_range',
    'config.port',
    'config.sensor_value_fields',
  ]);
  assert.deepEqual(
    validateIntegrationDraft({
      ...row,
      config: {
        sensor_value_fields: ['/a~1b', '/a~0b', ''],
        brightness_range: [0, 255],
      },
    }),
    [],
  );
});

test('capability validation distinguishes optional dimming from required booleans and u16 bounds', () => {
  const validate = (capabilities: unknown) =>
    validateIntegrationDraft({
      id: 'test',
      plugin: 'mqtt',
      enabled: false,
      config: { capabilities_override: capabilities },
    });
  for (const capabilities of [
    undefined,
    null,
    {},
    { brightness: null, hs: false, ct: null },
    { ct: { start: 1, end: 65535 } },
  ])
    assert.deepEqual(validate(capabilities), []);
  for (const capabilities of [
    { hs: null },
    { xy: null },
    { rgb: null },
    { ct: { start: 2000.5, end: 6500 } },
    { ct: { start: 2000, end: 65536 } },
    { ct: [] },
  ])
    assert.ok(validate(capabilities).length > 0, JSON.stringify(capabilities));
});

test('dummy initial readings support all sensor variants and retain false, zero, empty text and extensions', () => {
  const devices = {
    omitted: { name: 'Default' },
    nullable: { name: 'Default', init_state: null },
    boolean: {
      name: 'Boolean',
      init_state: { Sensor: { value: false, future: [0, null] } },
    },
    number: { name: 'Number', init_state: { Sensor: { value: 0 } } },
    negative: { name: 'Temperature', init_state: { Sensor: { value: -12.5 } } },
    text: { name: 'Text', init_state: { Sensor: { value: '' } } },
    color: {
      name: 'Color',
      init_state: {
        Sensor: { power: false, brightness: 0, color: null, transition: 0 },
      },
    },
    light: {
      name: 'Light',
      init_state: {
        Controllable: {
          state: { power: false },
          capabilities: { brightness: false, ct: null },
        },
      },
    },
  };
  const before = structuredClone(devices);
  assert.deepEqual(
    validateIntegrationDraft({
      id: 'test',
      plugin: 'dummy',
      enabled: false,
      config: { devices },
    }),
    [],
  );
  assert.deepEqual(devices, before);
  assert.deepEqual(
    validateIntegrationDraft({
      id: 'test',
      plugin: 'dummy',
      enabled: false,
      config: { devices: {} },
    }),
    [],
  );
});

test('ESPHome compares white endpoints using server defaults only in its active profile', () => {
  const validate = (config: Record<string, unknown>) =>
    validateIntegrationDraft({
      id: 'test',
      plugin: 'mqtt',
      enabled: false,
      config: { mode: 'esphome', ...config },
    });
  assert.deepEqual(validate({}), []);
  assert.deepEqual(
    validate({
      esphome_warm_white_kelvin: 2200,
      esphome_cold_white_kelvin: 7000,
    }),
    [],
  );
  assert.ok(validate({ esphome_warm_white_kelvin: 6500 }).length > 0);
  assert.ok(validate({ esphome_cold_white_kelvin: 2700 }).length > 0);
  assert.ok(
    validate({
      esphome_warm_white_kelvin: null,
      esphome_cold_white_kelvin: 2200,
    }).length > 0,
  );
  assert.deepEqual(
    validate({ mode: 'generic', esphome_warm_white_kelvin: 7000 }),
    [],
  );
});

test('malformed dummy collections and initial states stay invalid until explicitly repaired', () => {
  const validate = (devices: unknown) =>
    validateIntegrationDraft({
      id: 'test',
      plugin: 'dummy',
      enabled: false,
      config: { devices },
    });
  for (const devices of [
    undefined,
    null,
    [],
    [false],
    { bad: false },
    { bad: { name: '' } },
  ])
    assert.ok(validate(devices).length > 0);
  for (const init_state of [
    false,
    [],
    {},
    { Future: {} },
    { Sensor: null },
    { Sensor: { value: null } },
    { Sensor: { value: Infinity } },
    { Sensor: { power: false, brightness: 2 } },
    { Sensor: { power: false, color: true } },
    { Sensor: { power: false, color: { ct: 'warm' } } },
    { Controllable: { state: { power: false, color: [0, null] } } },
    { Controllable: { state: { power: false, color: { Future: {} } } } },
    { Controllable: { state: {} } },
    { Controllable: { state: { power: false }, capabilities: null } },
    { Sensor: { value: false }, Controllable: { state: { power: false } } },
  ])
    assert.ok(
      validate({ bad: { name: 'Repair me', init_state } }).length > 0,
      JSON.stringify(init_state),
    );
});
