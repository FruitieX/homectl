import { useEffect, useId, useRef, useState } from 'react';
import {
  Palette,
  Power,
  SlidersHorizontal,
  Thermometer,
  X,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
} from 'lucide-react';
import type { Device } from '@/bindings/Device';
import { useConnectionStatus } from '@/hooks/websocket';
import { useLiveDeviceControls } from '@/hooks/useLiveDeviceControls';
import { useSceneRestore } from '@/hooks/useSceneRestore';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import {
  createLightAdjustmentQueue,
  quickLightSelection,
  ringBrightness,
  type LightHold,
  type LightAdjustment,
} from '@/lib/lightQuickAdjust';
import { getColor } from '@/lib/colors';
import { exceedsLongPressTolerance } from '@/lib/longPress';
import { Button } from './primitives/button';
import { QuickControlShell } from './QuickControlShell';

const SURFACE_SIZE = 268;
const COLOR_SIZE = 208;
const COLOR_CENTER = COLOR_SIZE / 2 - 4;
const COLOR_MIN_RADIUS = 42;
const COLOR_MAX_RADIUS = COLOR_CENTER - 8;
const BRIGHTNESS_WIDTH = 24;
const BRIGHTNESS_RADIUS = 119;
// Fit six 44 px touch targets plus gaps, without moving when Restore
// disappears, and the label/toolbar above and status below the ring.
const SURFACE_ORIGIN = { x: SURFACE_SIZE / 2, y: SURFACE_SIZE / 2 };
const SURFACE_REACH = { x: 154, top: 228, bottom: 146 };
/** One radial surface for map and row indicators, with coalesced live updates. */
export function LightQuickPopover({
  device: anchorDevice,
  devices,
  anchor,
  hold,
  onClose,
  onDetails,
  onSelect,
  displayNames = {},
}: {
  device: Device;
  devices?: Device[];
  anchor: { x: number; y: number };
  hold?: LightHold;
  onClose: () => void;
  onDetails: () => void;
  onSelect?: () => void;
  displayNames?: Record<string, string>;
}) {
  const helpId = useId();
  const setState = useLiveDeviceControls();
  const connected = useConnectionStatus() === 'connected';
  const targets = devices ?? [anchorDevice];
  const { canRestore, restoreLabel, restoring, restore } =
    useSceneRestore(targets);
  const selection = quickLightSelection(targets);
  const device =
    selection.writable.find(
      (target) =>
        target.id === anchorDevice.id &&
        target.integration_id === anchorDevice.integration_id,
    ) ??
    selection.writable[0] ??
    anchorDevice;
  const state =
    'Controllable' in device.data ? device.data.Controllable.state : null;
  const caps = selection.caps;
  const colored = Boolean(caps?.hs || caps?.xy || caps?.rgb);
  const dimmable = caps.brightness;
  const [mode, setMode] = useState<'hs' | 'ct'>(() =>
    state?.color && 'ct' in state.color && caps?.ct
      ? 'ct'
      : colored
        ? 'hs'
        : caps?.ct
          ? 'ct'
          : 'hs',
  );
  const [draft, setDraft] = useState<LightAdjustment | null>(null),
    [pending, setPending] = useState(false),
    [dragging, setDragging] = useState(false);
  const enabled = connected && selection.writable.length > 0 && !restoring;
  const surface = useRef<HTMLDivElement>(null);
  const draftRef = useRef<LightAdjustment | null>(null);
  const queue = useRef<ReturnType<typeof createLightAdjustmentQueue> | null>(
    null,
  );
  const color = getColor(
    'Controllable' in device.data && draft?.color
      ? {
          Controllable: {
            ...device.data.Controllable,
            state: { ...device.data.Controllable.state, color: draft.color },
          },
        }
      : device.data,
  );
  const selectedColor = draft?.color ?? state?.color;
  const hue =
    selectedColor && 'h' in selectedColor ? selectedColor.h : color.hue();
  const saturation =
    selectedColor && 's' in selectedColor
      ? selectedColor.s
      : color.saturationv() / 100;
  const temperature =
    selectedColor && 'ct' in selectedColor ? selectedColor.ct : 4000;
  const level = draft?.brightness ?? Math.round((state?.brightness ?? 1) * 100);
  const power = draft?.power ?? state?.power ?? false;
  const powerFill = color.desaturate(0.45);
  const powerPress = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
    suppressClick: boolean;
  }>({ x: 0, y: 0, suppressClick: false });
  const clearPowerHold = () => {
    clearTimeout(powerPress.current.timer);
    powerPress.current.timer = undefined;
  };
  useEffect(() => () => clearTimeout(powerPress.current.timer), []);
  const label = devices
    ? `${selection.writable.length} selected ${selection.writable.length === 1 ? 'light' : 'lights'}`
    : getDeviceDisplayLabel(device, displayNames);
  const mixed = selection.writable.some(
    (target) =>
      'Controllable' in target.data &&
      ((draft?.brightness === undefined &&
        target.data.Controllable.state.brightness !== state?.brightness) ||
        (draft?.color === undefined &&
          JSON.stringify(target.data.Controllable.state.color) !==
            JSON.stringify(state?.color)) ||
        (draft?.power === undefined &&
          target.data.Controllable.state.power !== state?.power)),
  );
  const latest = useRef({
    enabled,
    device,
    setState,
    power,
    onClose,
    mode,
    caps,
    dimmable,
    targets: selection.writable,
  });
  latest.current = {
    enabled,
    device,
    setState,
    power,
    onClose,
    mode,
    caps,
    dimmable,
    targets: selection.writable,
  };
  const resetDraft = () => {
    draftRef.current = null;
    setDraft(null);
  };
  useEffect(() => {
    const commands = createLightAdjustmentQueue({
      send: async (value) => {
        const results = await Promise.all(
          latest.current.targets.map((target) =>
            latest.current.setState(
              target,
              value.power ??
                ('Controllable' in target.data &&
                  target.data.Controllable.state.power),
              value.brightness === undefined
                ? undefined
                : value.brightness / 100,
              value.color,
            ),
          ),
        );
        return results.every(Boolean);
      },
      onBusy: setPending,
      onFailure: () => {
        draftRef.current = null;
        setDraft(null);
      },
    });
    queue.current = commands;
    return () => {
      commands.dispose();
      queue.current = null;
    };
  }, [device.integration_id, device.id]);
  useEffect(() => {
    if (!draft || !state || dragging || !queue.current?.idle) return;
    const confirmed = selection.writable.every((target) => {
      if (!('Controllable' in target.data)) return false;
      const reported = target.data.Controllable.state;
      const reportedRgb = getColor(target.data).rgb().array();
      const colorMatches =
        draft.color === undefined ||
        (draft.color &&
        'h' in draft.color &&
        reported.color &&
        'h' in reported.color
          ? Math.abs(((draft.color.h - reported.color.h + 540) % 360) - 180) <
              0.2 && Math.abs(draft.color.s - reported.color.s) < 0.002
          : color
              .rgb()
              .array()
              .every(
                (channel, index) =>
                  Math.abs(channel - reportedRgb[index]) < 0.5,
              ));
      return (
        (draft.power === undefined || draft.power === reported.power) &&
        (draft.brightness === undefined ||
          Math.abs(draft.brightness - (reported.brightness ?? 1) * 100) <
            0.1) &&
        colorMatches
      );
    });
    if (confirmed) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [draft, state, pending, dragging, color, device.data, selection.writable]);
  const adjust = (value: LightAdjustment, immediate = false) => {
    if (!latest.current.enabled) return;
    const next = { ...draftRef.current, ...value };
    if (value.brightness !== undefined && value.power === undefined)
      next.power = value.brightness > 0;
    if (JSON.stringify(next) !== JSON.stringify(draftRef.current)) {
      draftRef.current = next;
      setDraft(next);
      queue.current?.update(next);
    }
    if (immediate) queue.current?.flush();
  };
  const start = (
    pointerId: number,
    region: 'brightness' | 'color',
    initial?: PointerEvent,
    origin?: { x: number; y: number },
  ) => {
    setDragging(true);
    let value: LightAdjustment | null = null,
      previous: number | null = null;
    let movedFromHold = !origin;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !latest.current.enabled) return;
      if (!movedFromHold && origin) {
        if (!exceedsLongPressTolerance(origin, { x: e.clientX, y: e.clientY }))
          return;
        movedFromHold = true;
      }
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds?.width) return;
      // DOM coordinates include the opening animation and browser/UI scaling.
      const dx =
          ((e.clientX - bounds.left - bounds.width / 2) * SURFACE_SIZE) /
          bounds.width,
        dy =
          ((e.clientY - bounds.top - bounds.height / 2) * SURFACE_SIZE) /
          bounds.height,
        r = Math.hypot(dx, dy);
      // Touch jitter and travel back into the power hub are not color input.
      // In particular, they must never send zero saturation (white).
      if (region === 'color' && r <= COLOR_MIN_RADIUS) return;
      if (
        region === 'brightness' &&
        r < BRIGHTNESS_RADIUS - BRIGHTNESS_WIDTH / 2
      )
        return;
      e.preventDefault();
      if (region === 'brightness') {
        if (!latest.current.dimmable) return;
        let next = ringBrightness(dx, dy);
        if (previous !== null && Math.abs(next - previous) > 90)
          next = previous > 50 ? 100 : 0;
        previous = next;
        value = { brightness: next };
      } else if (latest.current.mode === 'ct' && latest.current.caps?.ct) {
        const range = latest.current.caps.ct;
        value = {
          color: {
            ct: Math.round(
              range.start +
                ((range.end - range.start) * ringBrightness(dx, dy)) / 100,
            ),
          },
        };
      } else {
        const capabilities = latest.current.caps;
        if (!(capabilities?.hs || capabilities?.xy || capabilities?.rgb))
          return;
        value = {
          color: {
            h: ringBrightness(dx, dy) * 3.6,
            s: Math.max(
              0,
              Math.min(
                1,
                (r - COLOR_MIN_RADIUS) / (COLOR_MAX_RADIUS - COLOR_MIN_RADIUS),
              ),
            ),
          },
        };
      }
      adjust(value);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (value && e.type !== 'pointercancel') move(e);
      cleanup();
      if (e.type === 'pointercancel') {
        queue.current?.cancel();
        resetDraft();
        return;
      }
      if (value) queue.current?.flush();
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) return;
      cleanup();
      queue.current?.cancel();
      resetDraft();
    };
    const cleanup = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('pointerdown', cancel);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('pointerdown', cancel);
    if (initial) move(initial);
    return cleanup;
  };
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    if (!hold) return;
    // The opening pointer stays a color gesture even outside the hue disk.
    // Brightness always needs a fresh pointerdown on its own ring.
    const cleanup = start(
      hold.pointerId,
      'color',
      undefined,
      hold.origin ?? hold,
    );
    return cleanup;
  }, [hold]);
  if (!state) return null;
  const angle = (hue * Math.PI) / 180 - Math.PI / 2;
  const ctAngle = caps?.ct
    ? ((temperature - caps.ct.start) / (caps.ct.end - caps.ct.start)) *
        2 *
        Math.PI -
      Math.PI / 2
    : angle;
  const selectionRadius =
    mode === 'ct'
      ? COLOR_MAX_RADIUS
      : COLOR_MIN_RADIUS + saturation * (COLOR_MAX_RADIUS - COLOR_MIN_RADIUS);
  const disk =
    mode === 'ct'
      ? 'conic-gradient(from 0deg,#ffb35e,#fff4dc,#daedff,#a9ceff,#ffb35e)'
      : `radial-gradient(circle, white ${COLOR_MIN_RADIUS}px, transparent ${COLOR_MAX_RADIUS}px),conic-gradient(from 0deg, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)`;
  const status = !connected
    ? 'Reconnecting…'
    : !selection.writable.length
      ? 'Disabled or read-only'
      : selection.skipped
        ? `${selection.skipped} read-only or sensor ${selection.skipped === 1 ? 'device' : 'devices'} skipped`
        : null;
  return (
    <QuickControlShell
      anchor={anchor}
      origin={SURFACE_ORIGIN}
      reach={SURFACE_REACH}
      autoFocus={!hold}
      onClose={onClose}
      aria-label={`${label} quick controls`}
      aria-describedby={status ? helpId : undefined}
      aria-busy={pending || restoring}
      className="radial-light-control w-[268px] touch-none text-center text-foreground"
    >
      <div className="absolute -top-[80px] left-0 w-full">
        <p className="mb-2 inline-block max-w-full truncate rounded-full border border-border bg-card/95 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur-md">
          {label}
          {mixed ? ' · Mixed' : ''}
        </p>
        <div className="flex justify-center gap-1 rounded-full">
          {colored && (
            <Button
              size="icon"
              className="size-9 rounded-full bg-card shadow-md"
              variant="ghost"
              aria-label="Hue and saturation"
              aria-pressed={mode === 'hs'}
              style={
                mode === 'hs'
                  ? { boxShadow: '0 0 0 1px hsl(var(--primary))' }
                  : undefined
              }
              onClick={() => setMode('hs')}
            >
              <Palette />
            </Button>
          )}
          {caps?.ct && (
            <Button
              size="icon"
              className="size-9 rounded-full bg-card shadow-md"
              variant="ghost"
              aria-label="Color temperature"
              aria-pressed={mode === 'ct'}
              style={
                mode === 'ct'
                  ? { boxShadow: '0 0 0 1px hsl(var(--primary))' }
                  : undefined
              }
              onClick={() => setMode('ct')}
            >
              <Thermometer />
            </Button>
          )}
          {onSelect && (
            <Button
              size="icon"
              className="size-9 rounded-full bg-card shadow-md"
              variant="ghost"
              aria-label={`Select ${label}`}
              onClick={() => {
                onClose();
                onSelect();
              }}
            >
              <MousePointer2 />
            </Button>
          )}
          {canRestore && (
            <Button
              size="icon"
              className="size-9 rounded-full bg-card shadow-md"
              variant="ghost"
              aria-label={restoreLabel}
              title={restoreLabel}
              disabled={!enabled || pending || dragging}
              aria-busy={restoring}
              onClick={async () => {
                // A delayed manual drag must not re-pause the scene after restore.
                queue.current?.cancel();
                if (!queue.current?.idle) return;
                if (await restore()) resetDraft();
              }}
            >
              {restoring ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
            </Button>
          )}
          <Button
            size="icon"
            className="size-9 rounded-full bg-card shadow-md"
            variant="ghost"
            aria-label="All light controls"
            onClick={() => {
              onClose();
              onDetails();
            }}
          >
            <SlidersHorizontal />
          </Button>
          <Button
            size="icon"
            className="size-9 rounded-full bg-card shadow-md"
            variant="ghost"
            aria-label="Close quick controls"
            data-autofocus
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      <div
        ref={surface}
        className="relative size-[268px] rounded-full bg-card/95 shadow-2xl ring-1 ring-border backdrop-blur-md"
      >
        <svg
          viewBox="0 0 268 268"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        >
          <circle
            cx="134"
            cy="134"
            r={BRIGHTNESS_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity=".12"
            strokeWidth={BRIGHTNESS_WIDTH}
          />
          {dimmable && (
            <circle
              cx="134"
              cy="134"
              r={BRIGHTNESS_RADIUS}
              fill="none"
              stroke="currentColor"
              data-brightness-arc
              style={{ color: color.hex() }}
              strokeWidth={BRIGHTNESS_WIDTH}
              pathLength="100"
              strokeDasharray={`${level} 100`}
              transform="rotate(-90 134 134)"
              strokeLinecap="butt"
            />
          )}
        </svg>
        {dimmable && (
          <div
            role="slider"
            aria-label={`${label} brightness`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level}
            aria-disabled={!enabled}
            tabIndex={enabled ? 0 : -1}
            className="absolute inset-[2px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(e) => {
              if (!enabled) return;
              e.preventDefault();
              dragCleanup.current?.();
              dragCleanup.current = start(
                e.pointerId,
                'brightness',
                e.nativeEvent,
              );
            }}
            onKeyDown={(e) => {
              let v = level;
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
                v += e.shiftKey ? 10 : 1;
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
                v -= e.shiftKey ? 10 : 1;
              else if (e.key === 'Home') v = 0;
              else if (e.key === 'End') v = 100;
              else return;
              e.preventDefault();
              adjust({ brightness: Math.max(0, Math.min(100, v)) }, true);
            }}
          />
        )}
        <div
          role={colored || caps?.ct ? 'slider' : undefined}
          aria-label={
            mode === 'ct'
              ? `${label} color temperature`
              : `${label} hue and saturation`
          }
          aria-valuemin={mode === 'ct' ? caps?.ct?.start : 0}
          aria-valuemax={mode === 'ct' ? caps?.ct?.end : 360}
          aria-valuenow={mode === 'ct' ? temperature : Math.round(hue)}
          aria-valuetext={
            mode === 'ct'
              ? `${temperature} kelvin`
              : `Hue ${Math.round(hue)} degrees, saturation ${Math.round(saturation * 100)} percent`
          }
          aria-disabled={!enabled}
          tabIndex={enabled && (colored || caps?.ct) ? 0 : -1}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            width: COLOR_SIZE,
            height: COLOR_SIZE,
            background: colored || caps?.ct ? disk : 'var(--color-muted)',
          }}
          onPointerDown={(e) => {
            if (!enabled || !(colored || caps?.ct)) return;
            e.stopPropagation();
            e.preventDefault();
            dragCleanup.current?.();
            dragCleanup.current = start(e.pointerId, 'color', e.nativeEvent);
          }}
          onKeyDown={(e) => {
            if (
              !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
            if (mode === 'ct' && caps?.ct)
              adjust(
                {
                  color: {
                    ct: Math.max(
                      caps.ct.start,
                      Math.min(caps.ct.end, temperature + d * 100),
                    ),
                  },
                },
                true,
              );
            else
              adjust(
                {
                  color: {
                    h: (hue + (e.altKey ? 0 : d * 5) + 360) % 360,
                    s: Math.max(
                      0,
                      Math.min(1, saturation + (e.altKey ? d * 0.05 : 0)),
                    ),
                  },
                },
                true,
              );
          }}
        >
          {(colored || caps?.ct) && (
            <span
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              data-color-indicator
              style={{
                width: 16,
                height: 16,
                left:
                  COLOR_CENTER +
                  Math.cos(mode === 'ct' ? ctAngle : angle) * selectionRadius,
                top:
                  COLOR_CENTER +
                  Math.sin(mode === 'ct' ? ctAngle : angle) * selectionRadius,
                background: color.hex(),
              }}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={`Turn ${label} ${power ? 'off' : 'on'}`}
          aria-pressed={power}
          disabled={!enabled}
          className="absolute left-1/2 top-1/2 grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full border-2 shadow-lg ring-4 ring-card outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          style={{
            background: power ? powerFill.hex() : '#434e5a',
            borderColor: power ? color.hex() : '#94a3b8',
            color: power && powerFill.isLight() ? '#17251e' : '#fff',
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            clearPowerHold();
            powerPress.current = {
              x: e.clientX,
              y: e.clientY,
              suppressClick: false,
              timer: setTimeout(() => {
                powerPress.current.suppressClick = true;
                latest.current.onClose();
              }, 500),
            };
          }}
          onPointerMove={(e) => {
            if (
              powerPress.current.timer &&
              Math.hypot(
                e.clientX - powerPress.current.x,
                e.clientY - powerPress.current.y,
              ) > 8
            ) {
              clearPowerHold();
              powerPress.current.suppressClick = true;
            }
          }}
          onPointerUp={clearPowerHold}
          onPointerCancel={() => {
            clearPowerHold();
            powerPress.current.suppressClick = true;
          }}
          onLostPointerCapture={clearPowerHold}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            if (!powerPress.current.suppressClick || e.detail === 0)
              adjust({ power: !power }, true);
          }}
        >
          <Power className={`mx-auto size-5 ${power ? '' : 'opacity-50'}`} />
          {pending && (
            <LoaderCircle className="pointer-events-none absolute -right-1 -top-1 size-4 animate-spin rounded-full bg-card text-foreground" />
          )}
          <span className="mt-1 text-xs tabular-nums">
            {dimmable ? `${level}%` : power ? 'On' : 'Off'}
          </span>
        </button>
        {mode === 'ct' && caps?.ct && (
          <span className="pointer-events-none absolute bottom-8 left-0 w-full text-[10px] text-foreground/80">
            {temperature} K
          </span>
        )}
      </div>
      {status && (
        <p
          id={helpId}
          className="mt-2 rounded-full bg-card/95 px-2 py-1 text-[10px] text-muted-foreground"
        >
          {status}
        </p>
      )}
    </QuickControlShell>
  );
}
