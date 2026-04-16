import { useEffect, useState, useMemo } from 'react';
import { useInterval } from 'usehooks-ts';
import { useAppConfig } from './appConfig';
import { resolveDashboardWidgetUrl } from './useDashboard';

interface SensorRow {
  device_id: string;
  integration_id: string;
  _time: Date;
  _value: number;
  _field: SensorField;
}

type SensorField = 'tempc' | 'hum';

interface RawSensorRow {
  device_id: string;
  integration_id: string;
  _time: string;
  _value: number | string;
  _field: SensorField;
}

interface SensorData {
  device_id: string;
  device_name: string;
  latest_temp?: number;
  latest_humidity?: number;
  latest_temp_time?: Date;
  latest_humidity_time?: Date;
  temp_data: Array<{ time: Date; value: number }>;
  humidity_data: Array<{ time: Date; value: number }>;
  is_priority: boolean;
  is_indoor: boolean;
  color: string;
}

// Mapping from device_id to sensor name (duplicated from API route)
const DEVICE_ID_TO_NAME: Record<string, string> = {
  D83431306571: 'Bathroom',
  C76A05062842: 'Bedroom',
  D83535301C43: 'Upstairs office',
  D7353530520F: 'Kids room',
  D63534385106: 'Office',
  D7353530665A: 'Living room',
  CE2A82463674: 'Downstairs bathroom',
  D9353438450D: 'Backyard',
  D4343037362D: 'Patio',
  C76A0246647E: 'Car',
  D83534387029: 'Front yard',
  C76A03460A73: 'Storage',
};

const INDOOR_SENSORS = [
  'D83431306571', // Bathroom
  'C76A05062842', // Bedroom
  'D83535301C43', // Upstairs office
  'D7353530520F', // Kids room
  'D63534385106', // Office
  'D7353530665A', // Living room
  'CE2A82463674', // Downstairs bathroom
];

const OUTDOOR_SENSORS = [
  'D9353438450D', // Backyard
  'D4343037362D', // Patio
  'C76A0246647E', // Car
  'D83534387029', // Front yard
  'C76A03460A73', // Storage
];

const PRIORITY_SENSORS = [
  'D4343037362D', // Patio
  'D7353530665A', // Living room
  'C76A0246647E', // Car
  'C76A05062842', // Bedroom
  'D63534385106', // Office
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const parseInfluxNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseInfluxTime = (value: unknown): Date | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeSensorRows = (value: unknown): SensorRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const deviceId = typeof row.device_id === 'string' ? row.device_id : null;
    const integrationId =
      typeof row.integration_id === 'string' ? row.integration_id : null;
    const field = row._field === 'tempc' || row._field === 'hum' ? row._field : null;
    const time = parseInfluxTime(row._time);
    const numericValue = parseInfluxNumber(row._value);

    if (!deviceId || !integrationId || !field || !time || numericValue === null) {
      return [];
    }

    return [
      {
        device_id: deviceId,
        integration_id: integrationId,
        _time: time,
        _value: numericValue,
        _field: field,
      },
    ];
  });
};

const fetchSensorRows = async (sensorUrl: string): Promise<SensorRow[]> => {
  const res = await fetch(sensorUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch temp sensors: ${res.status}`);
  }

  return normalizeSensorRows(await res.json());
};

export const useTempSensorsQuery = (
  endpointPath = '/api/influxdb/temp-sensors',
) => {
  const { apiEndpoint } = useAppConfig();
  const [tempSensors, setTempSensors] = useState<SensorRow[]>([]);
  const sensorUrl = resolveDashboardWidgetUrl(apiEndpoint, endpointPath);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const data = await fetchSensorRows(sensorUrl);
        if (isSubscribed) {
          setTempSensors(data);
        }
      } catch (error) {
        console.error('Error fetching temp sensors:', error);
      }
    };

    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [sensorUrl]);

  useInterval(async () => {
    try {
      const data = await fetchSensorRows(sensorUrl);
      setTempSensors(data);
    } catch (error) {
      console.error('Error fetching temp sensors:', error);
    }
  }, 60 * 1000);

  return tempSensors;
};

export const useSensorData = (endpointPath = '/api/influxdb/temp-sensors') => {
  const rawSensorData = useTempSensorsQuery(endpointPath);

  const sensorData = useMemo(() => {
    const deviceMap = new Map<string, SensorData>();

    // Color palette for sensors
    const colors = [
      '#5b7c99', // Muted blue
      '#8b9dc3', // Soft blue-gray
      '#7a8b99', // Cool slate
      '#9c8576', // Warm brown-gray
      '#8a7a8a', // Muted purple-gray
      '#7b8a7b', // Sage green
      '#8a8576', // Warm gray
      '#7c8b8a', // Blue-green gray
      '#998a7c', // Warm taupe
      '#7a7a8a', // Cool purple-gray
      '#8a9c8a', // Soft green-gray
      '#7c8a99', // Steel blue-gray
    ];

    // Initialize all known devices
    Object.entries(DEVICE_ID_TO_NAME).forEach(
      ([deviceId, deviceName], index) => {
        deviceMap.set(deviceId, {
          device_id: deviceId,
          device_name: deviceName,
          temp_data: [],
          humidity_data: [],
          is_priority: PRIORITY_SENSORS.includes(deviceId),
          is_indoor: INDOOR_SENSORS.includes(deviceId),
          color: colors[index % colors.length],
        });
      },
    );

    // Process raw sensor data
    rawSensorData.forEach((row) => {
      const sensor = deviceMap.get(row.device_id);
      if (!sensor) return;

      const time = row._time;
      const value = row._value;

      if (row._field === 'tempc') {
        sensor.temp_data.push({ time, value });
        if (!sensor.latest_temp_time || time > sensor.latest_temp_time) {
          sensor.latest_temp = value;
          sensor.latest_temp_time = time;
        }
      } else if (row._field === 'hum') {
        sensor.humidity_data.push({ time, value });
        if (
          !sensor.latest_humidity_time ||
          time > sensor.latest_humidity_time
        ) {
          sensor.latest_humidity = value;
          sensor.latest_humidity_time = time;
        }
      }
    });

    // Sort data by time
    deviceMap.forEach((sensor) => {
      sensor.temp_data.sort((a, b) => a.time.getTime() - b.time.getTime());
      sensor.humidity_data.sort((a, b) => a.time.getTime() - b.time.getTime());
    });

    // Convert to array and sort by priority, then by name
    return Array.from(deviceMap.values()).sort((a, b) => {
      if (a.is_priority && !b.is_priority) return -1;
      if (!a.is_priority && b.is_priority) return 1;
      return a.device_name.localeCompare(b.device_name);
    });
  }, [rawSensorData]);

  return sensorData;
};

export { INDOOR_SENSORS, OUTDOOR_SENSORS };

interface SpotPriceRow {
  _time: Date;
  _value: number;
}

interface RawSpotPriceRow {
  _time: string;
  _value: number | string;
}

const normalizeSpotPriceRows = (value: unknown): SpotPriceRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const time = parseInfluxTime(row._time);
    const numericValue = parseInfluxNumber(row._value);

    if (!time || numericValue === null) {
      return [];
    }

    return [
      {
        _time: time,
        _value: numericValue,
      },
    ];
  });
};

const fetchSpotPriceRows = async (
  spotPriceUrl: string,
): Promise<SpotPriceRow[]> => {
  const res = await fetch(spotPriceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch spot prices: ${res.status}`);
  }

  return normalizeSpotPriceRows(await res.json());
};

export const useSpotPriceQuery = (
  endpointPath = '/api/influxdb/spot-prices',
) => {
  const { apiEndpoint } = useAppConfig();
  const [spotPrices, setSpotPrices] = useState<SpotPriceRow[]>([]);
  const spotPriceUrl = resolveDashboardWidgetUrl(apiEndpoint, endpointPath);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const data = await fetchSpotPriceRows(spotPriceUrl);
        if (isSubscribed) {
          setSpotPrices(data);
        }
      } catch (error) {
        console.error('Error fetching spot prices:', error);
      }
    };

    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [spotPriceUrl]);

  useInterval(async () => {
    try {
      const data = await fetchSpotPriceRows(spotPriceUrl);
      setSpotPrices(data);
    } catch (error) {
      console.error('Error fetching spot prices:', error);
    }
  }, 60 * 1000);

  return spotPrices;
};
