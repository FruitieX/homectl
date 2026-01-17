import { Device } from '@/bindings/Device';

export type SensorInteractionKind =
  | 'auto'
  | 'boolean'
  | 'number'
  | 'text'
  | 'state'
  | 'on_off_buttons'
  | 'hue_dimmer';

export type ResolvedSensorInteractionKind = Exclude<SensorInteractionKind, 'auto'> | 'unknown';

export interface DeviceSensorConfig {
  device_ref: string;
  interaction_kind: SensorInteractionKind | string;
  config: Record<string, unknown>;
}

export type SensorDetails =
  | { kind: 'boolean'; value: boolean; payload: { value: boolean } }
  | { kind: 'number'; value: number; payload: { value: number } }
  | { kind: 'text'; value: string; payload: { value: string } }
  | { kind: 'state'; value: Record<string, unknown>; payload: Record<string, unknown> }
  | { kind: 'unknown'; value: unknown; payload: unknown };

export const SENSOR_INTERACTION_OPTIONS: Array<{
  value: SensorInteractionKind;
  label: string;
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'boolean', label: 'Boolean input' },
  { value: 'number', label: 'Number input' },
  { value: 'text', label: 'Text input' },
  { value: 'state', label: 'State patcher' },
  { value: 'on_off_buttons', label: 'On / Off buttons' },
  { value: 'hue_dimmer', label: 'Hue dimmer buttons' },
];

const DEFAULT_SENSOR_CONFIGS: Record<
  'on_off_buttons' | 'hue_dimmer',
  Record<string, string>
> = {
  on_off_buttons: {
    on_value: 'on',
    off_value: 'off',
  },
  hue_dimmer: {
    on_value: 'on_press',
    up_value: 'up_press',
    down_value: 'down_press',
    off_value: 'off_press',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getSensorConfigRef = (
  device: Pick<Device, 'integration_id' | 'name' | 'id'>,
) => `${device.integration_id}/${device.name.trim() || device.id}`;

export const stringifySensorPayload = (payload: unknown) => {
  if (payload === undefined) {
    return '{}';
  }

  return JSON.stringify(payload, null, 2);
};

export const getSensorDetails = (device: Device | null): SensorDetails => {
  if (!device || !('Sensor' in device.data)) {
    return { kind: 'unknown', value: null, payload: null };
  }

  const sensorPayload = device.data.Sensor;
  if (isRecord(sensorPayload) && 'value' in sensorPayload) {
    const value = sensorPayload.value;
    if (typeof value === 'boolean') {
      return { kind: 'boolean', value, payload: { value } };
    }
    if (typeof value === 'number') {
      return { kind: 'number', value, payload: { value } };
    }
    if (typeof value === 'string') {
      return { kind: 'text', value, payload: { value } };
    }
  }

  if (isRecord(sensorPayload)) {
    return { kind: 'state', value: sensorPayload, payload: sensorPayload };
  }

  return { kind: 'unknown', value: sensorPayload, payload: sensorPayload };
};

export const normalizeSensorInteractionKind = (
  kind: string | null | undefined,
): SensorInteractionKind => {
  switch (kind) {
    case 'boolean':
    case 'number':
    case 'text':
    case 'state':
    case 'on_off_buttons':
    case 'hue_dimmer':
      return kind;
    default:
      return 'auto';
  }
};

export const getDefaultSensorInteractionConfig = (
  kind: SensorInteractionKind | ResolvedSensorInteractionKind,
): Record<string, string> => {
  switch (kind) {
    case 'on_off_buttons':
      return { ...DEFAULT_SENSOR_CONFIGS.on_off_buttons };
    case 'hue_dimmer':
      return { ...DEFAULT_SENSOR_CONFIGS.hue_dimmer };
    default:
      return {};
  }
};

export const normalizeSensorInteractionConfig = (
  kind: SensorInteractionKind | ResolvedSensorInteractionKind,
  config: Record<string, unknown> | null | undefined,
): Record<string, string> => {
  const baseConfig = getDefaultSensorInteractionConfig(kind);
  if (!isRecord(config)) {
    return baseConfig;
  }

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      baseConfig[key] = value;
    }
  }

  return baseConfig;
};

const inferTextInteractionKind = (value: string): ResolvedSensorInteractionKind => {
  const normalized = value.trim().toLowerCase();
  if (/^(on_press|off_press|up_press|down_press)(_.+)?$/.test(normalized)) {
    return 'hue_dimmer';
  }
  if (/^(on|off)$/.test(normalized)) {
    return 'on_off_buttons';
  }
  return 'text';
};

export const inferSensorInteractionKind = (
  device: Device | null,
): ResolvedSensorInteractionKind => {
  const sensor = getSensorDetails(device);
  switch (sensor.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'text':
      return inferTextInteractionKind(sensor.value);
    case 'state':
      return 'state';
    default:
      return 'unknown';
  }
};

export const resolveSensorInteraction = (
  device: Device | null,
  savedConfig?: DeviceSensorConfig | null,
): {
  kind: ResolvedSensorInteractionKind;
  config: Record<string, string>;
  source: 'saved' | 'inferred';
} => {
  const savedKind = normalizeSensorInteractionKind(savedConfig?.interaction_kind);
  if (savedKind !== 'auto') {
    return {
      kind: savedKind,
      config: normalizeSensorInteractionConfig(savedKind, savedConfig?.config),
      source: 'saved',
    };
  }

  const inferredKind = inferSensorInteractionKind(device);
  return {
    kind: inferredKind,
    config: normalizeSensorInteractionConfig(inferredKind, savedConfig?.config),
    source: 'inferred',
  };
};

export const getSensorInteractionLabel = (
  kind: SensorInteractionKind | ResolvedSensorInteractionKind,
) => {
  switch (kind) {
    case 'boolean':
      return 'Boolean input';
    case 'number':
      return 'Number input';
    case 'text':
      return 'Text input';
    case 'state':
      return 'State patcher';
    case 'on_off_buttons':
      return 'On / Off buttons';
    case 'hue_dimmer':
      return 'Hue dimmer';
    case 'unknown':
      return 'Advanced JSON only';
    default:
      return 'Auto';
  }
};

export const getSensorButtonValue = (
  kind: ResolvedSensorInteractionKind,
  button: 'on' | 'off' | 'up' | 'down',
  config: Record<string, string>,
) => normalizeSensorInteractionConfig(kind, config)[`${button}_value`] ?? '';