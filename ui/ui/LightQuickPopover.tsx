import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X, Power } from 'lucide-react';
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
import { LiveStatePreview, devicePreviewState } from './LiveStatePreview';
import { Button } from './primitives/button';
import { Slider } from './primitives/slider';
import { Popover, PopoverAnchor, PopoverContent } from './primitives/popover';

/** Shared by canvas markers and ordinary light indicators. No write until release. */
export function LightQuickPopover({
  device,
  anchor,
  hold,
  onSelect,
  onClose,
  onDetails,
  displayNames = {},
}: {
  device: Device;
  anchor: { x: number; y: number };
  hold?: LightHold;
  onSelect?: () => void;
  onClose: () => void;
  onDetails: () => void;
  displayNames?: Record<string, string>;
}) {
  const setState = useLiveDeviceControls();
  const returnFocus = useRef(document.activeElement);
  const connected = useConnectionStatus() === 'connected';
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [holding, setHolding] = useState(Boolean(hold));
  const state =
    'Controllable' in device.data ? device.data.Controllable.state : null;
  const capabilities =
    'Controllable' in device.data
      ? device.data.Controllable.capabilities
      : null;
  const dimmable = supportsDeviceBrightness(device);
  const enabled = connected && !isDeviceReadOnly(device) && !pending;
  const level = draft ?? Math.round((state?.brightness ?? 1) * 100);
  const label = getDeviceDisplayLabel(device, displayNames);
  const commit = async (brightness?: number, color?: DeviceColor) => {
    if (!enabled) return;
    setPending(true);
    try {
      await setState(
        device,
        brightness === undefined ? (state?.power ?? true) : brightness > 0,
        brightness === undefined ? undefined : brightness / 100,
        color,
      );
    } finally {
      setPending(false);
      setDraft(null);
    }
  };
  const latest = useRef({ enabled, dimmable, commit, onSelect, onClose });
  latest.current = { enabled, dimmable, commit, onSelect, onClose };
  useEffect(() => {
    if (!hold) return;
    setHolding(true);
    setDraft(null);
    let value: number | null = null;
    let previous: number | null = null;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== hold.pointerId) return;
      const dx = event.clientX - hold.x,
        dy = event.clientY - hold.y;
      if (
        !latest.current.enabled ||
        !latest.current.dimmable ||
        Math.hypot(dx, dy) < 42
      )
        return;
      event.preventDefault();
      let next = ringBrightness(dx, dy);
      // Crossing twelve o'clock must not jump straight from full to dark.
      if (previous !== null && Math.abs(next - previous) > 50)
        next = previous > 50 ? 100 : 0;
      previous = next;
      value = next;
      setDraft(next);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== hold.pointerId) return;
      cleanup();
      setHolding(false);
      if (event.type === 'pointercancel') {
        setDraft(null);
        latest.current.onClose();
        return;
      }
      if (value === null) latest.current.onSelect?.();
      else void latest.current.commit(value);
    };
    const secondPointer = (event: PointerEvent) => {
      if (event.pointerId === hold.pointerId) return;
      cleanup();
      setHolding(false);
      setDraft(null);
      latest.current.onClose();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('pointerdown', secondPointer);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('pointerdown', secondPointer);
    return cleanup;
  }, [hold]);
  if (!state) return null;
  const color = getColor(device.data);
  const colored = capabilities?.hs || capabilities?.xy || capabilities?.rgb;
  return (
    <>
      {holding &&
        dimmable &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60] grid size-36 place-items-center rounded-full bg-background/90 text-primary shadow-xl"
            style={{ left: anchor.x - 72, top: anchor.y - 72 }}
            aria-hidden="true"
          >
            <svg className="absolute inset-0 size-full" viewBox="0 0 144 144">
              <circle
                cx="72"
                cy="72"
                r="58"
                fill="none"
                stroke="currentColor"
                strokeOpacity=".15"
                strokeWidth="10"
              />
              <circle
                cx="72"
                cy="72"
                r="58"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                pathLength="100"
                strokeDasharray={`${level} 100`}
                transform="rotate(-90 72 72)"
                strokeLinecap={level ? 'round' : 'butt'}
              />
            </svg>
            <div className="grid justify-items-center gap-1">
              <LiveStatePreview
                states={[{ ...state, brightness: level / 100 }]}
                size={40}
              />
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {level}%
              </span>
            </div>
          </div>,
          document.body,
        )}
      <Popover
        open
        onOpenChange={(open) => {
          if (!open && !holding) onClose();
        }}
      >
        <PopoverAnchor asChild>
          <span
            className="pointer-events-none fixed"
            style={{ left: anchor.x, top: anchor.y, width: 1, height: 1 }}
          />
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          sideOffset={holding ? 80 : 16}
          collisionPadding={12}
          className="w-72 max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-3 rounded-xl"
          aria-label={`${label} quick controls`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!hold && returnFocus.current instanceof HTMLElement)
              returnFocus.current.focus();
          }}
          onEscapeKeyDown={() => onClose()}
          onOpenAutoFocus={(event) => {
            if (hold) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (holding) event.preventDefault();
          }}
        >
          <div className="flex items-center gap-2">
            <LiveStatePreview states={[devicePreviewState(device)]} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {label}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Close quick controls"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
          {!connected || isDeviceReadOnly(device) ? (
            <p className="text-xs text-muted-foreground">
              {!connected
                ? 'Reconnecting…'
                : 'Device is disabled or read-only.'}
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {state.power ? 'On' : 'Off'}
            </span>
            <Button
              size="icon"
              variant={state.power ? 'secondary' : 'outline'}
              aria-label={`Turn ${label} ${state.power ? 'off' : 'on'}`}
              aria-pressed={state.power}
              disabled={!enabled || holding}
              onClick={async () => {
                setPending(true);
                try {
                  await setState(device, !state.power);
                } finally {
                  setPending(false);
                }
              }}
            >
              <Power />
            </Button>
          </div>
          {dimmable && (
            <div>
              <div className="flex justify-between text-xs">
                <span>Brightness</span>
                <span className="tabular-nums">{level}%</span>
              </div>
              <Slider
                aria-label={`${label} brightness`}
                className="min-h-11"
                min={0}
                max={100}
                step={1}
                value={[level]}
                disabled={!enabled || holding}
                onValueChange={([value]) => setDraft(value)}
                onValueCommit={([value]) => void commit(value)}
              />
            </div>
          )}
          {capabilities?.ct && (
            <div className="grid grid-cols-3 gap-1">
              {[
                ['Warm', 2700],
                ['Neutral', 4000],
                ['Cool', 6000],
              ].map(([name, temperature]) => (
                <Button
                  key={name}
                  size="sm"
                  variant="outline"
                  disabled={!enabled || holding}
                  onClick={() =>
                    void commit(undefined, {
                      ct: Math.max(
                        capabilities.ct!.start,
                        Math.min(capabilities.ct!.end, Number(temperature)),
                      ),
                    })
                  }
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
          {colored && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Color</div>
              <Slider
                aria-label={`${label} hue`}
                className="min-h-11"
                trackStyle={{
                  background:
                    'linear-gradient(to right, #ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)',
                }}
                rangeClassName="bg-transparent"
                min={0}
                max={360}
                step={1}
                defaultValue={[Math.round(color.hue())]}
                disabled={!enabled || holding}
                onValueCommit={([h]) => void commit(undefined, { h, s: 1 })}
              />
            </div>
          )}
          {holding && (
            <p className="text-xs text-muted-foreground">
              {onSelect
                ? 'Release to select. Drag onto the ring to dim.'
                : 'Drag onto the ring to dim. Release to keep controls open.'}
            </p>
          )}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              onClose();
              onDetails();
            }}
          >
            <SlidersHorizontal className="size-4" />
            All light controls
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
}
