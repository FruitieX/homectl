import {
  deviceReachability,
  reachabilityLabels,
} from '@/lib/deviceReachability';
import { DeviceEnabledToggle } from '@/ui/DeviceEnabledToggle';
import { useEffect, useState } from 'react';
import type { Device } from '@/bindings/Device';

// A bridge report may include cached/optimistic fields. Never call it hardware confirmation.
export function DeviceReportStatus({ devices }: { devices: Device[] }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const reports = devices.flatMap((device) => {
    if (!('Controllable' in device.data)) return [];
    const data = device.data.Controllable;
    const report = data.last_report;
    const health = deviceReachability(device, now);
    const label = reachabilityLabels[health];
    const age = report
      ? Math.max(0, Math.floor((now - report.received_at_ms) / 1000))
      : null;
    const ageLabel =
      age === null
        ? ''
        : age < 60
          ? 'just now'
          : age < 3600
            ? `${Math.floor(age / 60)}m ago`
            : `${Math.floor(age / 3600)}h ago`;
    const state = report?.state;
    const value = state
      ? `${state.power ? 'On' : 'Off'}${state.power && state.brightness !== null ? ` · ${Math.round(state.brightness * 100)}%` : ''}${state.power && state.color && 'ct' in state.color ? ` · ${state.color.ct} K` : ''}`
      : '';
    return [
      {
        device,
        differs:
          health !== 'disabled' &&
          report &&
          !report.retained &&
          report.received_at_ms >= (data.requested_at_ms ?? 0) &&
          !report.matches_requested,
        key: `${device.integration_id}/${device.id}`,
        name: device.name,
        label,
        ageLabel,
        value,
      },
    ];
  });
  if (!reports.length) return null;
  return (
    <details className="min-w-0 text-xs text-muted-foreground">
      <summary className="cursor-pointer py-1">
        {reports.length === 1
          ? `${reports[0].label}${reports[0].ageLabel ? ` · ${reports[0].ageLabel}` : ''}`
          : `${reports.filter((r) => r.label === 'Recently reachable').length}/${reports.length} recently reachable`}
      </summary>
      <div className="mt-1 space-y-1 rounded-lg bg-muted/30 p-2">
        {reports.map((report) => (
          <div
            key={report.key}
            className="flex flex-wrap justify-between gap-x-3 gap-y-1"
          >
            <span className="min-w-0 break-words">
              {reports.length > 1 ? `${report.name}: ` : ''}
              {report.value || report.label}
            </span>
            <span>
              {report.differs
                ? 'Reported state differs from requested'
                : report.label}{' '}
              {report.ageLabel && `· ${report.ageLabel}`}
              <DeviceEnabledToggle device={report.device} />
            </span>
          </div>
        ))}
        <p className="pt-1">
          Controls show requested state. Bridge reports may contain cached
          values.
        </p>
      </div>
    </details>
  );
}
