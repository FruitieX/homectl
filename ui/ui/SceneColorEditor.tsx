import { type DeviceColor } from '@/hooks/useConfig';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import {
  COLOR_MODE_LABELS,
  type DeviceColorMode,
  colorParts,
  colorToCss,
  defaultColorFor,
  describeColorName,
  formatColorExact,
  getColorMode,
  withColorPart,
} from '@/lib/deviceColor';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const rangeClassName =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary';
const panelClassName =
  'space-y-3 rounded-2xl border border-border bg-muted/30 p-3';

const MODES: DeviceColorMode[] = ['hs', 'rgb', 'xy', 'ct'];

/**
 * Edits one device colour in the shape the server actually stores: an untagged
 * `{h,s}` | `{r,g,b}` | `{x,y}` | `{ct}`. Switching mode emits a valid value of
 * the new shape, and an existing XY value is editable rather than dropped.
 */
export function SceneColorEditor({
  color,
  brightness,
  supportedModes,
  onChange,
}: {
  color?: DeviceColor;
  brightness?: number;
  /** Omit when target capabilities are unknown or shared across a room. */
  supportedModes?: DeviceColorMode[];
  onChange: (color: DeviceColor | undefined) => void;
}) {
  const colorMode = getColorMode(color);
  const modeSupported =
    !colorMode ||
    supportedModes === undefined ||
    supportedModes.includes(colorMode);
  const modeOptions = supportedModes
    ? MODES.filter(
        (mode) => supportedModes.includes(mode) || mode === colorMode,
      )
    : MODES;
  const preview = color ? colorToCss(color, brightness ?? 1) : 'transparent';
  const parts = color ? colorParts(color) : [];

  return (
    <div className="space-y-4">
      <ConfigField label="Color Mode">
        <select
          className={selectClassName}
          value={colorMode ?? 'none'}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === 'none') {
              onChange(undefined);
            } else {
              onChange(defaultColorFor(mode as DeviceColorMode));
            }
          }}
        >
          <option value="none">No color</option>
          {modeOptions.map((mode) => (
            <option key={mode} value={mode}>
              {COLOR_MODE_LABELS[mode]}
              {supportedModes && !supportedModes.includes(mode)
                ? ' (saved; not advertised)'
                : ''}
            </option>
          ))}
        </select>
      </ConfigField>

      {color && colorMode ? (
        <div className={panelClassName}>
          <div
            role="img"
            aria-label={`Colour preview: ${describeColorName(color)}`}
            title={formatColorExact(color)}
            className="h-8 w-full rounded"
            style={{ backgroundColor: preview }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {parts.map((part) => (
              <ConfigField
                key={part.key}
                label={`${part.label}: ${part.display}${part.unit ?? ''}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={part.min}
                    max={part.max}
                    step={part.step}
                    value={part.value}
                    aria-label={`${part.label} slider`}
                    className={rangeClassName}
                    onChange={(event) =>
                      onChange(
                        withColorPart(
                          color,
                          part.key,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                  {/* An exact number beside every slider. */}
                  <Input
                    type="number"
                    min={part.min}
                    max={part.max}
                    step={part.step}
                    value={part.display}
                    aria-label={`${part.label} exact value`}
                    className="h-9 w-24"
                    onChange={(event) =>
                      onChange(
                        withColorPart(
                          color,
                          part.key,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </div>
              </ConfigField>
            ))}
          </div>

          {colorMode === 'ct' ? (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Cool (6500K)</span>
              <span>Warm (2000K)</span>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {describeColorName(color)} · {formatColorExact(color)}
          </p>
          {!modeSupported ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The current device does not advertise this saved color mode. It
              remains unchanged unless you choose another mode.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
