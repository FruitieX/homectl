export function latestTemperature(
  rows: { device_id: string; _field: string; _time: Date; _value: number }[],
  id: string,
  now = Date.now(),
) {
  return rows
    .filter(
      (row) =>
        row.device_id === id &&
        row._field === 'tempc' &&
        Number.isFinite(row._value) &&
        row._time.getTime() <= now &&
        now - row._time.getTime() <= 30 * 60000,
    )
    .sort((a, b) => b._time.getTime() - a._time.getTime())[0]?._value;
}

export function priceWindow(
  rows: { _time: Date; _value: number }[],
  now = Date.now(),
) {
  const sorted = [
    ...new Map(
      rows
        .filter(
          (row) =>
            Number.isFinite(row._value) &&
            Number.isFinite(new Date(row._time).getTime()),
        )
        .map((row) => [new Date(row._time).getTime(), row._value]),
    ).entries(),
  ].sort((a, b) => a[0] - b[0]);
  const gaps = sorted
    .slice(1)
    .map(([time], index) => time - sorted[index][0])
    .filter((gap) => gap > 0 && gap <= 3600000)
    .slice(-7)
    .sort((a, b) => a - b);
  const interval = gaps[Math.floor(gaps.length / 2)] ?? 3600000;
  const data = sorted
    .map(([time, value], index) => ({
      time,
      value,
      end: Math.min(sorted[index + 1]?.[0] ?? time + interval, time + interval),
      fill: 'currentColor',
    }))
    .filter((p) => p.end > now && p.time < now + 86400000)
    .map((p) => ({ ...p, end: Math.min(p.end, now + 86400000) }));
  const current = data.find((p) => p.time <= now && p.end > now);
  const duration = data.reduce(
    (sum, p) => sum + p.end - Math.max(now, p.time),
    0,
  );
  return {
    data,
    current,
    average:
      duration > 0
        ? data.reduce(
            (sum, p) => sum + p.value * (p.end - Math.max(now, p.time)),
            0,
          ) / duration
        : undefined,
  };
}

export type ForecastPeriod = {
  details: {
    precipitation_amount?: number;
    precipitation_amount_max?: number;
    precipitation_amount_min?: number;
  };
};
export function precipitationPeriods(
  rows: {
    time: Date | string;
    data: { next_1_hours?: ForecastPeriod; next_6_hours?: ForecastPeriod };
  }[],
) {
  let coveredUntil = -Infinity;
  return [...rows]
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .flatMap((row) => {
      const time = new Date(row.time),
        start = time.getTime();
      const period = row.data.next_1_hours ?? row.data.next_6_hours;
      if (
        !period ||
        period.details.precipitation_amount === undefined ||
        start < coveredUntil
      )
        return [];
      const hours = row.data.next_1_hours ? 1 : 6;
      coveredUntil = start + hours * 3600000;
      return [
        {
          time,
          period_hours: hours,
          precipitation_amount: period.details.precipitation_amount,
          precipitation_amount_max: period.details.precipitation_amount_max,
          precipitation_amount_min: period.details.precipitation_amount_min,
        },
      ];
    });
}
