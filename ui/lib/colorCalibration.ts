import type { ColorCalibrationPoint } from '@/bindings/ColorCalibrationPoint';
import type { ColorCalibrationProfile } from '@/bindings/ColorCalibrationProfile';
import type { Hs } from '@/bindings/Hs';
import type { Device } from '@/bindings/Device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';

export type MatchingPoint = ColorCalibrationPoint & {
  label: string;
  matched: boolean;
};

export function matchingPointsFromProfile(
  profile: ColorCalibrationProfile,
): MatchingPoint[] {
  return profile.points.map((point, index) => ({
    label: `Point ${index + 1}`,
    reference: { ...point.reference },
    output: { ...point.output },
    matched: true,
  }));
}

export function getCurrentHsColor(device: Device): Hs | null {
  if (!('Controllable' in device.data)) return null;
  const color = device.data.Controllable.state.color;
  return color && 'h' in color && 's' in color ? { ...color } : null;
}

export function canAmendReferencePoint(
  current: Hs | null,
  points: ColorCalibrationPoint[],
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

export function nextManualCalibrationPoint(
  points: ColorCalibrationPoint[],
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
  ];
  const names = ['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta'];
  for (const saturation of [1, 0.45]) {
    names.forEach((name, index) =>
      colors.push({
        label: saturation === 1 ? name : `Soft ${name.toLowerCase()}`,
        color: { h: index * 60, s: saturation },
      }),
    );
  }
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
export function calibratedHsv(input: Hs, points: ColorCalibrationPoint[]): Hs {
  if (!points.length) return { ...input };
  const position = (color: Hs) => [
    color.s * Math.cos((color.h * Math.PI) / 180),
    color.s * Math.sin((color.h * Math.PI) / 180),
  ];
  const [x, y] = position(input);
  let weights = 0,
    dx = 0,
    dy = 0;
  for (const point of points) {
    const [px, py] = position(point.reference);
    const distance = (x - px) ** 2 + (y - py) ** 2;
    if (distance < 1e-8) return { ...point.output };
    const weight = 1 / distance;
    weights += weight;
    const [ox, oy] = position(point.output);
    dx += weight * (ox - px);
    dy += weight * (oy - py);
  }
  if (dx === 0 && dy === 0) return { ...input };
  const ox = x + dx / weights;
  const oy = y + dy / weights;
  return {
    h: Math.round(((Math.atan2(oy, ox) * 180) / Math.PI + 360) % 360) % 360,
    s: Math.min(1, Math.hypot(ox, oy)),
  };
}

export function canCalibrateDevice(device: Device): boolean {
  return (
    'Controllable' in device.data &&
    device.data.Controllable.capabilities.hs &&
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
