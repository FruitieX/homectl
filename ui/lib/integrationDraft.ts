import type {
  Integration,
  IntegrationConfigFieldSchema,
  IntegrationConfigSchema,
} from '../hooks/useConfig';
import type { FieldError } from './configSection.ts';
import { isDeviceColor } from './deviceColor.ts';
export const isNumericRange = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
export const readConfigPath = (config: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      config,
    );
export function writeConfigPath(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [key, ...rest] = path.split('.');
  const next = { ...config };
  if (rest.length) {
    const existing = Object.hasOwn(next, key) ? next[key] : undefined;
    Object.defineProperty(next, key, {
      value: writeConfigPath(
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        rest.join('.'),
        value,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else if (value === undefined) delete next[key];
  else
    Object.defineProperty(next, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return next;
}
export function integrationMode(config: Record<string, unknown>) {
  return typeof config.mode === 'string'
    ? config.mode
    : typeof config.zigbee2mqtt_base_topic === 'string' &&
        config.zigbee2mqtt_base_topic.trim()
      ? 'zigbee2mqtt'
      : 'generic';
}
export function integrationFieldVisible(
  field: IntegrationConfigFieldSchema,
  config: Record<string, unknown>,
) {
  if (!field.visible_when) return true;
  const { key, equals } = field.visible_when;
  const value =
    key === 'mode' ? integrationMode(config) : readConfigPath(config, key);
  return JSON.stringify(value) === JSON.stringify(equals);
}
export function validateIntegrationDraft(
  value: Integration,
  schema?: IntegrationConfigSchema,
): FieldError[] {
  const errors: FieldError[] = [];
  if (!value.id.trim())
    errors.push({ field: 'id', message: 'Choose an integration ID.' });
  for (const field of schema?.fields ?? []) {
    if (!integrationFieldVisible(field, value.config)) continue;
    const input = readConfigPath(value.config, field.key);
    if (
      field.required &&
      (input === undefined || input === null || input === '') &&
      !(field.key === 'mode' && schema?.plugin === 'mqtt') &&
      !(field.kind === 'password' && value.secret_fields?.includes(field.key))
    )
      errors.push({
        field: `config.${field.key}`,
        message: `Enter ${field.label.toLowerCase()}.`,
      });
    if (
      input !== undefined &&
      input !== null &&
      field.kind === 'number' &&
      (typeof input !== 'number' ||
        !Number.isFinite(input) ||
        (field.step === 1 && !Number.isInteger(input)) ||
        (field.min !== null && input < field.min) ||
        (field.max !== null && input > field.max))
    )
      errors.push({
        field: `config.${field.key}`,
        message: `Check ${field.label.toLowerCase()}${field.min !== null ? ' (minimum ' + field.min + ')' : ''}${field.max !== null ? ' (maximum ' + field.max + ')' : ''}.`,
      });
  }
  for (const field of ['brightness_range', 'transition_range']) {
    const range = value.config[field];
    if (
      range !== undefined &&
      range !== null &&
      (!isNumericRange(range) || range[0] >= range[1])
    )
      errors.push({
        field: `config.${field}`,
        message: `${field.replaceAll('_', ' ')} needs a minimum smaller than its maximum.`,
      });
  }
  if (value.plugin === 'mqtt' && integrationMode(value.config) === 'esphome') {
    const warm = value.config.esphome_warm_white_kelvin ?? 2700;
    const cold = value.config.esphome_cold_white_kelvin ?? 6500;
    if (typeof warm === 'number' && typeof cold === 'number' && warm >= cold)
      errors.push({
        field: 'config.esphome_warm_white_kelvin',
        message: 'Warm white must be lower than cold white (kelvin).',
      });
  }
  for (const key of ['sensor_value_fields', 'disabled_device_ids']) {
    const entries = value.config[key];
    if (
      entries != null &&
      (!Array.isArray(entries) ||
        entries.some(
          (entry) =>
            typeof entry !== 'string' ||
            (key === 'sensor_value_fields'
              ? entry !== '' &&
                (!entry.startsWith('/') || /~[^01]|~$/.test(entry))
              : !entry.trim()),
        ))
    )
      errors.push({
        field: `config.${key}`,
        message:
          key === 'sensor_value_fields'
            ? 'Use valid value paths such as /temperature, one per entry.'
            : 'Each disabled device needs a device ID.',
      });
  }
  for (const channel of ['brightness', 'saturation']) {
    const min = value.config[`min_${channel}`],
      max = value.config[`max_${channel}`];
    if (typeof min === 'number' && typeof max === 'number' && min > max)
      errors.push({
        field: `config.min_${channel}`,
        message: `Minimum ${channel} cannot exceed the maximum.`,
      });
  }
  const validateCapabilities = (raw: unknown, field: string) => {
    if (raw == null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({ field, message: 'Capabilities must be an object.' });
      return;
    }
    const capabilities = raw as Record<string, unknown>;
    for (const key of ['brightness', 'hs', 'xy', 'rgb']) {
      if (
        capabilities[key] !== undefined &&
        !(key === 'brightness' && capabilities[key] === null) &&
        typeof capabilities[key] !== 'boolean'
      )
        errors.push({
          field,
          message: `${key} support must be on, off or unspecified.`,
        });
    }
    const range = capabilities.ct;
    if (range != null) {
      const { start, end } = range as { start?: unknown; end?: unknown };
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        end > 65535 ||
        start <= 0 ||
        end <= start
      )
        errors.push({
          field,
          message:
            'Color temperature needs whole kelvin values from 1 to 65535, with the minimum below the maximum.',
        });
    }
  };
  validateCapabilities(
    value.config.capabilities_override,
    'config.capabilities_override',
  );
  if (value.plugin === 'dummy') {
    const devices = value.config.devices;
    const object = (raw: unknown): raw is Record<string, unknown> =>
      !!raw && typeof raw === 'object' && !Array.isArray(raw);
    const error = (message: string) =>
      errors.push({ field: 'config.devices', message });
    const validateState = (state: unknown, id: string) => {
      if (!object(state) || typeof state.power !== 'boolean') {
        error(`${id}: initial light state needs an on/off power value.`);
        return;
      }
      for (const key of ['brightness', 'transition']) {
        const input = state[key];
        if (
          input != null &&
          (typeof input !== 'number' ||
            !Number.isFinite(input) ||
            input < 0 ||
            (key === 'brightness' && input > 1))
        )
          error(
            `${id}: initial ${key} must be ${key === 'brightness' ? 'between 0 and 1' : 'a non-negative number'}.`,
          );
      }
      if (state.color != null && !isDeviceColor(state.color))
        error(
          `${id}: initial color needs valid color fields or must be removed.`,
        );
    };
    if (!object(devices))
      error('Dummy devices must be an object keyed by device ID.');
    else
      for (const [id, device] of Object.entries(devices)) {
        if (
          !id.trim() ||
          !object(device) ||
          typeof device.name !== 'string' ||
          !device.name.trim()
        ) {
          error('Each dummy device needs an ID and a name.');
          continue;
        }
        const initial = device.init_state;
        if (initial == null) continue;
        if (!object(initial) || Object.keys(initial).length !== 1) {
          error(`${id}: choose a recognized initial device type.`);
          continue;
        }
        if (Object.hasOwn(initial, 'Controllable')) {
          const control = initial.Controllable;
          if (!object(control)) {
            error(`${id}: initial control fields must be an object.`);
            continue;
          }
          validateState(control.state, id);
          if (control.capabilities === null)
            error(`${id}: capabilities must be an object or omitted.`);
          else validateCapabilities(control.capabilities, 'config.devices');
        } else if (Object.hasOwn(initial, 'Sensor')) {
          const sensor = initial.Sensor;
          if (!object(sensor)) {
            error(`${id}: sensor reading must be an object.`);
            continue;
          }
          // Match Rust's untagged SensorDevice order: boolean, text, number, color.
          if (
            typeof sensor.value === 'boolean' ||
            typeof sensor.value === 'string'
          )
            continue;
          if (typeof sensor.value === 'number' && Number.isFinite(sensor.value))
            continue;
          validateState(sensor, id);
        } else error(`${id}: choose a recognized initial device type.`);
      }
  }
  return errors;
}
