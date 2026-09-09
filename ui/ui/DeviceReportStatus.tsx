import {
  deviceReachability,
  reachabilityLabels,
} from '@/lib/deviceReachability';
import { DeviceEnabledToggle } from '@/ui/DeviceEnabledToggle';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import { DeviceHealth } from '@/ui/DeviceHealth';
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
    const lastHeard = Math.max(
      report && !report.retained ? report.received_at_ms : 0,
      data.availability?.observed_at_ms ?? 0,
    );
    const age =
      lastHeard > 0 ? Math.max(0, Math.floor((now - lastHeard) / 1000)) : null;
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
        health,
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
        cached: report?.retained,
      },
    ];
  });
  if (!reports.length) return null;
  const indicator =
    reports.find(
      (r) =>
        r.health === 'offline' ||
        r.health === 'stale' ||
        r.health === 'unknown',
    ) ??
    reports.find((r) => r.health === 'cached') ??
    reports.find((r) => r.health === 'disabled') ??
    reports[0];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-vaul-no-drag
          aria-label="Device reachability details"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DeviceHealth device={indicator.device} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-vaul-no-drag
        align="end"
        className="max-h-[min(60dvh,28rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3 text-sm font-normal"
      >
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.key}
              className="space-y-2 border-b border-border/60 pb-3 last:border-0 last:pb-0"
            >
              {reports.length > 1 && (
                <div className="break-words font-medium">{report.name}</div>
              )}
              <div className="flex items-center gap-2">
                <DeviceHealth device={report.device} />
                <span>{report.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {report.ageLabel}
                </span>
              </div>
              {report.value && (
                <div className="text-xs text-muted-foreground">
                  {report.cached ? 'Saved state' : 'Reported'}: {report.value}
                </div>
              )}
              {report.differs && (
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  Reported state differs from requested
                </div>
              )}
              <DeviceEnabledToggle device={report.device} />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
