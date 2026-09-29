import type { Device } from '@/bindings/Device';
import type { DeviceHealth } from '@/bindings/DeviceHealth';

export type DeviceReachability =
  'online' | 'offline' | 'stale' | 'unknown' | 'cached' | 'disabled';

/** Map the shared evaluator to floorplan presentation. A quiet device does
 * not become stale according to a second, browser-only timeout. */
export function deviceReachability(
  device: Device,
  health?: DeviceHealth,
): DeviceReachability {
  if ('Controllable' in device.data && device.data.Controllable.disabled)
    return 'disabled';
  switch (health?.status) {
    case 'healthy':
      return 'online';
    case 'offline':
      return 'offline';
    case 'late':
    case 'error':
      return 'stale';
    case 'cached':
      return 'cached';
    case 'disabled':
      return 'disabled';
    default:
      return 'unknown';
  }
}

export const reachabilityLabels: Record<DeviceReachability, string> = {
  online: 'No reporting issues',
  offline: 'Reported offline',
  stale: 'Reporting needs attention',
  unknown: 'Health not confirmed',
  cached: 'Last known state only',
  disabled: 'Disabled',
};
