import { Device } from '@/bindings/Device';

type DeviceLabelSource = Pick<Device, 'id' | 'integration_id' | 'name'>;

export const getDefaultDeviceLabel = (device: Pick<Device, 'id' | 'name'>) => {
  const trimmedName = device.name.trim();
  return trimmedName.length > 0 ? trimmedName : device.id;
};

export const getDeviceDisplayLabel = (
  device: DeviceLabelSource,
  overrides: Record<string, string> = {},
) =>
  overrides[`${device.integration_id}/${device.id}`] ??
  getDefaultDeviceLabel(device);

export const getDeviceDisplayLabelFromKey = (
  deviceKey: string,
  fallbackLabel: string,
  overrides: Record<string, string> = {},
) => overrides[deviceKey] ?? fallbackLabel;

export const compareDeviceNames = (
  left: Pick<Device, 'id' | 'integration_id' | 'name'>,
  right: Pick<Device, 'id' | 'integration_id' | 'name'>,
) =>
  left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  }) ||
  `${left.integration_id}/${left.id}`.localeCompare(
    `${right.integration_id}/${right.id}`,
  );
