import { type DeviceColor } from '@/hooks/useConfig';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const rangeClassName =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary';
const panelClassName =
  'space-y-3 rounded-2xl border border-border bg-muted/30 p-3';

type ColorMode = 'hs' | 'xy' | 'rgb' | 'ct' | undefined;

function getColorMode(color?: DeviceColor): ColorMode {
  if (!color) return undefined;
  if ('Hs' in color) return 'hs';
  if ('Xy' in color) return 'xy';
  if ('Rgb' in color) return 'rgb';
  if ('Ct' in color) return 'ct';
  return undefined;
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function getColorPreview(color?: DeviceColor, brightness?: number): string {
  if (!color) return 'transparent';

  const b = brightness ?? 1;

  if ('Hs' in color && color.Hs) {
    const { r, g, b: blue } = hslToRgb(color.Hs.h, color.Hs.s, 0.5);
    return `rgb(${Math.round(r * b)}, ${Math.round(g * b)}, ${Math.round(blue * b)})`;
  }

  if ('Rgb' in color && color.Rgb) {
    return `rgb(${Math.round(color.Rgb.r * b)}, ${Math.round(color.Rgb.g * b)}, ${Math.round(color.Rgb.b * b)})`;
  }

  if ('Ct' in color && color.Ct) {
    const ct = color.Ct.ct;
    const warmth = Math.max(0, Math.min(1, (ct - 153) / (500 - 153)));
    const r = Math.round((255 - warmth * 55) * b);
    const g = Math.round((240 - warmth * 30) * b);
    const blue = Math.round((200 + warmth * 55) * b);
    return `rgb(${r}, ${g}, ${blue})`;
  }

  return 'gray';
}

export function SceneColorEditor({
  color,
  brightness,
  onChange,
}: {
  color?: DeviceColor;
  brightness?: number;
  onChange: (color: DeviceColor | undefined) => void;
}) {
  const colorMode = getColorMode(color);
  const preview = getColorPreview(color, brightness);

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
            } else if (mode === 'hs') {
              onChange({ Hs: { h: 30, s: 1 } });
            } else if (mode === 'rgb') {
              onChange({ Rgb: { r: 255, g: 200, b: 100 } });
            } else if (mode === 'ct') {
              onChange({ Ct: { ct: 300 } });
            }
          }}
        >
          <option value="none">No color</option>
          <option value="hs">Hue/Saturation</option>
          <option value="rgb">RGB</option>
          <option value="ct">Color Temperature</option>
        </select>
      </ConfigField>

      {colorMode ? (
        <div className={panelClassName}>
          <div
            className="h-8 w-full rounded"
            style={{ backgroundColor: preview }}
          />

          {colorMode === 'hs' && color && 'Hs' in color ? (
            <>
              <ConfigField label={`Hue: ${color.Hs?.h ?? 0}°`}>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={color.Hs?.h ?? 0}
                  className={rangeClassName}
                  style={{ accentColor: `hsl(${color.Hs?.h ?? 0}, 100%, 50%)` }}
                  onChange={(event) =>
                    onChange({
                      Hs: {
                        h: Number(event.target.value),
                        s: color.Hs?.s ?? 1,
                      },
                    })
                  }
                />
              </ConfigField>
              <ConfigField
                label={`Saturation: ${Math.round((color.Hs?.s ?? 1) * 100)}%`}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={(color.Hs?.s ?? 1) * 100}
                  className={rangeClassName}
                  onChange={(event) =>
                    onChange({
                      Hs: {
                        h: color.Hs?.h ?? 0,
                        s: Number(event.target.value) / 100,
                      },
                    })
                  }
                />
              </ConfigField>
            </>
          ) : null}

          {colorMode === 'rgb' && color && 'Rgb' in color ? (
            <div className="grid grid-cols-3 gap-3">
              <ConfigField label="R">
                <Input
                  type="number"
                  min="0"
                  max="255"
                  className="h-9"
                  value={color.Rgb?.r ?? 255}
                  onChange={(event) =>
                    onChange({
                      Rgb: {
                        r: Number(event.target.value),
                        g: color.Rgb?.g ?? 200,
                        b: color.Rgb?.b ?? 100,
                      },
                    })
                  }
                />
              </ConfigField>
              <ConfigField label="G">
                <Input
                  type="number"
                  min="0"
                  max="255"
                  className="h-9"
                  value={color.Rgb?.g ?? 200}
                  onChange={(event) =>
                    onChange({
                      Rgb: {
                        r: color.Rgb?.r ?? 255,
                        g: Number(event.target.value),
                        b: color.Rgb?.b ?? 100,
                      },
                    })
                  }
                />
              </ConfigField>
              <ConfigField label="B">
                <Input
                  type="number"
                  min="0"
                  max="255"
                  className="h-9"
                  value={color.Rgb?.b ?? 100}
                  onChange={(event) =>
                    onChange({
                      Rgb: {
                        r: color.Rgb?.r ?? 255,
                        g: color.Rgb?.g ?? 200,
                        b: Number(event.target.value),
                      },
                    })
                  }
                />
              </ConfigField>
            </div>
          ) : null}

          {colorMode === 'ct' && color && 'Ct' in color ? (
            <ConfigField
              label={`Color Temp: ${color.Ct?.ct ?? 300} mireds (~${Math.round(
                1000000 / (color.Ct?.ct ?? 300),
              )}K)`}
            >
              <input
                type="range"
                min="153"
                max="500"
                value={color.Ct?.ct ?? 300}
                className={rangeClassName}
                onChange={(event) =>
                  onChange({ Ct: { ct: Number(event.target.value) } })
                }
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>Cool (6500K)</span>
                <span>Warm (2000K)</span>
              </div>
            </ConfigField>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
