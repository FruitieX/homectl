import { useEffect, useMemo, useState } from 'react';
import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { getColor } from '@/lib/colors';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { useDeviceColorCalibrations } from '@/hooks/useConfig';
import { Slider } from '@/ui/primitives/slider';
import { Button } from '@/ui/primitives/button';
import Color from 'color';

type Mode = 'ct' | 'hs' | 'xy' | 'rgb';
function activeMode(color: DeviceColor | null | undefined): Mode | '' {
  return !color
    ? ''
    : 'ct' in color
      ? 'ct'
      : 'h' in color
        ? 'hs'
        : 'x' in color
          ? 'xy'
          : 'rgb';
}

export function DeviceColorMode({
  devices,
  connected,
  onChange,
  temperatureOnly = false,
}: {
  devices: Device[];
  connected: boolean;
  temperatureOnly?: boolean;
  onChange: (
    device: Device,
    power: boolean,
    brightness?: number,
    color?: DeviceColor,
  ) => void;
}) {
  const { data: calibrations, loading: calibrationLoading } =
    useDeviceColorCalibrations();
  const eligible = devices.filter(
    (d) => 'Controllable' in d.data && !isDeviceReadOnly(d),
  );
  const options = (
    [
      ['ct', 'Temperature'],
      ['hs', 'HSV'],
      ['xy', 'XY'],
      ['rgb', 'RGB'],
    ] as const
  ).filter(
    ([mode]) =>
      (!temperatureOnly || mode === 'ct') &&
      eligible.length > 0 &&
      eligible.every(
        (d) =>
          'Controllable' in d.data &&
          Boolean(d.data.Controllable.capabilities[mode]),
      ),
  );
  const colors = eligible.map((d) => {
    if (!('Controllable' in d.data)) return null;
    const data = d.data.Controllable;
    // Report metadata contains the physical HSV command. Editing it as a
    // reference would apply calibration a second time on the next adjustment.
    if (
      calibrationLoading ||
      calibrations.some(
        (row) =>
          row.device_key === `${d.integration_id}/${d.id}` &&
          row.points.length > 0,
      )
    ) {
      return data.state.color;
    }
    return data.last_report &&
      !data.last_report.retained &&
      data.last_report.received_at_ms >= (data.requested_at_ms ?? 0)
      ? data.last_report.state.color
      : data.state.color;
  });
  const [draft, setDraft] = useState<DeviceColor | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!draft || dragging) return;
    const timeout = setTimeout(() => setDraft(null), 10000);
    return () => clearTimeout(timeout);
  }, [draft, dragging]);
  const modes = colors.map(activeMode);
  const mode = temperatureOnly
    ? 'ct'
    : draft
      ? activeMode(draft)
      : modes.every((m) => m === modes[0])
        ? modes[0]
        : '';
  const ranges = eligible.flatMap((d) =>
    'Controllable' in d.data && d.data.Controllable.capabilities.ct
      ? [d.data.Controllable.capabilities.ct]
      : [],
  );
  const min = Math.max(...ranges.map((r) => r.start));
  const max = Math.min(...ranges.map((r) => r.end));
  function initial(next: Mode): DeviceColor {
    const existing = colors.find((c) => activeMode(c) === next);
    if (next === 'ct')
      return {
        ct: Math.max(
          min,
          Math.min(max, existing && 'ct' in existing ? existing.ct : 4000),
        ),
      };
    if (existing) return existing;
    const color = getColor(eligible[0].data);
    if (next === 'hs')
      return { h: Math.round(color.hue()), s: color.saturationv() / 100 };
    if (next === 'rgb') {
      const [r, g, b] = color.rgb().round().array();
      return { r, g, b };
    }
    const [r, g, b] = color
      .rgb()
      .array()
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    const x = r * 0.4124 + g * 0.3576 + b * 0.1805,
      y = r * 0.2126 + g * 0.7152 + b * 0.0722,
      z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    return x + y + z > 0
      ? { x: x / (x + y + z), y: y / (x + y + z) }
      : { x: 0.3127, y: 0.329 };
  }
  function apply(color: DeviceColor) {
    if ('ct' in color && min > max) return;
    setDraft(color);
    setDragging(false);
    eligible.forEach((device) => {
      if ('Controllable' in device.data)
        onChange(
          device,
          device.data.Controllable.state.power,
          undefined,
          color,
        );
    });
  }
  const color =
    draft ??
    (mode && options.some(([value]) => value === mode) ? initial(mode) : null);
  const mixed =
    !draft &&
    colors.some((c) => JSON.stringify(c) !== JSON.stringify(colors[0]));
  const channels: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    unit?: string;
  }[] =
    color && 'ct' in color
      ? [
          {
            key: 'ct',
            label: 'Color temperature',
            min,
            max,
            step: 1,
            value: color.ct,
            unit: ' K',
          },
        ]
      : color && 'h' in color
        ? [
            {
              key: 'h',
              label: 'Hue',
              min: 0,
              max: 359,
              step: 1,
              value: color.h,
              unit: '°',
            },
            {
              key: 's',
              label: 'Saturation',
              min: 0,
              max: 1,
              step: 0.01,
              value: color.s,
            },
          ]
        : color && 'x' in color
          ? [
              {
                key: 'x',
                label: 'X',
                min: 0,
                max: 1,
                step: 0.001,
                value: color.x,
              },
              {
                key: 'y',
                label: 'Y',
                min: 0.001,
                max: 1,
                step: 0.001,
                value: color.y,
              },
            ]
          : color && 'r' in color
            ? (['r', 'g', 'b'] as const).map((key, i) => ({
                key,
                label: ['Red', 'Green', 'Blue'][i],
                min: 0,
                max: 255,
                step: 1,
                value: color[key],
              }))
            : [];
  function update(key: string, value: number): DeviceColor {
    const next = { ...color, [key]: value } as DeviceColor;
    if ('x' in next) {
      // Keep both tracks at a fixed scale. Clamp only the edited coordinate
      // to valid chromaticity; moving one slider must not move the other thumb.
      if (key === 'x') next.x = Math.min(next.x, 1 - next.y);
      else next.y = Math.min(next.y, 1 - next.x);
    }
    return next;
  }
  function xyLimit(key: string) {
    return color && 'x' in color
      ? Math.max(0, Math.min(1, 1 - (key === 'x' ? color.y : color.x)))
      : 1;
  }
  function xyGradient(key: string) {
    const edge = xyLimit(key) * 100;
    const other =
      color && 'x' in color ? (key === 'x' ? color.y : color.x) : 0.329;
    const stops = Array.from({ length: 25 }, (_, index) => {
      const position = index / 24;
      if (position > edge / 100) return `#28332f ${position * 100}%`;
      const coordinate = Math.min(position, edge / 100);
      const x = key === 'x' ? coordinate : other;
      const y = key === 'y' ? coordinate : other;
      const safeY = Math.max(0.0001, y);
      const z = Math.max(0, 1 - x - y);
      let red = 1.656492 * (x / safeY) - 0.354851 - 0.255038 * (z / safeY);
      let green = -0.707196 * (x / safeY) + 1.655397 + 0.036152 * (z / safeY);
      let blue = 0.051713 * (x / safeY) - 0.121364 + 1.01153 * (z / safeY);
      const gamma = (value: number) =>
        value <= 0.0031308
          ? 12.92 * value
          : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
      red = gamma(red);
      green = gamma(green);
      blue = gamma(blue);
      // Preserve fractional RGB values. 8-bit hex quantizes nearby XY values
      // into visible steps while dragging.
      const tone = (value: number, neutral: number) =>
        Math.max(0, Math.min(1, value * 0.7 + neutral * 0.3));
      return `rgb(${tone(red, 0.443) * 100}% ${tone(green, 0.502) * 100}% ${tone(blue, 0.471) * 100}%) ${position * 100}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')}, #28332f ${edge}%, #28332f 100%)`;
  }
  function colorGradient(key: string) {
    const base = eligible[0] ? getColor(eligible[0].data) : Color('#7aa88f');
    const tone = (hex: string) => Color(hex).mix(Color('#718078'), 0.3).hex();
    const stops = Array.from({ length: 17 }, (_, index) => {
      const position = index / 16;
      if (key === 's')
        return tone(Color.hsv(base.hue(), position * 100, 100).hex());
      return tone(base.value(position * 100).hex());
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }
  const colorX = color && 'x' in color ? color.x : null;
  const colorY = color && 'x' in color ? color.y : null;
  // The function intentionally captures the current color; primitive values
  // are the stable cache key while the slider is being dragged.
  const xyGradients = useMemo(
    () => ({ x: xyGradient('x'), y: xyGradient('y') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorX, colorY],
  );
  if (!options.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border/60 p-3">
      {!temperatureOnly && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Color mode</span>
          <select
            aria-label="Color mode"
            className="min-h-10 rounded-md border border-border bg-background px-3"
            disabled={!connected}
            value={options.some(([v]) => v === mode) ? mode : ''}
            onChange={(e) => apply(initial(e.target.value as Mode))}
          >
            <option value="" disabled>
              Mixed / unknown
            </option>
            {options.map(([value, label]) => (
              <option
                key={value}
                value={value}
                disabled={value === 'ct' && min > max}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {channels
        .filter((c) => c.min <= c.max)
        .map((channel) => (
          <div key={channel.key}>
            <div className="flex items-center justify-between text-sm">
              <span>{channel.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {mixed
                  ? 'Mixed'
                  : channel.key === 's'
                    ? `${Math.round(channel.value * 100)}%`
                    : `${Number(channel.value.toFixed(3))}${channel.unit ?? ''}`}
              </span>
            </div>
            <Slider
              aria-label={channel.label}
              className="min-h-11 [&>span:first-child>span]:bg-transparent"
              rangeClassName="bg-transparent"
              trackStyle={{
                backgroundImage:
                  channel.key === 'x' || channel.key === 'y'
                    ? xyGradients[channel.key as 'x' | 'y']
                    : channel.key === 'ct'
                      ? 'linear-gradient(to right, #c9ad82, #d0ccc2, #9fb2c4)'
                      : channel.key === 'h'
                        ? 'linear-gradient(to right, #c58484, #c5c584, #84c584, #84c5c5, #8484c5, #c584c5, #c58484)'
                        : channel.key === 's' || channel.key === 'v'
                          ? colorGradient(channel.key)
                          : 'linear-gradient(to right, #3a4650, #8aa7b8)',
              }}
              min={channel.min}
              max={channel.max}
              step={channel.step}
              value={[channel.value]}
              disabled={!connected || channel.min === channel.max}
              onPointerCancel={() => {
                setDragging(false);
                setDraft(null);
              }}
              onValueChange={([v]) => {
                setDragging(true);
                setDraft(update(channel.key, v));
              }}
              onValueCommit={([v]) => apply(update(channel.key, v))}
            />
          </div>
        ))}
      {mode === 'ct' && min <= max && (
        <div className="flex gap-2">
          {[
            { value: 2700, label: 'Warm' },
            { value: 4000, label: 'Neutral' },
            { value: 6500, label: 'Cool' },
          ]
            .filter(({ value }) => value >= min && value <= max)
            .map(({ value, label }) => (
              <Button
                key={value}
                variant="outline"
                className="flex-1"
                disabled={!connected}
                onClick={() => apply({ ct: value })}
              >
                {label}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}
