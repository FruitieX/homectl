import type { ColorCalibrationPoint } from '@/bindings/ColorCalibrationPoint';
import type { Hs } from '@/bindings/Hs';
import type { Integration } from '@/hooks/useConfig';

function hsv(value: unknown): Hs {
  if (
    !value ||
    typeof value !== 'object' ||
    !('h' in value) ||
    !('s' in value) ||
    typeof value.h !== 'number' ||
    typeof value.s !== 'number' ||
    !Number.isFinite(value.h) ||
    !Number.isFinite(value.s) ||
    value.h < 0 ||
    value.h > 360 ||
    value.s < 0 ||
    value.s > 1
  ) {
    throw new Error(
      'Both circadian profiles must have HSV day and night colors.',
    );
  }
  return { h: Math.round(value.h) % 360, s: value.s };
}

export function seedCircadianCalibration(
  reference: Integration,
  output: Integration,
): ColorCalibrationPoint[] {
  const points = ['day_color', 'night_color'].map((key) => ({
    reference: hsv(reference.config[key]),
    output: hsv(output.config[key]),
  }));
  if (
    points[0].reference.h === points[1].reference.h &&
    points[0].reference.s === points[1].reference.s
  ) {
    throw new Error(
      'The reference profile needs distinct day and night colors.',
    );
  }
  return points;
}
