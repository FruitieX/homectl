import type { Device } from '../bindings/Device';

const UNKNOWN_SENSOR_PLACEHOLDER_VALUE = '__homectl_unknown_sensor__';

export type SensorInteractionKind =
  | 'auto'
  | 'boolean'
  | 'number'
  | 'text'
  | 'state'
  | 'on_off_buttons'
  | 'button_events'
  | 'hue_dimmer';

export type ResolvedSensorInteractionKind =
  Exclude<SensorInteractionKind, 'auto'> | 'unknown';

export interface DeviceSensorConfig {
  device_ref: string;
  interaction_kind: SensorInteractionKind | string;
  config: Record<string, unknown>;
}

export type SensorDetails =
  | { kind: 'boolean'; value: boolean; payload: { value: boolean } }
  | { kind: 'number'; value: number; payload: { value: number } }
  | { kind: 'text'; value: string; payload: { value: string } }
  | {
      kind: 'state';
      value: Record<string, unknown>;
      payload: Record<string, unknown>;
    }
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
  { value: 'button_events', label: 'Button events' },
  { value: 'hue_dimmer', label: 'Hue dimmer buttons' },
];

const DEFAULT_SENSOR_CONFIGS: Record<
  'on_off_buttons' | 'hue_dimmer' | 'button_events',
  Record<string, string>
> = {
  button_events: {
    single_value: 'single',
    double_value: 'double',
    hold_value: 'hold',
    off_value: 'off',
  },
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
  device: Pick<Device, 'integration_id' | 'id'>,
) => `${device.integration_id}/${device.id}`;

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
    if (value === UNKNOWN_SENSOR_PLACEHOLDER_VALUE) {
      return { kind: 'unknown', value: null, payload: sensorPayload };
    }
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
    case 'button_events':
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
    case 'button_events':
      return { ...DEFAULT_SENSOR_CONFIGS.button_events };
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

const inferTextInteractionKind = (
  value: string,
  observedValues: readonly unknown[],
): ResolvedSensorInteractionKind => {
  const normalized = value.trim().toLowerCase();
  if (
    [value, ...observedValues].some(
      (v) =>
        typeof v === 'string' &&
        /^(single|double|hold)$/.test(v.trim().toLowerCase()),
    )
  )
    return 'button_events';
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
  observedValues: readonly unknown[] = [],
): ResolvedSensorInteractionKind => {
  const sensor = getSensorDetails(device);
  switch (sensor.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'text':
      return inferTextInteractionKind(sensor.value, observedValues);
    case 'state':
      return 'state';
    default:
      return 'unknown';
  }
};

export const resolveSensorInteraction = (
  device: Device | null,
  savedConfig?: DeviceSensorConfig | null,
  observedValues: readonly unknown[] = [],
): {
  kind: ResolvedSensorInteractionKind;
  config: Record<string, string>;
  source: 'saved' | 'inferred';
} => {
  const savedKind = normalizeSensorInteractionKind(
    savedConfig?.interaction_kind,
  );
  if (savedKind !== 'auto') {
    return {
      kind: savedKind,
      config: normalizeSensorInteractionConfig(savedKind, savedConfig?.config),
      source: 'saved',
    };
  }

  const inferredKind = inferSensorInteractionKind(device, observedValues);
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
    case 'button_events':
      return 'Button events';
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

/** Saved mappings are authoritative; auto controls only offer observed values. */
export function getSensorEventButtons(
  interaction: ReturnType<typeof resolveSensorInteraction>,
  values: readonly unknown[],
): { label: string; value: string }[] {
  const labels: Record<string, string> = {
    single: 'Press',
    double: 'Double press',
    hold: 'Hold',
    off: 'Off',
    on: 'On',
  };
  if (interaction.kind === 'button_events' && interaction.source === 'saved')
    return ['single', 'double', 'hold', 'off']
      .map((key) => ({
        label: labels[key],
        value: interaction.config[`${key}_value`],
      }))
      .filter((button) => button.value !== '');
  if (interaction.kind !== 'button_events' && interaction.kind !== 'text')
    return [];
  const unique = [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
  // Keep familiar button events first, then exact values from this sensor's history.
  const order = Object.keys(labels);
  return unique
    .sort((a, b) => {
      const rank = (v: string) => {
        const i = order.indexOf(v.trim().toLowerCase());
        return i < 0 ? order.length : i;
      };
      return rank(a) - rank(b);
    })
    .slice(0, 12)
    .map((value) => ({
      label: labels[value.trim().toLowerCase()] ?? value,
      value,
    }));
}
