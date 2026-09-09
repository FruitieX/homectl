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
import { getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Button } from '@/ui/primitives/button';
import { Slider } from '@/ui/primitives/slider';

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
  const [temperatureDraft, setTemperatureDraft] = useState<number | null>(null);
  const [pendingTemperature, setPendingTemperature] = useState<number | null>(
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
  const temperatureDevices = controllable.filter(
    (device) =>
      'Controllable' in device.data &&
      device.data.Controllable.capabilities.ct !== null,
  );
  const temperatureRanges = temperatureDevices.flatMap((device) =>
    'Controllable' in device.data && device.data.Controllable.capabilities.ct
      ? [device.data.Controllable.capabilities.ct]
      : [],
  );
  const minTemperature = Math.max(
    ...temperatureRanges.map((range) => range.start),
  );
  const maxTemperature = Math.min(
    ...temperatureRanges.map((range) => range.end),
  );
  const temperatures = temperatureDevices.map((device) => {
    const color =
      'Controllable' in device.data
        ? device.data.Controllable.state.color
        : null;
    return color && 'ct' in color ? color.ct : null;
  });
  const temperatureMixed = temperatures.some(
    (value) => value !== temperatures[0],
  );
  const temperature =
    temperatureDraft ??
    temperatures.find((value) => value !== null) ??
    minTemperature;
  const temperatureConfirmed =
    pendingTemperature !== null &&
    temperatures.every(
      (value) => value !== null && Math.abs(value - pendingTemperature) <= 25,
    );
  useEffect(() => {
    if (pendingTemperature === null) return;
    if (temperatureConfirmed || !connected) {
      setTemperatureDraft(null);
      setPendingTemperature(null);
      return;
    }
    const timeout = setTimeout(() => {
      setTemperatureDraft(null);
      setPendingTemperature(null);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [pendingTemperature, temperatureConfirmed, connected]);
  const applyTemperature = (value: number) => {
    const clamped = Math.max(minTemperature, Math.min(maxTemperature, value));
    setTemperatureDraft(clamped);
    setPendingTemperature(clamped);
    temperatureDevices.forEach((device) =>
      setState(device, true, undefined, { ct: clamped }),
    );
  };
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
      setTemperatureDraft(null);
      setPendingTemperature(null);
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
  return (
    <div
      className={
        compact
          ? 'space-y-2'
          : 'space-y-4 rounded-xl border border-border bg-card p-4'
      }
    >
      <DeviceColorMode
        devices={devices}
        connected={connected}
        onChange={setState}
      />
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
      {!compact &&
        temperatureDevices.length > 0 &&
        minTemperature <= maxTemperature && (
          <div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>Color temperature</span>
              <span className="tabular-nums text-muted-foreground">
                {temperatureDraft === null && temperatureMixed
                  ? 'Mixed'
                  : temperatureDraft === null &&
                      temperatures.every((value) => value === null)
                    ? 'Color mode'
                    : `${Math.round(temperature)} K`}
              </span>
            </div>
            <Slider
              aria-label="Color temperature"
              className="min-h-11 [&>span:first-child]:bg-linear-to-r [&>span:first-child]:from-amber-300 [&>span:first-child]:via-stone-100 [&>span:first-child]:to-blue-200 [&>span:first-child>span]:bg-transparent"
              min={minTemperature}
              max={maxTemperature}
              step={1}
              value={[temperature]}
              disabled={!connected || minTemperature === maxTemperature}
              onValueChange={([value]) => {
                setPendingTemperature(null);
                setTemperatureDraft(value);
              }}
              onValueCommit={([value]) => applyTemperature(value)}
            />
            <div className="flex flex-wrap gap-2">
              {[
                { name: 'Warm', value: 2700 },
                { name: 'Neutral', value: 4000 },
                { name: 'Cool', value: 6500 },
              ]
                .filter(
                  ({ value }) =>
                    value >= minTemperature && value <= maxTemperature,
                )
                .map(({ name, value }) => (
                  <Button
                    key={value}
                    variant="outline"
                    className="flex-1"
                    disabled={!connected}
                    onClick={() => applyTemperature(value)}
                  >
                    {name}
                  </Button>
                ))}
            </div>
            {temperatureDevices.length !== controllable.length && (
              <p className="mt-1 text-sm text-muted-foreground">
                Applies to {temperatureDevices.length} lights with temperature
                control.
              </p>
            )}
          </div>
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
