import { DeviceColorTabs, colorToDeviceHs } from '@/ui/DeviceColorTabs';
import {
  isDeviceReadOnly,
  supportsDeviceBrightness,
} from '@/lib/deviceCapabilities';
import { useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';
import { createUuid } from '@/lib/uuid';
import { sendSceneCommand } from '@/lib/deviceCommands';
import { LoaderCircle, Power, SlidersHorizontal } from 'lucide-react';
import { LightQuickIndicator } from '@/ui/LightQuickIndicator';
import type { Device } from '@/bindings/Device';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useLiveDeviceControls } from '@/hooks/useLiveDeviceControls';
export { useLiveDeviceControls } from '@/hooks/useLiveDeviceControls';
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

export function DeviceRow({
  device,
  displayNames = {},
  presentation = 'sidepanel',
  inlineBrightness = false,
  plain = false,
}: {
  device: Device;
  displayNames?: Record<string, string>;
  presentation?: 'dialog' | 'sidepanel' | 'floorplan';
  inlineBrightness?: boolean;
  plain?: boolean;
}) {
  const modal = useDeviceModalState();
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [pending, setPending] = useState(false);
  const [brightnessDraft, setBrightnessDraft] = useState<number | null>(null);
  const label = getDeviceDisplayLabel(device, displayNames);
  const active = getPower(device.data);
  const state =
    'Controllable' in device.data ? device.data.Controllable.state : null;
  const disabled =
    'Controllable' in device.data && device.data.Controllable.disabled;
  if (!state) return null;
  return (
    <div
      className={`dashboard-device-row flex min-w-0 items-center gap-3 bg-card py-2 ${plain ? '' : 'rounded-lg border border-border px-3'}`}
    >
      <LightQuickIndicator
        device={device}
        displayNames={displayNames}
        onDetails={() => {
          modal.setState([getDeviceKey(device)]);
          modal.setPresentation(presentation);
          modal.setOpen(true);
        }}
      />
      <button
        className="dashboard-device-adjust flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Adjust ${label}`}
        onClick={() => {
          modal.setState([getDeviceKey(device)]);
          modal.setPresentation(presentation);
          modal.setOpen(true);
        }}
      >
        <span className="dashboard-device-label min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block text-sm text-muted-foreground">
            {disabled
              ? 'Disabled · last known '
              : isDeviceReadOnly(device)
                ? 'Read-only · '
                : ''}
            {active
              ? state.brightness === null
                ? 'On'
                : `On · ${Math.round(state.brightness * 100)}%`
              : 'Off'}
          </span>
        </span>
        <SlidersHorizontal className="dashboard-device-settings size-4 shrink-0 text-muted-foreground" />
      </button>
      {inlineBrightness && supportsDeviceBrightness(device) && (
        <div className="dashboard-device-brightness hidden w-36 shrink-0 items-center gap-2 md:flex">
          <Slider
            aria-label={`${label} brightness`}
            min={0}
            max={100}
            step={1}
            value={[
              brightnessDraft ?? Math.round((state.brightness ?? 1) * 100),
            ]}
            disabled={!connected || isDeviceReadOnly(device) || pending}
            onValueChange={(values) => setBrightnessDraft(values[0])}
            onValueCommit={async (values) => {
              setPending(true);
              try {
                await setState(device, true, values[0] / 100);
              } finally {
                setBrightnessDraft(null);
                setPending(false);
              }
            }}
          />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {brightnessDraft ?? Math.round((state.brightness ?? 1) * 100)}%
          </span>
        </div>
      )}
      <Button
        variant={active ? 'secondary' : 'outline'}
        size="icon"
        className="dashboard-device-power"
        aria-label={`Turn ${label} ${active ? 'off' : 'on'}`}
        aria-pressed={active}
        disabled={!connected || isDeviceReadOnly(device) || pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          await setState(device, !active);
          setPending(false);
        }}
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <Power />}
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
  const [pending, setPending] = useState(false);
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
      disabled={!connected || pending}
      aria-busy={pending}
      onClick={async () => {
        setPending(true);
        await Promise.all(
          controllable.map((device) => setState(device, !allOn)),
        );
        setPending(false);
      }}
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <Power />}
    </Button>
  );
}

export function DeviceQuickControls({
  devices,
  compact = false,
  showColorTabs = true,
}: {
  devices: Device[];
  compact?: boolean;
  showColorTabs?: boolean;
}) {
  const connected = useConnectionStatus() === 'connected';
  const setState = useLiveDeviceControls();
  const [draft, setDraft] = useState<number | null>(null);
  const [powerPending, setPowerPending] = useState(false);
  const brightnessGeneration = useRef(0);
  const [pendingBrightness, setPendingBrightness] = useState<number | null>(
    null,
  );
  const scenes = useScenesState();
  const ws = useWebsocket();
  const allControllable = devices.filter(
    (device) => 'Controllable' in device.data,
  );
  const controllable = allControllable.filter(
    (device) => !isDeviceReadOnly(device),
  );
  const readonlyCount = allControllable.length - controllable.length;
  const dimmable = controllable.filter(supportsDeviceBrightness);
  const restorable = controllable.filter((device) => {
    if (!('Controllable' in device.data)) return false;
    const { scene_id, scene_paused } = device.data.Controllable;
    return Boolean(
      scene_paused &&
      scene_id &&
      scenes?.[scene_id]?.devices[getDeviceKey(device)],
    );
  });
  const restoreScenes = async () => {
    if (!ws) return;
    const targets = new Map<string, string[]>();
    for (const device of restorable) {
      const key = getDeviceKey(device);
      const id =
        'Controllable' in device.data
          ? device.data.Controllable.scene_id
          : null;
      if (!id) continue;
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
  const setPower = async (power: boolean) => {
    setPowerPending(true);
    await Promise.all(controllable.map((device) => setState(device, power)));
    setPowerPending(false);
  };
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
            disabled={!connected || powerPending}
            aria-busy={powerPending}
            onClick={() => void setPower(true)}
          >
            On
          </Button>
          <Button
            variant={onCount === 0 ? 'secondary' : 'outline'}
            aria-pressed={onCount === 0}
            disabled={!connected || powerPending}
            aria-busy={powerPending}
            onClick={() => void setPower(false)}
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
              brightnessGeneration.current++;
              setPendingBrightness(null);
              setDraft(value);
            }}
            onValueCommit={async ([value]) => {
              const generation = ++brightnessGeneration.current;
              setDraft(value);
              setPendingBrightness(value);
              const results = await Promise.all(
                dimmable.map((device) =>
                  setState(device, value > 0, value / 100),
                ),
              );
              if (
                results.some((applied) => !applied) &&
                brightnessGeneration.current === generation
              ) {
                setDraft(null);
                setPendingBrightness(null);
              }
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
      {restorable.length > 0 && (
        <Button
          variant="outline"
          disabled={!connected}
          onClick={() => void restoreScenes()}
        >
          Restore{' '}
          {new Set(
            restorable.map((device) =>
              'Controllable' in device.data
                ? device.data.Controllable.scene_id
                : null,
            ),
          ).size > 1
            ? 'scenes'
            : 'scene'}
        </Button>
      )}
    </div>
  );
}
