import type { Device } from '@/bindings/Device';

export type DeviceReachability =
  | 'online'
  | 'offline'
  | 'stale'
  | 'unknown'
  | 'disabled';
const RECENT_MS = 10 * 60 * 1000;

export function deviceReachability(
  device: Device,
  now = Date.now(),
): DeviceReachability {
  if (!('Controllable' in device.data)) return 'unknown';
  const data = device.data.Controllable;
  if (data.disabled) return 'disabled';
  const reportTime =
    data.last_report && !data.last_report.retained
      ? data.last_report.received_at_ms
      : 0;
  const availability = data.availability;
  if (
    availability &&
    !availability.online &&
    availability.observed_at_ms >= reportTime
  )
    return 'offline';
  const lastHeard = Math.max(
    reportTime,
    availability?.online ? availability.observed_at_ms : 0,
  );
  if (lastHeard > 0 && now - lastHeard <= RECENT_MS) return 'online';
  return lastHeard > 0 ? 'stale' : 'unknown';
}

export const reachabilityLabels: Record<DeviceReachability, string> = {
  online: 'Recently reachable',
  offline: 'Unreachable',
  stale: 'No recent response',
  unknown: 'Unreachable',
  disabled: 'Disabled',
};
