import type { DeviceColor as WireDeviceColor } from '@/bindings/DeviceColor';

/**
 * One place that understands the wire format of a device colour.
 *
 * The server sends `DeviceColor` as an untagged union (`server/src/types/color.rs`
 * with serde untagged): `{ h, s }`, `{ r, g, b }`, `{ x, y }`, or `{ ct }`.
 * Nothing may assume a tagged shape like `{ Hs: ... }` — a saved HS target must
 * survive load, edit, save, and reload unchanged.
 */
export type DeviceColorMode = 'hs' | 'rgb' | 'xy' | 'ct';

/** The generated binding, so this module and the API agree by construction. */
export type DeviceColor = WireDeviceColor;

/** A loose shape for values coming from JSON before they are validated. */
export type RawDeviceColor = Record<string, unknown> | null | undefined;

export function isDeviceColor(value: unknown): value is DeviceColor {
  const mode = getColorMode(value as RawDeviceColor);
  if (!mode) return false;
  const parts = colorParts(value as DeviceColor);
  return parts.every((part) => Number.isFinite(part.value));
}

export function getColorMode(
  color: RawDeviceColor,
): DeviceColorMode | undefined {
  if (!color || typeof color !== 'object') return undefined;
  if ('h' in color && 's' in color) return 'hs';
  if ('r' in color && 'g' in color && 'b' in color) return 'rgb';
  if ('x' in color && 'y' in color) return 'xy';
  if ('ct' in color) return 'ct';
  return undefined;
}

export type ColorPart = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** How the raw value reads in the field, e.g. degrees or percent. */
  display: number;
  unit?: string;
};

/** The editable numbers of a colour, in the units the fields show. */
export function colorParts(color: DeviceColor): ColorPart[] {
  const mode = getColorMode(color);
  const numbers = color as Record<string, number>;
  switch (mode) {
    case 'hs':
      return [
        {
          key: 'h',
          label: 'Hue',
          min: 0,
          max: 360,
          step: 1,
          value: numbers.h,
          display: Math.round(numbers.h),
          unit: '°',
        },
        {
          key: 's',
          label: 'Saturation',
          min: 0,
          max: 100,
          step: 1,
          value: numbers.s,
          display: Math.round(numbers.s * 100),
          unit: '%',
        },
      ];
    case 'rgb':
      return [
        {
          key: 'r',
          label: 'Red',
          min: 0,
          max: 255,
          step: 1,
          value: numbers.r,
          display: Math.round(numbers.r),
        },
        {
          key: 'g',
          label: 'Green',
          min: 0,
          max: 255,
          step: 1,
          value: numbers.g,
          display: Math.round(numbers.g),
        },
        {
          key: 'b',
          label: 'Blue',
          min: 0,
          max: 255,
          step: 1,
          value: numbers.b,
          display: Math.round(numbers.b),
        },
      ];
    case 'xy':
      return [
        {
          key: 'x',
          label: 'x',
          min: 0,
          max: 1,
          step: 0.001,
          value: numbers.x,
          display: numbers.x,
        },
        {
          key: 'y',
          label: 'y',
          min: 0,
          max: 1,
          step: 0.001,
          value: numbers.y,
          display: numbers.y,
        },
      ];
    case 'ct':
      return [
        {
          key: 'ct',
          label: 'Colour temperature',
          min: 153,
          max: 500,
          step: 1,
          value: numbers.ct,
          display: Math.round(numbers.ct),
          unit: ' mired',
        },
      ];
    default:
      return [];
  }
}

/** Replace one number of a colour, keeping the same (untagged) variant. */
export function withColorPart(
  color: DeviceColor,
  key: string,
  displayValue: number,
): DeviceColor {
  const mode = getColorMode(color);
  const numbers = { ...(color as Record<string, number>) };
  if (key === 's') {
    numbers.s = Math.min(1, Math.max(0, displayValue / 100));
  } else {
    numbers[key] = displayValue;
  }
  void mode;
  return numbers as unknown as DeviceColor;
}

/** A valid starting value for a mode the user just switched to. */
export function defaultColorFor(mode: DeviceColorMode): DeviceColor {
  switch (mode) {
    case 'hs':
      return { h: 32, s: 0.4 };
    case 'rgb':
      return { r: 255, g: 207, b: 153 };
    case 'xy':
      return { x: 0.46, y: 0.41 };
    case 'ct':
      return { ct: 250 };
  }
}

function hsToRgb(
  h: number,
  s: number,
  l = 0.5,
): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Approximate sRGB for an XY value, using the sRGB D65 matrix. */
export function xyToRgb(
  x: number,
  y: number,
): { r: number; g: number; b: number } {
  if (y <= 0) return { r: 0, g: 0, b: 0 };
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;
  const r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  const g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  const b = X * 0.0557 + Y * -0.204 + Z * 1.057;
  const gamma = (value: number) =>
    Math.round(
      255 *
        (value <= 0.0031308
          ? 12.92 * value
          : 1.055 * value ** (1 / 2.4) - 0.055),
    );
  return {
    r: Math.min(255, Math.max(0, gamma(r))),
    g: Math.min(255, Math.max(0, gamma(g))),
    b: Math.min(255, Math.max(0, gamma(b))),
  };
}

/** The colour as sRGB bytes, for previews and swatches. */
export function colorToRgb(color: DeviceColor): {
  r: number;
  g: number;
  b: number;
} {
  const mode = getColorMode(color);
  const numbers = color as Record<string, number>;
  switch (mode) {
    case 'hs':
      return hsToRgb(numbers.h, numbers.s);
    case 'rgb':
      return {
        r: Math.round(numbers.r),
        g: Math.round(numbers.g),
        b: Math.round(numbers.b),
      };
    case 'xy':
      return xyToRgb(numbers.x, numbers.y);
    case 'ct': {
      // Mireds to a warm/cool approximation, 153 mired (6500K) .. 500 (2000K).
      const warmth = Math.min(1, Math.max(0, (numbers.ct - 153) / (500 - 153)));
      return {
        r: Math.round(255 - warmth * 55),
        g: Math.round(240 - warmth * 30),
        b: Math.round(255 - warmth * 195),
      };
    }
    default:
      return { r: 128, g: 128, b: 128 };
  }
}

export function colorToCss(color: DeviceColor, brightness = 1): string {
  const { r, g, b } = colorToRgb(color);
  const scale = Math.min(1, Math.max(0, brightness));
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}

function hueName(h: number): string {
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 290) return 'purple';
  if (h < 345) return 'pink';
  return 'red';
}

/** A short accessible name for the colour, never the only carrier of meaning. */
export function describeColorName(color: DeviceColor): string {
  const mode = getColorMode(color);
  const numbers = color as Record<string, number>;
  switch (mode) {
    case 'hs': {
      if (numbers.s < 0.18) {
        return numbers.h <= 90 || numbers.h >= 300
          ? 'warm white'
          : 'cool white';
      }
      return hueName(numbers.h);
    }
    case 'rgb': {
      const max = Math.max(numbers.r, numbers.g, numbers.b);
      const min = Math.min(numbers.r, numbers.g, numbers.b);
      if (max - min < 24) return max > 200 ? 'white' : 'grey';
      const { r, g, b } = colorToRgb(color);
      const hue = rgbToHue(r, g, b);
      return hueName(hue);
    }
    case 'xy':
      return 'colour from a colour point';
    case 'ct': {
      const ct = numbers.ct;
      if (ct <= 200) return 'cool white';
      if (ct >= 350) return 'warm white';
      return 'soft white';
    }
    default:
      return 'colour';
  }
}

function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The exact values, for a tooltip or an "exact values" disclosure. */
export function formatColorExact(color: DeviceColor): string {
  const mode = getColorMode(color);
  const numbers = color as Record<string, number>;
  switch (mode) {
    case 'hs':
      return `h ${Math.round(numbers.h)}° · s ${Math.round(numbers.s * 100)}%`;
    case 'rgb':
      return `rgb ${Math.round(numbers.r)} ${Math.round(numbers.g)} ${Math.round(numbers.b)}`;
    case 'xy':
      return `x ${numbers.x.toFixed(3)} · y ${numbers.y.toFixed(3)}`;
    case 'ct':
      return `${Math.round(numbers.ct)} mired`;
    default:
      return 'no colour';
  }
}

export const COLOR_MODE_LABELS: Record<DeviceColorMode, string> = {
  hs: 'Hue and saturation',
  rgb: 'Red, green, blue',
  xy: 'Colour point (x, y)',
  ct: 'Colour temperature',
};
