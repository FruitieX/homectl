interface SensorReading {
  time: Date;
  value: number;
}

interface SensorStats {
  min: number;
  max: number;
  avg: number;
  current?: number;
  trend: 'up' | 'down' | 'stable';
  dataPoints: number;
  lastUpdate?: Date;
  minTime?: Date;
  maxTime?: Date;
  // Enhanced trend metadata (optional consumers)
  slopePerHour?: number; // linear regression slope (value/hour)
  netChange?: number; // net change over the analyzed window
  confidence?: number; // 0..1 heuristic confidence in trend classification
  pointsUsed?: number; // number of points used for trend calculation
}

// Options to tune trend detection
interface TrendOptions {
  windowMinutes: number; // how far back to look when computing trend
  minPoints: number; // minimum points required in window for regression
  slopeThresholdPerHour: number; // absolute slope threshold to consider non-stable
  netChangeThreshold: number; // minimum absolute net change in window
  adaptiveStdFactor?: number; // divide thresholds when volatility is low
  lowStdThreshold?: number; // std deviation below which we adapt
}

const defaultGenericTrendOptions: TrendOptions = {
  windowMinutes: 60,
  minPoints: 4,
  slopeThresholdPerHour: 0.25, // generic default
  netChangeThreshold: 0.2,
  adaptiveStdFactor: 2,
  lowStdThreshold: 0.3,
};

const temperatureTrendOptions: TrendOptions = {
  ...defaultGenericTrendOptions,
  slopeThresholdPerHour: 0.25, // °C per hour
  netChangeThreshold: 0.2, // °C
};

const humidityTrendOptions: TrendOptions = {
  ...defaultGenericTrendOptions,
  slopeThresholdPerHour: 1.0, // %RH per hour
  netChangeThreshold: 0.8, // %RH
};

// Internal helper to compute linear regression slope (value per ms)
function linearRegressionSlope(data: SensorReading[]): {
  slopePerMs: number;
  stdDev: number;
} {
  if (data.length === 0) return { slopePerMs: 0, stdDev: 0 };
  const times = data.map((d) => d.time.getTime());
  const values = data.map((d) => d.value);
  const meanT = times.reduce((a, b) => a + b, 0) / times.length;
  const meanV = values.reduce((a, b) => a + b, 0) / values.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < data.length; i++) {
    const dt = times[i] - meanT;
    num += dt * (values[i] - meanV);
    den += dt * dt;
  }
  const slopePerMs = den === 0 ? 0 : num / den; // value per millisecond
  // Std deviation of values (volatility)
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - meanV, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return { slopePerMs, stdDev };
}

function classifyTrend(
  windowData: SensorReading[],
  opts: TrendOptions,
): {
  trend: 'up' | 'down' | 'stable';
  slopePerHour: number;
  netChange: number;
  confidence: number;
  pointsUsed: number;
} {
  if (windowData.length < opts.minPoints) {
    return {
      trend: 'stable',
      slopePerHour: 0,
      netChange: 0,
      confidence: 0,
      pointsUsed: windowData.length,
    };
  }

  const sorted = [...windowData].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
  const { slopePerMs, stdDev } = linearRegressionSlope(sorted);
  const slopePerHour = slopePerMs * 1000 * 60 * 60; // value per hour
  const first = sorted[0].value;
  const last = sorted[sorted.length - 1].value;
  const netChange = last - first;

  // Adaptive thresholds if low volatility
  let slopeThreshold = opts.slopeThresholdPerHour;
  let netChangeThreshold = opts.netChangeThreshold;
  if (stdDev < (opts.lowStdThreshold ?? 0)) {
    const factor = opts.adaptiveStdFactor ?? 1;
    slopeThreshold /= factor;
    netChangeThreshold /= factor;
  }

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (
    Math.abs(slopePerHour) >= slopeThreshold &&
    Math.abs(netChange) >= netChangeThreshold
  ) {
    trend = slopePerHour > 0 ? 'up' : 'down';
  }

  // Confidence heuristic: combine normalized slope & net change, scaled 0..1
  const slopeComponent = Math.min(
    1,
    Math.abs(slopePerHour) / (opts.slopeThresholdPerHour * 2),
  );
  const changeComponent = Math.min(
    1,
    Math.abs(netChange) / (opts.netChangeThreshold * 2),
  );
  const confidence =
    trend === 'stable'
      ? 1 - (slopeComponent + changeComponent) / 2
      : (slopeComponent + changeComponent) / 2;

  return {
    trend,
    slopePerHour,
    netChange,
    confidence,
    pointsUsed: sorted.length,
  };
}

export const calculateSensorStats = (
  data: SensorReading[],
  trendOptions: TrendOptions = defaultGenericTrendOptions,
): SensorStats | null => {
  if (data.length === 0) {
    return null;
  }

  const values = data.map((d) => d.value);
  const sortedByTime = [...data].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

  const current = sortedByTime[sortedByTime.length - 1]?.value;
  const lastUpdate = sortedByTime[sortedByTime.length - 1]?.time;

  // Find timestamps for min and max values
  const minReading = data.find((d) => d.value === min);
  const maxReading = data.find((d) => d.value === max);
  const minTime = minReading?.time;
  const maxTime = maxReading?.time;

  // --- Enhanced trend detection ---
  let trend: 'up' | 'down' | 'stable' = 'stable';
  let slopePerHour: number | undefined;
  let netChange: number | undefined;
  let confidence: number | undefined;
  let pointsUsed: number | undefined;

  if (sortedByTime.length >= trendOptions.minPoints) {
    const windowStartTime = new Date(
      sortedByTime[sortedByTime.length - 1].time.getTime() -
        trendOptions.windowMinutes * 60 * 1000,
    );
    const windowData = sortedByTime.filter((d) => d.time >= windowStartTime);
    const classification = classifyTrend(windowData, trendOptions);
    trend = classification.trend;
    slopePerHour = classification.slopePerHour;
    netChange = classification.netChange;
    confidence = classification.confidence;
    pointsUsed = classification.pointsUsed;
  }

  return {
    min,
    max,
    avg,
    current,
    trend,
    dataPoints: data.length,
    lastUpdate,
    minTime,
    maxTime,
    slopePerHour,
    netChange,
    confidence,
    pointsUsed,
  };
};

export const calculateTemperatureStats = (
  data: SensorReading[],
): SensorStats | null => {
  return calculateSensorStats(data, temperatureTrendOptions);
};

export const calculateHumidityStats = (
  data: SensorReading[],
): SensorStats | null => {
  return calculateSensorStats(data, humidityTrendOptions);
};

export const formatStatValue = (
  value: number,
  unit: string,
  decimals: number = 1,
): string => {
  return `${value.toFixed(decimals)}${unit}`;
};

export const getTrendIcon = (
  trend: 'up' | 'down' | 'stable',
): string | null => {
  switch (trend) {
    case 'up':
      return '↗';
    case 'down':
      return '↘';
    case 'stable':
    default:
      return null;
  }
};

export const getTrendColor = (
  trend: 'up' | 'down' | 'stable',
  isTemperature: boolean = true,
): string => {
  if (trend === 'stable') return '#6b7280'; // gray

  if (isTemperature) {
    // For temperature: up = warmer (orange/red), down = cooler (blue)
    return trend === 'up' ? '#f59e0b' : '#3b82f6';
  } else {
    // For humidity: up = more humid (blue), down = drier (orange)
    return trend === 'up' ? '#3b82f6' : '#f59e0b';
  }
};

export const isOffline = (
  lastUpdate?: Date,
  thresholdMinutes: number = 15,
): boolean => {
  if (!lastUpdate) return true;
  const now = new Date();
  const diffMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
  return diffMinutes > thresholdMinutes;
};

export const getOfflineStatus = (
  lastUpdate?: Date,
): {
  isOffline: boolean;
  minutesAgo?: number;
  hoursAgo?: number;
} => {
  if (!lastUpdate) {
    return { isOffline: true };
  }

  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const minutesAgo = Math.floor(diffMs / (1000 * 60));
  const hoursAgo = Math.floor(minutesAgo / 60);

  return {
    isOffline: minutesAgo > 15,
    minutesAgo: minutesAgo <= 60 ? minutesAgo : undefined,
    hoursAgo: hoursAgo > 0 ? hoursAgo : undefined,
  };
};
