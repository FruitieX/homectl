import { DeviceColorMode } from '@/ui/DeviceColorMode';
import {
  isDeviceReadOnly,
  supportsDeviceBrightness,
} from '@/lib/deviceCapabilities';
import { useCarHeaterModalOpenState } from '@/hooks/carHeaterModalState';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { createUuid } from '@/lib/uuid';
import { sendSceneCommand } from '@/lib/deviceCommands';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { Lightbulb, Power, SlidersHorizontal } from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import {
  previousDeviceScenesAtom,
  useSetDeviceState,
} from '@/hooks/useSetDeviceColor';
import {
  useConnectionStatus,
  useScenesState,
  useWebsocket,
} from '@/hooks/websocket';
import { getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Button } from '@/ui/primitives/button';
import { Slider } from '@/ui/primitives/slider';
import Color from 'color';

// Preserve the existing scene override mode when changing live controls.
export function useLiveDeviceControls() {
  const setState = useSetDeviceState();
  const scenes = useScenesState();
  return (
    device: Device,
    power: boolean,
    brightness?: number,
    color?: DeviceColor,
  ) => {
    if (!('Controllable' in device.data) || isDeviceReadOnly(device)) return;
    const sceneId = device.data.Controllable.scene_id;
    const persist = Boolean(
      sceneId &&
        scenes?.[sceneId]?.active_overrides.includes(getDeviceKey(device)),
    );
    // Omitted color/brightness preserve each device's own state and color mode.
    setState(device, persist, power, undefined, brightness, 0.25, color);
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
            {isDeviceReadOnly(device) ? 'Read-only · ' : ''}
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
        disabled={!connected || isDeviceReadOnly(device)}
        onClick={() => setState(device, !active)}
      >
        <Power />
      </Button>
    </div>
  );
}

export function DeviceQuickControls({
  devices,
  compact = false,
}: {
  devices: Device[];
  compact?: boolean;
}) {
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [draft, setDraft] = useState<number | null>(null);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null,
  );
  const scenes = useScenesState();
  const ws = useWebsocket();
  const previousScenes = useAtomValue(previousDeviceScenesAtom);
  const allControllable = devices.filter(
    (device) => 'Controllable' in device.data,
  );
  const controllable = allControllable.filter(
    (device) => !isDeviceReadOnly(device),
  );
  const readonlyCount = allControllable.length - controllable.length;
  const dimmable = controllable.filter(supportsDeviceBrightness);
  const restorable = controllable.filter((device) => {
    const id = previousScenes[getDeviceKey(device)];
    return (
      'Controllable' in device.data &&
      !device.data.Controllable.scene_id &&
      id &&
      scenes?.[id]?.devices[getDeviceKey(device)]
    );
  });
  const restoreScenes = async () => {
    if (!ws) return;
    const targets = new Map<string, string[]>();
    for (const device of restorable) {
      const key = getDeviceKey(device);
      const id = previousScenes[key];
      targets.set(id, [...(targets.get(id) ?? []), key]);
    }
    try {
      await Promise.all(
        [...targets].map(([scene_id, device_keys]) =>
          sendSceneCommand(ws, {
            request_id: createUuid(),
            scene_id,
            device_keys,
            group_keys: null,
            use_scene_transition: true,
            transition: null,
          }),
        ),
      );
      setDraft(null);
      setPendingBrightness(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not restore scenes.',
      );
    }
  };
  const brightnessUnset = dimmable.every(
    (device) =>
      'Controllable' in device.data &&
      device.data.Controllable.state.brightness === null,
  );
  const values = dimmable.map((device) =>
    'Controllable' in device.data
      ? (device.data.Controllable.state.brightness ?? 1)
      : 0,
  );
  const mixed = values.some((value) => value !== values[0]);
  const confirmed =
    pendingBrightness !== null &&
    values.length > 0 &&
    values.every((value) => Math.round(value * 100) === pendingBrightness);
  useEffect(() => {
    if (pendingBrightness === null) return;
    if (confirmed || !connected) {
      setDraft(null);
      setPendingBrightness(null);
      return;
    }
    // Keep the released thumb in place while the device catches up, but
    // return to reported state if confirmation never arrives.
    const timeout = setTimeout(() => {
      setDraft(null);
      setPendingBrightness(null);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [pendingBrightness, confirmed, connected]);
  const onCount = controllable.filter((device) => getPower(device.data)).length;
  if (controllable.length === 0)
    return readonlyCount > 0 ? (
      <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        Devices are disabled or read-only. Live controls are unavailable.
      </p>
    ) : null;
  const brightness = draft ?? Math.round((values[0] ?? 0) * 100);
  const brightnessColor = dimmable[0]
    ? getColor(dimmable[0].data)
    : Color('#8aa7b8');
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {controllable.length === 1
            ? 'Power'
            : `${onCount} of ${controllable.length} on`}
        </span>
        <div className="flex gap-2">
          <Button
            variant={onCount === controllable.length ? 'secondary' : 'outline'}
            aria-pressed={onCount === controllable.length}
            disabled={!connected}
            onClick={() =>
              controllable.forEach((device) => setState(device, true))
            }
          >
            On
          </Button>
          <Button
            variant={onCount === 0 ? 'secondary' : 'outline'}
            aria-pressed={onCount === 0}
            disabled={!connected}
            onClick={() =>
              controllable.forEach((device) => setState(device, false))
            }
          >
            Off
          </Button>
        </div>
      </div>
      {readonlyCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {readonlyCount} disabled or read-only devices excluded from controls.
        </p>
      )}
      {!compact && dimmable.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span>Brightness</span>
            <span className="tabular-nums text-muted-foreground">
              {draft === null && brightnessUnset
                ? 'Not set'
                : mixed && draft === null
                  ? 'Mixed'
                  : `${brightness}%`}
            </span>
          </div>
          <Slider
            aria-label="Brightness"
            className="min-h-11"
            rangeClassName="bg-transparent"
            trackStyle={{
              backgroundImage: `linear-gradient(to right, #11161a, ${brightnessColor.value(100).hex()})`,
            }}
            value={[brightness]}
            min={0}
            max={100}
            step={1}
            disabled={!connected}
            onValueChange={([value]) => {
              setPendingBrightness(null);
              setDraft(value);
            }}
            onValueCommit={([value]) => {
              dimmable.forEach((device) =>
                setState(device, value > 0, value / 100),
              );
              setDraft(value);
              setPendingBrightness(value);
            }}
          />
          {dimmable.length !== controllable.length && (
            <p className="text-sm text-muted-foreground">
              Applies to {dimmable.length} devices with brightness control.
            </p>
          )}
          {dimmable.length > 1 && (
            <div className="mt-2 flex gap-2">
              {[-1, 1].map((direction) => (
                <Button
                  key={direction}
                  variant="outline"
                  className="flex-1"
                  disabled={!connected}
                  onClick={() =>
                    dimmable.forEach((device) => {
                      if (!('Controllable' in device.data)) return;
                      const value = Math.max(
                        0,
                        Math.min(
                          1,
                          (device.data.Controllable.state.brightness ?? 1) *
                            (direction < 0 ? 0.8 : 1.25),
                        ),
                      );
                      setState(device, getPower(device.data), value);
                    })
                  }
                >
                  {direction < 0 ? 'Dim' : 'Brighten'}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {!compact && (
        <DeviceColorMode
          devices={devices}
          connected={connected}
          onChange={setState}
        />
      )}
      {!compact && restorable.length > 0 && (
        <Button
          variant="outline"
          disabled={!connected}
          onClick={() => void restoreScenes()}
        >
          Restore{' '}
          {new Set(
            restorable.map((device) => previousScenes[getDeviceKey(device)]),
          ).size > 1
            ? 'scenes'
            : 'scene'}
        </Button>
      )}
    </div>
  );
}
