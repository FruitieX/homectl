import type { Device } from '@/bindings/Device';

export type DeviceReachability =
  'online' | 'offline' | 'stale' | 'unknown' | 'cached' | 'disabled';
const RECENT_MS = 10 * 60 * 1000;

type RequestedReportEvidence = {
  requested_at_ms?: number | null;
  last_report?: {
    received_at_ms: number;
    retained: boolean;
    matches_requested: boolean;
  } | null;
};

/** A recent, non-cached report after the latest request can show a mismatch. */
export function hasCurrentRequestedMismatch(
  device: RequestedReportEvidence,
  now = Date.now(),
): boolean {
  const report = device.last_report;
  if (
    !report ||
    report.retained ||
    report.matches_requested ||
    device.requested_at_ms === undefined ||
    device.requested_at_ms === null
  ) {
    return false;
  }
  const ageMs = now - report.received_at_ms;
  return (
    report.received_at_ms >= device.requested_at_ms &&
    ageMs >= 0 &&
    ageMs <= RECENT_MS
  );
}

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
  // An MQTT availability/birth topic is a liveness signal, not a periodic
  // state report. Keep the device online until its last-will offline message
  // (or another explicit availability update) says otherwise.
  if (availability?.online) return 'online';
  const lastHeard = reportTime;
  if (lastHeard > 0 && now - lastHeard <= RECENT_MS) return 'online';
  return lastHeard > 0 ? 'stale' : data.last_report ? 'cached' : 'unknown';
}

export const reachabilityLabels: Record<DeviceReachability, string> = {
  online: 'Online via MQTT status',
  offline: 'Bridge reports offline',
  stale: 'Last response over 10m ago',
  unknown: 'Waiting for first report',
  cached: 'Last known state only',
  disabled: 'Disabled',
};
