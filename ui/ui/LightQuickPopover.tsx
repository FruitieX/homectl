import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Palette,
  Power,
  SlidersHorizontal,
  Thermometer,
  X,
  LoaderCircle,
} from 'lucide-react';
import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { useConnectionStatus } from '@/hooks/websocket';
import { useLiveDeviceControls } from '@/hooks/useLiveDeviceControls';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import {
  isDeviceReadOnly,
  supportsDeviceBrightness,
} from '@/lib/deviceCapabilities';
import { ringBrightness, type LightHold } from '@/lib/lightQuickAdjust';
import { getColor } from '@/lib/colors';
import { Button } from './primitives/button';

type Adjustment = { brightness?: number; color?: DeviceColor };
/** One radial surface for map and row indicators. Commands commit on release. */
export function LightQuickPopover({
  device,
  anchor,
  hold,
  onClose,
  onDetails,
  displayNames = {},
}: {
  device: Device;
  anchor: { x: number; y: number };
  hold?: LightHold;
  onClose: () => void;
  onDetails: () => void;
  displayNames?: Record<string, string>;
}) {
  const helpId = useId();
  const setState = useLiveDeviceControls();
  const connected = useConnectionStatus() === 'connected';
  const state =
    'Controllable' in device.data ? device.data.Controllable.state : null;
  const caps =
    'Controllable' in device.data
      ? device.data.Controllable.capabilities
      : null;
  const colored = Boolean(caps?.hs || caps?.xy || caps?.rgb);
  const dimmable = supportsDeviceBrightness(device);
  const [mode, setMode] = useState<'hs' | 'ct'>(() =>
    state?.color && 'ct' in state.color && caps?.ct
      ? 'ct'
      : colored
        ? 'hs'
        : caps?.ct
          ? 'ct'
          : 'hs',
  );
  const [draft, setDraft] = useState<Adjustment | null>(null),
    [pending, setPending] = useState(false);
  const enabled = connected && !isDeviceReadOnly(device) && !pending;
  const root = useRef<HTMLDivElement>(null),
    returnFocus = useRef(document.activeElement);
  const color = getColor(device.data);
  const hue = draft?.color && 'h' in draft.color ? draft.color.h : color.hue();
  const saturation =
    draft?.color && 's' in draft.color
      ? draft.color.s
      : color.saturationv() / 100;
  const temperature =
    draft?.color && 'ct' in draft.color
      ? draft.color.ct
      : state?.color && 'ct' in state.color
        ? state.color.ct
        : 4000;
  const level = draft?.brightness ?? Math.round((state?.brightness ?? 1) * 100);
  const cx = Math.max(140, Math.min(innerWidth - 140, anchor.x));
  const cy = Math.max(208, Math.min(innerHeight - 162, anchor.y));
  const label = getDeviceDisplayLabel(device, displayNames);
  const apply = async (value: Adjustment) => {
    if (!enabled) return;
    setPending(true);
    try {
      await setState(
        device,
        value.brightness === undefined
          ? (state?.power ?? true)
          : value.brightness > 0,
        value.brightness === undefined ? undefined : value.brightness / 100,
        value.color,
      );
    } finally {
      setPending(false);
      setDraft(null);
    }
  };
  const latest = useRef({
    enabled,
    apply,
    onClose,
    mode,
    caps,
    dimmable,
    cx,
    cy,
  });
  latest.current = { enabled, apply, onClose, mode, caps, dimmable, cx, cy };
  useEffect(() => {
    const previousFocus = returnFocus.current;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) latest.current.onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onClose();
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    if (!hold)
      root.current
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="Close quick controls"]',
        )
        ?.focus();
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
      if (!hold && previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [hold]);
  const start = (
    pointerId: number,
    region: 'brightness' | 'color',
    origin: { x: number; y: number },
    initial?: PointerEvent,
  ) => {
    let value: Adjustment | null = null,
      previous: number | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !latest.current.enabled) return;
      const dx = e.clientX - origin.x,
        dy = e.clientY - origin.y,
        r = Math.hypot(dx, dy);
      if (region === 'brightness' && r < 108) return;
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
        value = {
          color: {
            h: ringBrightness(dx, dy) * 3.6,
            s: Math.max(0, Math.min(1, (r - 30) / 66)),
          },
        };
      }
      setDraft(value);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (value && e.type !== 'pointercancel') move(e);
      cleanup();
      if (e.type === 'pointercancel') {
        setDraft(null);
        return;
      }
      if (value) void latest.current.apply(value);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) return;
      cleanup();
      setDraft(null);
    };
    const cleanup = () => {
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
    const cleanup = start(hold.pointerId, 'brightness', { x: cx, y: cy });
    return cleanup;
  }, [hold, cx, cy]);
  if (!state) return null;
  const angle = (hue * Math.PI) / 180 - Math.PI / 2;
  const ctAngle = caps?.ct
    ? ((temperature - caps.ct.start) / (caps.ct.end - caps.ct.start)) *
        2 *
        Math.PI -
      Math.PI / 2
    : angle;
  const selectionRadius = 30 + saturation * 66;
  const disk =
    mode === 'ct'
      ? 'conic-gradient(from 0deg,#ffb35e,#fff4dc,#daedff,#a9ceff,#ffb35e)'
      : 'radial-gradient(circle, white 34px, transparent 96px),conic-gradient(from 0deg, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-label={`${label} quick controls`}
      aria-describedby={helpId}
      className="radial-light-control fixed z-[60] w-[268px] touch-none text-center text-foreground"
      style={{ left: cx - 134, top: cy - 134 }}
    >
      <div className="absolute -top-16 left-0 w-full">
        <p className="mb-1 truncate text-xs font-medium">{label}</p>
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
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      <div className="relative size-[268px] rounded-full border border-border bg-card/95 shadow-2xl backdrop-blur-md">
        <svg
          viewBox="0 0 268 268"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        >
          <circle
            cx="134"
            cy="134"
            r="119"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".12"
            strokeWidth="14"
          />
          {dimmable && (
            <circle
              cx="134"
              cy="134"
              r="119"
              fill="none"
              stroke="currentColor"
              className="text-primary"
              strokeWidth="14"
              pathLength="100"
              strokeDasharray={`${level} 100`}
              transform="rotate(-90 134 134)"
              strokeLinecap={level ? 'round' : 'butt'}
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
            className="absolute inset-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(e) => {
              if (!enabled) return;
              e.preventDefault();
              dragCleanup.current?.();
              dragCleanup.current = start(
                e.pointerId,
                'brightness',
                { x: cx, y: cy },
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
              void apply({ brightness: Math.max(0, Math.min(100, v)) });
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
          className="absolute left-[38px] top-[38px] size-48 rounded-full border-4 border-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            background: colored || caps?.ct ? disk : 'var(--color-muted)',
          }}
          onPointerDown={(e) => {
            if (!enabled || !(colored || caps?.ct)) return;
            e.stopPropagation();
            e.preventDefault();
            dragCleanup.current?.();
            dragCleanup.current = start(
              e.pointerId,
              'color',
              { x: cx, y: cy },
              e.nativeEvent,
            );
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
              void apply({
                color: {
                  ct: Math.max(
                    caps.ct.start,
                    Math.min(caps.ct.end, temperature + d * 100),
                  ),
                },
              });
            else
              void apply({
                color: {
                  h: (hue + (e.altKey ? 0 : d * 5) + 360) % 360,
                  s: Math.max(
                    0,
                    Math.min(1, saturation + (e.altKey ? d * 0.05 : 0)),
                  ),
                },
              });
          }}
        >
          {(colored || caps?.ct) && (
            <span
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{
                left:
                  92 +
                  Math.cos(mode === 'ct' ? ctAngle : angle) * selectionRadius,
                top:
                  92 +
                  Math.sin(mode === 'ct' ? ctAngle : angle) * selectionRadius,
                background:
                  mode === 'hs'
                    ? `hsl(${hue} ${saturation * 100}% 50%)`
                    : color.hex(),
              }}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={`Turn ${label} ${state.power ? 'off' : 'on'}`}
          aria-pressed={state.power}
          disabled={!enabled}
          className="absolute left-1/2 top-1/2 grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full border-4 border-card bg-card text-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          onClick={async () => {
            setPending(true);
            try {
              await setState(device, !state.power);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? (
            <LoaderCircle className="mx-auto size-5 animate-spin" />
          ) : (
            <Power
              className={`mx-auto size-5 ${state.power ? 'text-primary' : 'text-muted-foreground'}`}
            />
          )}
          <span className="mt-1 text-xs tabular-nums">
            {dimmable ? `${level}%` : state.power ? 'On' : 'Off'}
          </span>
        </button>
        <span className="pointer-events-none absolute bottom-8 left-0 w-full text-[10px] text-foreground/80">
          {mode === 'ct' && caps?.ct
            ? `${temperature} K`
            : colored
              ? `${Math.round(saturation * 100)}% saturation`
              : ''}
        </span>
      </div>
      <p
        id={helpId}
        className="mt-2 rounded-full bg-card/95 px-2 py-1 text-[10px] text-muted-foreground"
      >
        {!connected
          ? 'Reconnecting…'
          : isDeviceReadOnly(device)
            ? 'Disabled or read-only'
            : mode === 'ct'
              ? 'Inner circle: temperature · outer ring: brightness'
              : 'Inner circle: color · outer ring: brightness'}
      </p>
    </div>,
    document.body,
  );
}
