import type { Device } from '../bindings/Device';
import {
  resolveSensorInteraction,
  type DeviceSensorConfig,
} from './sensorInteraction.ts';

/** Shared 24 px line glyphs for the map, editor and room previews. */
export const sensorMarkerPaths = {
  boolean: [
    'M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6Z',
    'M8 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z',
  ],
  boolean_on: [
    'M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6Z',
    'M16 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z',
  ],
  power: ['M12 3v8', 'M6.4 6.4a8 8 0 1 0 11.2 0'],
  button: [
    'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16Z',
    'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z',
  ],
  dimmer: [
    'M5 4v5m0 4v7M12 4v9m0 4v3M19 4v2m0 4v10',
    'M3 9h4v4H3ZM10 13h4v4h-4ZM17 6h4v4h-4Z',
  ],
  number: [
    'M4 19a10 10 0 1 1 16 0Z',
    'M12 14l4-5M5 13h1M8 6l1 1M16 6l-1 1M18 13h1',
  ],
  text: ['M4 4h16v13H9l-5 4Z', 'M8 8h8M8 12h5'],
  state: [
    'M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 2-5c-1-1 0-3 2-3h2c3 0 2-10-7-10Z',
    'M7 7a1 1 0 1 0 0 2a1 1 0 0 0 0-2ZM12 5a1 1 0 1 0 0 2a1 1 0 0 0 0-2ZM17 7a1 1 0 1 0 0 2a1 1 0 0 0 0-2ZM6 12a1 1 0 1 0 0 2a1 1 0 0 0 0-2Z',
  ],
  unknown: [
    'M12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z',
    'M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  ],
} as const;
export type SensorMarkerKind = keyof typeof sensorMarkerPaths;

export function getSensorMarkerKind(
  device: Device,
  config?: DeviceSensorConfig | null,
): SensorMarkerKind {
  switch (resolveSensorInteraction(device, config).kind) {
    case 'on_off_buttons':
      return 'power';
    case 'button_events':
      return 'button';
    case 'hue_dimmer':
      return 'dimmer';
    case 'boolean':
      return 'Sensor' in device.data &&
        'value' in device.data.Sensor &&
        device.data.Sensor.value === true
        ? 'boolean_on'
        : 'boolean';
    case 'number':
      return 'number';
    case 'text':
      return 'text';
    case 'state':
      return 'state';
    default:
      return 'unknown';
  }
}

export function sensorMarkerSvg(kind: SensorMarkerKind) {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d7eee6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sensorMarkerPaths[kind].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}
