import type { Device } from '@/bindings/Device';

export function isDeviceReadOnly(device: Device): boolean {
  if (!('Controllable' in device.data)) return true;
  const managed = device.data.Controllable.managed;
  return managed === 'FullReadOnly' || managed === 'UnmanagedReadOnly';
}

export function supportsDeviceBrightness(device: Device): boolean {
  if (!('Controllable' in device.data)) return false;
  // Support is supplied by the server and survives an off scene's null value.
  return device.data.Controllable.capabilities.brightness === true;
}
