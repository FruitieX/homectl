import type { ColorCalibrationPoint } from '@/bindings/ColorCalibrationPoint';
import type { ColorCalibrationProfile } from '@/bindings/ColorCalibrationProfile';
import type { Hs } from '@/bindings/Hs';
import type { DeviceColor } from '@/bindings/DeviceColor';
import type { Device } from '@/bindings/Device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';

type Uv = ColorCalibrationPoint['reference'];
type HsCalibrationPoint = { reference: Hs; output: Hs };

export type MatchingPoint = HsCalibrationPoint & {
  label: string;
  matched: boolean;
};

export function hsToRgb(color: Hs): [number, number, number] {
  const hue = ((color.h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, color.s));
  const chroma = saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const sector = Math.floor(hue / 60);
  const [r, g, b] =
    sector === 0
      ? [chroma, x, 0]
      : sector === 1
        ? [x, chroma, 0]
        : sector === 2
          ? [0, chroma, x]
          : sector === 3
            ? [0, x, chroma]
            : sector === 4
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = 1 - chroma;
  return [r + m, g + m, b + m];
}

function rgbToXy(red: number, green: number, blue: number) {
  const linear = (channel: number) => {
    const value = Math.max(0, Math.min(1, channel));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(red),
    g = linear(green),
    b = linear(blue);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const sum = x + y + z;
  return sum > Number.EPSILON
    ? { x: x / sum, y: y / sum }
    : { x: 0.3127, y: 0.329 };
}

function xyToRgb(color: { x: number; y: number }): [number, number, number] {
  const x = Math.max(0, Math.min(1, color.x));
  const y = Math.max(0.000001, Math.min(1, color.y));
  const z = Math.max(0, 1 - x - y);
  const xyzX = x / y,
    xyzY = 1,
    xyzZ = z / y;
  let r = Math.max(0, 3.2404542 * xyzX - 1.5371385 * xyzY - 0.4985314 * xyzZ);
  let g = Math.max(0, -0.969266 * xyzX + 1.8760108 * xyzY + 0.041556 * xyzZ);
  let b = Math.max(0, 0.0556434 * xyzX - 0.2040259 * xyzY + 1.0572252 * xyzZ);
  const max = Math.max(r, g, b);
  if (!Number.isFinite(max) || max <= Number.EPSILON) return [1, 1, 1];
  r /= max;
  g /= max;
  b /= max;
  const gamma = (channel: number) =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return [gamma(r), gamma(g), gamma(b)];
}

function xyToUv(color: { x: number; y: number }): Uv {
  const denominator = -2 * color.x + 12 * color.y + 3;
  return { u: (4 * color.x) / denominator, v: (9 * color.y) / denominator };
}

function uvToXy(color: Uv) {
  const denominator = 6 * color.u - 16 * color.v + 12;
  return { x: (9 * color.u) / denominator, y: (4 * color.v) / denominator };
}

export function hsToUv(color: Hs): Uv {
  return xyToUv(rgbToXy(...hsToRgb(color)));
}

export function uvToHs(color: Uv): Hs {
  const [r, g, b] = xyToRgb(uvToXy(color));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0.000001) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return {
    h: Math.round((hue + 360) % 360) % 360,
    s: max <= Number.EPSILON ? 0 : delta / max,
  };
}

export function calibrationPointToUv(
  point: HsCalibrationPoint,
): ColorCalibrationPoint {
  return { reference: hsToUv(point.reference), output: hsToUv(point.output) };
}

export function matchingPointsFromProfile(
  profile: ColorCalibrationProfile,
): MatchingPoint[] {
  return profile.points.map((point, index) => ({
    label: `Point ${index + 1}`,
    reference: uvToHs(point.reference),
    output: uvToHs(point.output),
    matched: true,
  }));
}

export function getCurrentHsColor(device: Device): Hs | null {
  if (!('Controllable' in device.data)) return null;
  const color = device.data.Controllable.state.color;
  return color ? deviceColorToHs(color) : null;
}

function deviceColorToHs(color: DeviceColor): Hs | null {
  if ('ct' in color) return null;
  if ('h' in color) return { ...color };
  const xy =
    'x' in color ? color : rgbToXy(color.r / 255, color.g / 255, color.b / 255);
  return uvToHs(xyToUv(xy));
}

export function canAmendReferencePoint(
  current: Hs | null,
  points: HsCalibrationPoint[],
  index: number,
): boolean {
  return Boolean(
    current &&
      points.every(
        (point, pointIndex) =>
          pointIndex === index ||
          point.reference.h !== current.h ||
          point.reference.s !== current.s,
      ),
  );
}

export function stepCalibrationValue(
  value: number,
  delta: number,
  min: number,
  max: number,
  precision = 1,
): number {
  const stepped = Math.round((value + delta) * precision) / precision;
  return Math.max(min, Math.min(max, stepped));
}

function sameHs(left: Hs, right: Hs): boolean {
  return left.h === right.h && left.s === right.s;
}

export function pointForCurrentReference(
  points: MatchingPoint[],
  current: Hs,
): { point: MatchingPoint; index: number } {
  const existingIndex = points.findIndex((point) =>
    sameHs(point.reference, current),
  );
  if (existingIndex >= 0) {
    const existing = points[existingIndex];
    return {
      index: existingIndex,
      point: {
        ...existing,
        reference: { ...existing.reference },
        output: { ...existing.output },
        matched: false,
      },
    };
  }

  return {
    index: points.length,
    point: {
      label: `Point ${points.length + 1}`,
      reference: { ...current },
      output: calibratedHsv(current, points),
      matched: false,
    },
  };
}

export function nextManualCalibrationPoint(
  points: HsCalibrationPoint[],
  preferred: Hs | null = null,
): MatchingPoint {
  const candidates = [
    ...(preferred ? [preferred] : []),
    ...suggestedMatchingPoints().map((point) => point.reference),
    ...Array.from({ length: 360 }, (_, h) => ({ h, s: 0.5 })),
  ];
  const reference = candidates.find(
    (candidate) => !points.some((point) => sameHs(point.reference, candidate)),
  ) ?? { h: 0, s: 0 };
  return {
    label: `Point ${points.length + 1}`,
    reference: { ...reference },
    output: { ...reference },
    matched: false,
  };
}

export function removeCalibrationPoint(
  points: MatchingPoint[],
  index: number,
): { points: MatchingPoint[]; index: number } {
  if (points.length <= 1 || index < 0 || index >= points.length)
    return { points, index };
  const remaining = points.filter((_, pointIndex) => pointIndex !== index);
  return { points: remaining, index: Math.min(index, remaining.length - 1) };
}

export function suggestedMatchingPoints(): MatchingPoint[] {
  const colors: { label: string; color: Hs }[] = [
    { label: 'Neutral white', color: { h: 0, s: 0 } },
    { label: 'Warm white', color: { h: 30, s: 0.25 } },
    { label: 'Cool white', color: { h: 210, s: 0.12 } },
    { label: 'Red', color: { h: 0, s: 1 } },
    { label: 'Green', color: { h: 120, s: 1 } },
    { label: 'Cyan', color: { h: 180, s: 1 } },
    { label: 'Blue', color: { h: 240, s: 1 } },
    { label: 'Soft orange', color: { h: 30, s: 0.45 } },
  ];
  return colors.map(({ label, color }) => ({
    label,
    reference: { ...color },
    output: { ...color },
    matched: false,
  }));
}

export const verificationColors = [
  { label: 'Orange', color: { h: 30, s: 0.7 } },
  { label: 'Mint', color: { h: 150, s: 0.7 } },
  { label: 'Sky blue', color: { h: 210, s: 0.7 } },
  { label: 'Violet', color: { h: 270, s: 0.7 } },
];

// Match the server interpolation when testing between measured anchors.
export function calibratedHsv(input: Hs, points: HsCalibrationPoint[]): Hs {
  if (!points.length) return { ...input };
  const position = hsToUv;
  const { u, v } = position(input);
  let weights = 0,
    du = 0,
    dv = 0;
  for (const point of points) {
    const reference = position(point.reference);
    const output = position(point.output);
    const distance = (u - reference.u) ** 2 + (v - reference.v) ** 2;
    if (distance < 1e-8) return { ...point.output };
    const weight = 1 / distance;
    weights += weight;
    du += weight * (output.u - reference.u);
    dv += weight * (output.v - reference.v);
  }
  if (du === 0 && dv === 0) return { ...input };
  const correction = { u: du / weights, v: dv / weights };
  let candidate = { u: u + correction.u, v: v + correction.v };
  const isValid = (color: Uv) => {
    const xy = uvToXy(color);
    return (
      Number.isFinite(xy.x) &&
      Number.isFinite(xy.y) &&
      xy.x >= 0 &&
      xy.y > 0 &&
      xy.x + xy.y <= 1
    );
  };
  if (!isValid(candidate)) {
    let low = 0,
      high = 1;
    candidate = { u, v };
    for (let index = 0; index < 20; index += 1) {
      const amount = (low + high) / 2;
      const projected = {
        u: u + correction.u * amount,
        v: v + correction.v * amount,
      };
      if (isValid(projected)) {
        candidate = projected;
        low = amount;
      } else high = amount;
    }
  }
  return uvToHs(candidate);
}

export function canCalibrateDevice(device: Device): boolean {
  return (
    'Controllable' in device.data &&
    Boolean(
      device.data.Controllable.capabilities.hs ||
        device.data.Controllable.capabilities.rgb ||
        device.data.Controllable.capabilities.xy,
    ) &&
    !isDeviceReadOnly(device)
  );
}

export function toggleSelection(
  selected: string[],
  visibleKeys: string[],
): string[] {
  const allSelected =
    visibleKeys.length > 0 &&
    visibleKeys.every((key) => selected.includes(key));
  return allSelected
    ? selected.filter((key) => !visibleKeys.includes(key))
    : [...new Set([...selected, ...visibleKeys])];
}

export function toggleSelectedKey(selected: string[], key: string): string[] {
  return selected.includes(key)
    ? selected.filter((selectedKey) => selectedKey !== key)
    : [...selected, key];
}
