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
}

export const calculateSensorStats = (
  data: SensorReading[],
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

  // Calculate trend based on last few readings
  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (sortedByTime.length >= 3) {
    const recent = sortedByTime.slice(-6);
    const firstRecent = recent[0].value;
    const lastRecent = recent[recent.length - 1].value;
    const diff = lastRecent - firstRecent;

    // Only consider significant changes
    if (Math.abs(diff) > 1) {
      trend = diff > 0 ? 'up' : 'down';
    }
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
  };
};

export const calculateTemperatureStats = (
  data: SensorReading[],
): SensorStats | null => {
  return calculateSensorStats(data);
};

export const calculateHumidityStats = (
  data: SensorReading[],
): SensorStats | null => {
  return calculateSensorStats(data);
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
