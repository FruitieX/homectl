import { useState } from 'react';
import { Activity, ChevronRight } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useDeviceSensorConfigs } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { getDeviceKey } from '@/lib/device';
import { getSensorDetails } from '@/lib/sensorInteraction';
import { devicePreviewState, LiveStatePreview } from '@/ui/LiveStatePreview';
import { SensorActionModal } from '@/ui/SensorActionModal';

function SensorDetails({
  device,
  label,
  close,
}: {
  device: Device;
  label: string;
  close: () => void;
}) {
  const { data: configs } = useDeviceSensorConfigs();
  return (
    <SensorActionModal
      device={device}
      label={label}
      open
      onClose={close}
      sensorConfig={
        configs.find((c) => c.device_ref === getDeviceKey(device)) ?? null
      }
    />
  );
}

export function LiveSensorRow({
  device,
  displayNames = {},
}: {
  device: Device;
  displayNames?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const label = getDeviceDisplayLabel(device, displayNames);
  const sensor = getSensorDetails(device);
  const state = devicePreviewState(device);
  const value =
    sensor.kind === 'unknown'
      ? 'Unknown'
      : sensor.kind === 'state'
        ? !state
          ? 'Unknown'
          : state.power
            ? 'On'
            : 'Off'
        : sensor.kind === 'boolean'
          ? sensor.value
            ? 'On'
            : 'Off'
          : String(sensor.value);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${label} sensor details`}
      >
        {state ? (
          <LiveStatePreview states={[state]} />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Activity className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-medium">
            {label}
          </strong>
          <span className="block truncate text-xs text-muted-foreground">
            {value}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <SensorDetails
          device={device}
          label={label}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
