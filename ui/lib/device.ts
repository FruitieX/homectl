import { Device } from '@/bindings/Device';
import { StateUpdate } from '@/bindings/StateUpdate';

export const getDeviceKey = (device: Device): string => {
  return `${device.integration_id}/${device.id}`;
};

export const findDevice = (
  state: StateUpdate,
  deviceKey: string,
): Device | undefined => {

  const device = ((state?.devices as Record<string, Device>) ?? {})[deviceKey];

  return device;
};
