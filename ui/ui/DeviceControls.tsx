import { DeviceColorTabs, colorToDeviceHs } from '@/ui/DeviceColorTabs';
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
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;

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
    setState(device, persist, power, undefined, brightness, undefined, color);
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
    <div className="dashboard-device-row flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
      <button
        className="dashboard-device-adjust flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <span className="dashboard-device-label min-w-0 flex-1">
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
        <SlidersHorizontal className="dashboard-device-settings size-4 shrink-0 text-muted-foreground" />
      </button>
      <Button
        variant={active ? 'secondary' : 'outline'}
        size="icon"
        className="dashboard-device-power"
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

/**
 * Single icon button toggling every controllable device in a group at once.
 * Used by room cards where the full quick controls are too tall; it mirrors
 * the aggregate On/Off buttons: all on turns everything off, otherwise
 * everything on.
 */
export function DevicePowerToggle({
  devices,
  label,
  className,
}: {
  devices: Device[];
  label?: string;
  className?: string;
}) {
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const controllable = devices.filter(
    (device) => 'Controllable' in device.data && !isDeviceReadOnly(device),
  );
  if (controllable.length === 0) return null;
  const allOn = controllable.every((device) => getPower(device.data));
  return (
    <Button
      variant={allOn ? 'secondary' : 'outline'}
      size="icon"
      className={className}
      aria-label={`Turn ${label ?? 'all devices'} ${allOn ? 'off' : 'on'}`}
      aria-pressed={allOn}
      disabled={!connected}
      onClick={() => controllable.forEach((device) => setState(device, !allOn))}
    >
      <Power />
    </Button>
  );
}

export function DeviceQuickControls({
  devices,
  compact = false,
  showColorTabs = true,
  showExactBrightness = false,
}: {
  devices: Device[];
  compact?: boolean;
  showColorTabs?: boolean;
  showExactBrightness?: boolean;
}) {
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [draft, setDraft] = useState<number | null>(null);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null,
  );
  const [typedBrightness, setTypedBrightness] = useState<string | null>(null);
  const [brightnessOutcome, setBrightnessOutcome] = useState<
    'reported' | 'timeout' | null
  >(null);
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
    dimmable.length > 0 &&
    dimmable.every((device) => {
      if (!('Controllable' in device.data)) return false;
      const data = device.data.Controllable;
      const report = data.last_report;
      if (
        !report ||
        report.retained ||
        report.received_at_ms < (data.requested_at_ms ?? 0) ||
        !report.matches_requested
      ) {
        return false;
      }
      return pendingBrightness === 0
        ? !report.state.power
        : report.state.power &&
            typeof data.state.brightness === 'number' &&
            Math.abs(data.state.brightness - pendingBrightness) < 0.005;
    });
  useEffect(() => {
    if (pendingBrightness === null) return;
    if (confirmed) {
      setBrightnessOutcome('reported');
      setDraft(null);
      setPendingBrightness(null);
      return;
    }
    // Keep the released thumb in place while the device catches up, but
    // return to reported state if confirmation never arrives.
    const timeout = setTimeout(() => {
      setDraft(null);
      setPendingBrightness(null);
      setBrightnessOutcome('timeout');
    }, 10000);
    return () => clearTimeout(timeout);
  }, [pendingBrightness, confirmed]);
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
          {showExactBrightness ? (
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="grid min-w-28 gap-1 text-sm">
                <span className="text-muted-foreground">
                  Exact brightness (%)
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 tabular-nums"
                  value={typedBrightness ?? String(brightness)}
                  disabled={!connected}
                  onChange={(event) => setTypedBrightness(event.target.value)}
                />
              </label>
              <Button
                className="min-h-11"
                disabled={
                  !connected ||
                  typedBrightness === null ||
                  typedBrightness.trim() === '' ||
                  !Number.isFinite(Number(typedBrightness)) ||
                  Number(typedBrightness) < 0 ||
                  Number(typedBrightness) > 100
                }
                onClick={() => {
                  const value = Number(typedBrightness);
                  setBrightnessOutcome(null);
                  dimmable.forEach((device) =>
                    setState(device, value > 0, value / 100),
                  );
                  setDraft(value);
                  setPendingBrightness(value / 100);
                  setTypedBrightness(null);
                }}
              >
                Send brightness
              </Button>
            </div>
          ) : null}
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
              setBrightnessOutcome(null);
              setPendingBrightness(null);
              setDraft(value);
              if (showExactBrightness) setTypedBrightness(String(value));
            }}
            onValueCommit={([value]) => {
              dimmable.forEach((device) =>
                setState(device, value > 0, value / 100),
              );
              setDraft(value);
              setPendingBrightness(value / 100);
              if (showExactBrightness) setTypedBrightness(null);
            }}
          />
          {pendingBrightness !== null || brightnessOutcome ? (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {brightnessOutcome === 'reported'
                ? 'The latest integration report matches this brightness request.'
                : brightnessOutcome === 'timeout'
                  ? 'No fresh matching report arrived within 10 seconds. Requested state remains separate from the integration report.'
                  : 'Brightness request sent; waiting for a fresh integration report.'}
            </p>
          ) : null}
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
      {!compact && showColorTabs && (
        <DeviceColorTabs
          devices={devices}
          connected={connected}
          onChange={(device, color, colorBrightness) => {
            if ('Controllable' in device.data)
              setState(
                device,
                getPower(device.data),
                colorBrightness,
                colorToDeviceHs(color),
              );
          }}
          onNativeChange={setState}
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
