interface SensorReading {
  time: Date;
  value: number;
}
export type SensorTrend = 'up' | 'down' | 'stable' | 'unknown';
interface TrendOptions {
  windowMinutes: number;
  minPoints: number;
  slopeThresholdPerHour: number;
  netChangeThreshold: number;
}
const generic: TrendOptions = {
  windowMinutes: 60,
  minPoints: 4,
  slopeThresholdPerHour: 0.25,
  netChangeThreshold: 0.2,
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateSensorStats(
  data: SensorReading[],
  options: TrendOptions = generic,
  now = Date.now(),
) {
  const rows = [
    ...new Map(
      data
        .filter(
          (p) =>
            Number.isFinite(p.value) &&
            Number.isFinite(p.time.getTime()) &&
            p.time.getTime() <= now,
        )
        .map((p) => [p.time.getTime(), p]),
    ).values(),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());
  if (!rows.length) return null;
  const latest = rows.at(-1)!;
  // Equal five-minute bins prevent bursts of samples from dominating the trend.
  const bins = new Map<number, number[]>();
  for (const row of rows.filter(
    (p) => p.time.getTime() >= now - options.windowMinutes * 60000,
  )) {
    const bin = Math.floor(row.time.getTime() / 300000);
    bins.set(bin, [...(bins.get(bin) ?? []), row.value]);
  }
  const points = [...bins].map(([bin, values]) => ({
    time: bin * 300000,
    value: median(values),
  }));
  let trend: SensorTrend = 'unknown',
    slopePerHour = 0,
    netChange = 0,
    confidence = 0;
  if (
    points.length >= options.minPoints &&
    points.at(-1)!.time - points[0].time >= 30 * 60000 &&
    !isOffline(latest.time, 15, now) &&
    points.every((p, i) => !i || p.time - points[i - 1].time <= 20 * 60000)
  ) {
    const slopes: number[] = [];
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const elapsed = points[j].time - points[i].time;
        if (elapsed >= 600000)
          slopes.push(
            ((points[j].value - points[i].value) * 3600000) / elapsed,
          );
      }
    slopePerHour = median(slopes);
    const count = Math.max(2, Math.floor(points.length / 3));
    netChange =
      median(points.slice(-count).map((p) => p.value)) -
      median(points.slice(0, count).map((p) => p.value));
    const agreement =
      slopes.filter((s) => Math.sign(s) === Math.sign(slopePerHour)).length /
      slopes.length;
    const meaningful =
      Math.abs(slopePerHour) >= options.slopeThresholdPerHour &&
      Math.abs(netChange) >= options.netChangeThreshold &&
      Math.sign(slopePerHour) === Math.sign(netChange) &&
      agreement >= 0.75;
    trend = meaningful ? (slopePerHour > 0 ? 'up' : 'down') : 'stable';
    confidence = agreement;
  }
  const minRow = rows.reduce((a, b) => (a.value <= b.value ? a : b)),
    maxRow = rows.reduce((a, b) => (a.value >= b.value ? a : b));
  return {
    min: minRow.value,
    max: maxRow.value,
    avg: rows.reduce((sum, p) => sum + p.value, 0) / rows.length,
    current: latest.value,
    trend,
    dataPoints: rows.length,
    lastUpdate: latest.time,
    minTime: minRow.time,
    maxTime: maxRow.time,
    slopePerHour,
    netChange,
    confidence,
    pointsUsed: points.length,
  };
}
export const calculateTemperatureStats = (
  data: SensorReading[],
  now = Date.now(),
) => calculateSensorStats(data, generic, now);
export const calculateHumidityStats = (
  data: SensorReading[],
  now = Date.now(),
) =>
  calculateSensorStats(
    data,
    { ...generic, slopeThresholdPerHour: 1, netChangeThreshold: 0.8 },
    now,
  );
export const formatStatValue = (value: number, unit: string, decimals = 1) =>
  `${value.toFixed(decimals)}${unit}`;
export const getTrendIcon = (trend: SensorTrend) =>
  trend === 'up' ? '↗' : trend === 'down' ? '↘' : null;
export const getTrendColor = (_trend: SensorTrend, _isTemperature = true) =>
  'currentColor';
export const isOffline = (
  lastUpdate?: Date,
  thresholdMinutes = 15,
  now = Date.now(),
) =>
  !lastUpdate ||
  !Number.isFinite(lastUpdate.getTime()) ||
  lastUpdate.getTime() > now ||
  now - lastUpdate.getTime() > thresholdMinutes * 60000;
export function getOfflineStatus(lastUpdate?: Date) {
  if (!lastUpdate || !Number.isFinite(lastUpdate.getTime()))
    return { isOffline: true };
  const minutesAgo = Math.max(
      0,
      Math.floor((Date.now() - lastUpdate.getTime()) / 60000),
    ),
    hoursAgo = Math.floor(minutesAgo / 60);
  return {
    isOffline: minutesAgo > 15,
    minutesAgo: minutesAgo <= 60 ? minutesAgo : undefined,
    hoursAgo: hoursAgo > 0 ? hoursAgo : undefined,
  };
}
