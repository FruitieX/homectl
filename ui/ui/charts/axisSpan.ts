/**
 * Small ranges say nothing on their own: a 0.2 °C wobble drawn across a full
 * chart reads as a dramatic swing. Every scale therefore has a floor — the
 * axis is never zoomed in past this span — so a flat reading looks flat.
 */
export const MINIMUM_TEMPERATURE_SPAN_C = 2;
export const MINIMUM_TEMPERATURE_SPAN_F = 3.6;
export const MINIMUM_HUMIDITY_SPAN_PERCENT = 5;

export function minimumSpanForUnit(unit: string): number {
  switch (unit) {
    case '°C':
      return MINIMUM_TEMPERATURE_SPAN_C;
    case '°F':
      return MINIMUM_TEMPERATURE_SPAN_F;
    case '%':
      return MINIMUM_HUMIDITY_SPAN_PERCENT;
    default:
      return 0;
  }
}

/** Widen `[low, high]` about its centre until it spans at least `minSpan`. */
export function enforceMinimumSpan(
  low: number,
  high: number,
  minSpan: number,
): [number, number] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || minSpan <= 0) {
    return [low, high];
  }
  if (high - low >= minSpan) return [low, high];
  const center = (low + high) / 2;
  return [center - minSpan / 2, center + minSpan / 2];
}
