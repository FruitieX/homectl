import { useState } from 'react';
import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { getColor } from '@/lib/colors';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';

type Mode = 'ct' | 'hs' | 'xy';
function activeMode(color: DeviceColor | null | undefined): Mode | '' {
  if (!color) return '';
  return 'ct' in color ? 'ct' : 'h' in color ? 'hs' : 'x' in color ? 'xy' : '';
}

export function DeviceColorMode({
  devices,
  connected,
  onChange,
}: {
  devices: Device[];
  connected: boolean;
  onChange: (
    device: Device,
    power: boolean,
    brightness?: number,
    color?: DeviceColor,
  ) => void;
}) {
  const [pending, setPending] = useState<{
    mode: Mode;
    reports: string;
  } | null>(null);
  const eligible = devices.filter(
    (d) => 'Controllable' in d.data && !isDeviceReadOnly(d),
  );
  const options = (
    [
      ['ct', 'CT'],
      ['hs', 'HSV'],
      ['xy', 'XY'],
    ] as const
  ).filter(
    ([mode]) =>
      eligible.length > 0 &&
      eligible.every(
        (d) =>
          'Controllable' in d.data &&
          Boolean(d.data.Controllable.capabilities[mode]),
      ),
  );
  const modes = eligible.map((d) =>
    'Controllable' in d.data
      ? activeMode(
          d.data.Controllable.last_report?.state.color ??
            d.data.Controllable.state.color,
        )
      : '',
  );
  const reports = JSON.stringify(
    eligible.map((d) =>
      'Controllable' in d.data
        ? d.data.Controllable.last_report?.received_at_ms
        : 0,
    ),
  );
  const mode =
    pending?.reports === reports
      ? pending.mode
      : modes.every((m) => m === modes[0])
        ? modes[0]
        : '';
  if (!options.length) return null;
  function change(mode: Mode) {
    setPending({ mode, reports });
    eligible.forEach((device) => {
      if (!('Controllable' in device.data)) return;
      const data = device.data.Controllable;
      const color = getColor(device.data);
      let converted: DeviceColor;
      if (mode === 'ct') {
        const range = data.capabilities.ct!;
        const previous = data.last_report?.state.color;
        converted = {
          ct: Math.round(
            Math.max(
              range.start,
              Math.min(
                range.end,
                previous && 'ct' in previous ? previous.ct : 4000,
              ),
            ),
          ),
        };
      } else if (mode === 'hs') {
        converted = {
          h: Math.round(color.hue()),
          s: color.saturationv() / 100,
        };
      } else {
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
        converted =
          x + y + z > 0
            ? { x: x / (x + y + z), y: y / (x + y + z) }
            : { x: 0.3127, y: 0.329 };
      }
      onChange(device, data.state.power, undefined, converted);
    });
  }
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>Color mode</span>
      <select
        aria-label="Color mode"
        className="min-h-10 rounded-md border border-border bg-background px-3"
        disabled={!connected}
        value={mode}
        onChange={(event) => change(event.target.value as Mode)}
      >
        <option value="" disabled>
          Mixed / unknown
        </option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
