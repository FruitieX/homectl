import { useCarHeaterModalOpenState } from '@/hooks/carHeaterModalState';
import { useState } from 'react';
import { Lightbulb, Power, SlidersHorizontal } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import { useConnectionStatus, useScenesState } from '@/hooks/websocket';
import { getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Button } from '@/ui/primitives/button';
import { Slider } from '@/ui/primitives/slider';

// Preserve the existing scene override mode when changing live controls.
export function useLiveDeviceControls() {
  const setState = useSetDeviceState();
  const scenes = useScenesState();
  return (device: Device, power: boolean, brightness?: number) => {
    if (!('Controllable' in device.data)) return;
    const sceneId = device.data.Controllable.scene_id;
    const persist = Boolean(
      sceneId &&
        scenes?.[sceneId]?.active_overrides.includes(getDeviceKey(device)),
    );
    // Omitted color/brightness preserve each device's own state and color mode.
    setState(device, persist, power, undefined, brightness, 0.25);
  };
}

export function DeviceRow({
  device,
  displayNames = {},
}: {
  device: Device;
  displayNames?: Record<string, string>;
}) {
  const modal = useDeviceModalState();
  const heater = useCarHeaterModalOpenState();
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const label = getDeviceDisplayLabel(device, displayNames);
  const active = getPower(device.data);
  const state =
    'Controllable' in device.data ? device.data.Controllable.state : null;
  if (!state) return null;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
      <button
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Adjust ${label}`}
        onClick={() => {
          if (getDeviceKey(device) === 'tuya_devices/bfe553b84e883ace37nvxw') {
            heater.setOpen(true);
            return;
          }
          modal.setState([getDeviceKey(device)]);
          modal.setPresentation('sidepanel');
          modal.setOpen(true);
        }}
      >
        <Lightbulb
          className={`size-5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block text-sm text-muted-foreground">
            {active
              ? state.brightness === null
                ? 'On'
                : `On · ${Math.round(state.brightness * 100)}%`
              : 'Off'}
          </span>
        </span>
        <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <Button
        variant={active ? 'secondary' : 'outline'}
        size="icon"
        aria-label={`Turn ${label} ${active ? 'off' : 'on'}`}
        aria-pressed={active}
        disabled={!connected}
        onClick={() => setState(device, !active)}
      >
        <Power />
      </Button>
    </div>
  );
}

export function DeviceQuickControls({ devices }: { devices: Device[] }) {
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [draft, setDraft] = useState<number | null>(null);
  const controllable = devices.filter(
    (device) => 'Controllable' in device.data,
  );
  // The API has no dimmable capability flag: only expose brightness where
  // the integration supplies a brightness value.
  const dimmable = controllable.filter(
    (device) =>
      'Controllable' in device.data &&
      device.data.Controllable.state.brightness !== null,
  );
  const values = dimmable.map((device) =>
    'Controllable' in device.data
      ? device.data.Controllable.state.brightness!
      : 0,
  );
  const mixed = values.some((value) => value !== values[0]);
  const onCount = controllable.filter((device) => getPower(device.data)).length;
  if (controllable.length === 0) return null;
  const brightness = draft ?? Math.round((values[0] ?? 0) * 100);
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {controllable.length === 1
            ? onCount
              ? 'On'
              : 'Off'
            : `${onCount} of ${controllable.length} on`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!connected}
            onClick={() =>
              controllable.forEach((device) => setState(device, true))
            }
          >
            On
          </Button>
          <Button
            variant="outline"
            disabled={!connected}
            onClick={() =>
              controllable.forEach((device) => setState(device, false))
            }
          >
            Off
          </Button>
        </div>
      </div>
      {dimmable.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span>Brightness</span>
            <span className="tabular-nums text-muted-foreground">
              {mixed && draft === null ? 'Mixed' : `${brightness}%`}
            </span>
          </div>
          <Slider
            aria-label="Brightness"
            className="min-h-11"
            value={[brightness]}
            min={0}
            max={100}
            step={1}
            disabled={!connected}
            onValueChange={([value]) => setDraft(value)}
            onValueCommit={([value]) => {
              dimmable.forEach((device) =>
                setState(device, value > 0, value / 100),
              );
              setDraft(null);
            }}
          />
          {dimmable.length !== controllable.length && (
            <p className="text-sm text-muted-foreground">
              Applies to {dimmable.length} devices with brightness control.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
