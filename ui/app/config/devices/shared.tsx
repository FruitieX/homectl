import type { Device } from '@/bindings/Device';
import { StatePreview } from '@/ui/settings/StatePreview';
import { getSensorDetails } from '@/lib/sensorInteraction';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useDevicesState } from '@/hooks/websocket';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { useMemo } from 'react';
export function deviceType(device: Device) {
  return 'Controllable' in device.data
    ? 'controllable'
    : 'Sensor' in device.data
      ? 'sensor'
      : 'other';
}
export function deviceSummary(device: Device) {
  if ('Controllable' in device.data) {
    const state = device.data.Controllable.state;
    return `${state.power ? 'On' : 'Off'}${state.power && state.brightness != null ? ` · ${Math.round(state.brightness * 100)}%` : ''}`;
  }
  const sensor = getSensorDetails(device);
  return sensor.kind === 'boolean'
    ? sensor.value
      ? 'On'
      : 'Off'
    : sensor.kind === 'number' || sensor.kind === 'text'
      ? String(sensor.value)
      : sensor.kind === 'state'
        ? 'Structured sensor value'
        : 'No value received';
}
export function DeviceStatePreview({ device }: { device: Device }) {
  if ('Sensor' in device.data && 'power' in device.data.Sensor)
    return <StatePreview {...device.data.Sensor} source="Sensor reading" />;
  return 'Controllable' in device.data ? (
    <StatePreview
      {...device.data.Controllable.state}
      source="Requested state"
    />
  ) : (
    <span
      className="grid size-[30px] shrink-0 place-items-center rounded-full bg-muted text-xs"
      aria-label="Sensor"
    >
      S
    </span>
  );
}
export function useSettingsDevices() {
  const api = useDevicesApi(),
    live = useDevicesState(),
    names = useDeviceDisplayNames();
  const devices = useMemo(
    () => Object.values({ ...api.devicesState, ...live }),
    [api.devicesState, live],
  );
  const labels = useMemo(
    () =>
      Object.fromEntries(
        names.data.map((row) => [row.device_key, row.display_name]),
      ),
    [names.data],
  );
  return {
    ...api,
    devices,
    label: (device: Device) => getDeviceDisplayLabel(device, labels),
    byKey: Object.fromEntries(
      devices.map((device) => [getDeviceKey(device), device]),
    ),
  };
}
