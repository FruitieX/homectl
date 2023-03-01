import { Device } from '@/bindings/Device';

export const getDeviceKey = (device: Device): string => {
  return `${device.integration_id}/${device.id}`;
};
