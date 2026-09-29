import { useState } from 'react';
import type { DeviceColor } from '@/bindings/DeviceColor';
import type { Capabilities } from '@/bindings/Capabilities';
import {
  COLOR_MODE_LABELS,
  colorParts,
  defaultColorFor,
  describeColorName,
  formatColorExact,
  getColorMode,
  withColorPart,
  type DeviceColorMode,
} from '@/lib/deviceColor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/primitives/dialog';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { StatePreview } from './StatePreview';
const MODES: DeviceColorMode[] = ['ct', 'hs', 'rgb', 'xy'];
export function SceneColorControl({
  color,
  brightness,
  onChange,
  capabilities,
  field,
}: {
  color?: DeviceColor | null;
  brightness?: number | null;
  onChange: (color: DeviceColor | undefined) => void;
  capabilities?: Capabilities[];
  field: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DeviceColor | undefined>();
  const mode = getColorMode(pending);
  const supported = (mode: DeviceColorMode) =>
    !capabilities?.length || capabilities.some((cap) => Boolean(cap[mode]));
  const ctRanges =
    capabilities?.flatMap((cap) => (cap.ct ? [cap.ct] : [])) ?? [];
  const ctMin = ctRanges.length
    ? Math.min(...ctRanges.map((range) => range.start))
    : 1000;
  const ctMax = ctRanges.length
    ? Math.max(...ctRanges.map((range) => range.end))
    : 10000;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-9 w-full justify-start gap-2 px-2 py-1.5"
        data-field={field}
        onClick={() => {
          setPending(color ?? undefined);
          setOpen(true);
        }}
      >
        <StatePreview color={color} brightness={brightness} size={25} />
        <span className="truncate text-xs">
          {color ? describeColorName(color) : 'Not specified'}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="settings-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Color</DialogTitle>
            <DialogDescription>
              Apply updates your draft. Save the page to keep the change.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-4">
            <StatePreview color={pending} brightness={brightness} size={58} />
            <div>
              <p className="text-sm font-medium">
                {pending ? describeColorName(pending) : 'Not specified'}
              </p>
              <p className="text-xs text-muted-foreground">
                {pending
                  ? formatColorExact(pending)
                  : 'No color value is specified.'}
              </p>
            </div>
          </div>
          <label className="grid gap-2 text-sm">
            Color mode
            <select
              aria-label="Color mode"
              className="settings-select"
              value={mode ?? ''}
              onChange={(event) =>
                setPending(
                  event.target.value
                    ? defaultColorFor(event.target.value as DeviceColorMode)
                    : undefined,
                )
              }
            >
              <option value="">Not specified</option>
              {MODES.filter(
                (candidate) =>
                  supported(candidate) ||
                  candidate === mode ||
                  candidate === getColorMode(color),
              ).map((candidate) => (
                <option key={candidate} value={candidate}>
                  {COLOR_MODE_LABELS[candidate]}
                  {!supported(candidate)
                    ? ' · not supported by these targets'
                    : ''}
                </option>
              ))}
            </select>
          </label>
          {pending && (
            <div className="grid gap-4">
              {colorParts(pending).map((raw) => {
                const part =
                  raw.key === 'ct' &&
                  Number.isFinite(ctMin) &&
                  Number.isFinite(ctMax)
                    ? {
                        ...raw,
                        min: Math.min(ctMin, raw.display),
                        max: Math.max(ctMax, raw.display),
                      }
                    : raw;
                return (
                  <label key={part.key} className="grid gap-2 text-sm">
                    <span className="flex items-center justify-between">
                      {part.label}
                      <span className="text-xs text-muted-foreground">
                        {part.unit}
                      </span>
                    </span>
                    <div className="flex items-center gap-3">
                      <input
                        aria-label={`${part.label} slider`}
                        type="range"
                        className="min-w-0 flex-1 accent-primary"
                        min={part.min}
                        max={part.max}
                        step={part.step}
                        value={part.display}
                        onChange={(event) =>
                          setPending(
                            withColorPart(
                              pending,
                              part.key,
                              Number(event.target.value),
                            ),
                          )
                        }
                      />
                      <Input
                        className="w-24"
                        type="number"
                        aria-label={part.label}
                        min={part.min}
                        max={part.max}
                        step={part.step}
                        value={part.display}
                        onChange={(event) => {
                          if (event.target.value !== '')
                            setPending(
                              withColorPart(
                                pending,
                                part.key,
                                Number(event.target.value),
                              ),
                            );
                        }}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {mode === 'ct' && ctRanges.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Device temperature ranges:{' '}
              {ctRanges
                .map((range) => `${range.start}–${range.end} K`)
                .join(', ')}
              .
            </p>
          )}
          {mode && !supported(mode) && (
            <p className="text-xs text-amber-700">
              This stored color mode is preserved. These target devices do not
              advertise support for it.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange(pending);
                setOpen(false);
              }}
            >
              Apply color
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
