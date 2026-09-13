export const DEFAULT_MAX_MINUTES_AHEAD = 100;
export const MAX_MAX_MINUTES_AHEAD = 24 * 60;

export function normalizeMaxMinutesAhead(
  value: number,
  fallback = DEFAULT_MAX_MINUTES_AHEAD,
) {
  const normalizedFallback = Number.isFinite(fallback)
    ? Math.min(MAX_MAX_MINUTES_AHEAD, Math.max(0, fallback))
    : DEFAULT_MAX_MINUTES_AHEAD;

  if (!Number.isFinite(value)) {
    return normalizedFallback;
  }

  return Math.min(MAX_MAX_MINUTES_AHEAD, Math.max(0, value));
}

type DepartureWithTimestamp = {
  departureAt?: number;
};

export function filterDeparturesWithinHorizon<T extends DepartureWithTimestamp>(
  trains: readonly T[],
  now: number,
  maxMinutesAhead: number,
) {
  const horizonMs = normalizeMaxMinutesAhead(maxMinutesAhead) * 60 * 1000;

  return trains.filter((train) => {
    if (
      typeof train.departureAt !== 'number' ||
      !Number.isFinite(train.departureAt)
    ) {
      return true;
    }

    return train.departureAt * 1000 - now <= horizonMs;
  });
}
