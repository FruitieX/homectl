import type { DeviceColor } from '@/bindings/DeviceColor';
import { deviceColorPreview } from '@/lib/deviceColorPreview';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const rangeClassName =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary';
const panelClassName = 'space-y-3 rounded-2xl border border-border bg-muted/30 p-3';

function isKelvinColor(color?: DeviceColor): color is { ct: number } {
  return Boolean(color && 'ct' in color);
}

function isHsColor(color?: DeviceColor): color is { h: number; s: number } {
  return Boolean(color && 'h' in color && 's' in color);
}

export function SourceColorField({
  label,
  color,
  onChange,
}: {
  label: string;
  color?: DeviceColor;
  onChange: (color: DeviceColor) => void;
}) {
  const mode = isKelvinColor(color) ? 'ct' : isHsColor(color) ? 'hs' : 'ct';
  const preview = deviceColorPreview(color);

  return (
    <div className="space-y-3">
      <ConfigField label={`${label} mode`}>
        <select
          className={selectClassName}
          value={mode}
          onChange={(event) => {
            if (event.target.value === 'ct') {
              onChange({ ct: 2700 });
            } else {
              onChange({ h: 30, s: 1 });
            }
          }}
        >
          <option value="ct">Color temperature (Kelvin)</option>
          <option value="hs">Hue / Saturation</option>
        </select>
      </ConfigField>

      <div className={panelClassName}>
        <div className="h-8 w-full rounded" style={{ backgroundColor: preview }} />

        {isKelvinColor(color) ? (
          <ConfigField
            label={`Kelvin: ${color.ct} K`}
            description="Kelvin, never mireds; the curve interpolates whole Kelvin."
          >
            <Input
              min={1000}
              max={10000}
              step={50}
              type="number"
              value={color.ct}
              onChange={(event) =>
                onChange({ ct: Number(event.target.value) || 0 })
              }
            />
          </ConfigField>
        ) : isHsColor(color) ? (
          <>
            <ConfigField label={`Hue: ${color.h}°`}>
              <input
                className={rangeClassName}
                max="360"
                min="0"
                style={{ accentColor: `hsl(${color.h}, 100%, 50%)` }}
                type="range"
                value={color.h}
                onChange={(event) =>
                  onChange({ h: Number(event.target.value), s: color.s })
                }
              />
            </ConfigField>
            <ConfigField
              label={`Saturation: ${Math.round(color.s * 100)}%`}
            >
              <input
                className={rangeClassName}
                max="100"
                min="0"
                type="range"
                value={Math.round(color.s * 100)}
                onChange={(event) =>
                  onChange({ h: color.h, s: Number(event.target.value) / 100 })
                }
              />
            </ConfigField>
          </>
        ) : null}
      </div>
    </div>
  );
}
