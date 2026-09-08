export interface SpotPriceThresholds {
  low: number;
  medium: number;
  high: number;
}

export const DEFAULT_SPOT_PRICE_THRESHOLDS: SpotPriceThresholds = {
  low: 2,
  medium: 5,
  high: 8,
};

const COLORS = [
  [58, 168, 82], // green
  [225, 166, 44], // amber
  [218, 83, 70], // red
] as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const interpolate = (
  from: readonly number[],
  to: readonly number[],
  amount: number,
) =>
  from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  );

export function normalizeSpotPriceThresholds(
  thresholds: Partial<SpotPriceThresholds>,
): SpotPriceThresholds {
  const defaults = [
    DEFAULT_SPOT_PRICE_THRESHOLDS.low,
    DEFAULT_SPOT_PRICE_THRESHOLDS.medium,
    DEFAULT_SPOT_PRICE_THRESHOLDS.high,
  ];
  const values = [thresholds.low, thresholds.medium, thresholds.high]
    .map((value, index) =>
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : defaults[index],
    )
    .sort((a, b) => a - b);

  return { low: values[0], medium: values[1], high: values[2] };
}

/** Returns a smooth green → amber → red color for a price in c/kWh. */
export function getSpotPriceColor(
  value: number,
  thresholds: SpotPriceThresholds = DEFAULT_SPOT_PRICE_THRESHOLDS,
) {
  const { low, medium, high } = normalizeSpotPriceThresholds(thresholds);
  const color =
    value <= medium
      ? interpolate(
          COLORS[0],
          COLORS[1],
          clamp((value - low) / Math.max(0.001, medium - low)),
        )
      : interpolate(
          COLORS[1],
          COLORS[2],
          clamp((value - medium) / Math.max(0.001, high - medium)),
        );

  return `rgb(${color.join(', ')})`;
}
