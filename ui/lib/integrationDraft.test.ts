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
