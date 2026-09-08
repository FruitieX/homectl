import { useMemo, useRef } from 'react';
import { useAppConfig } from './appConfig';
import { resolveDashboardWidgetUrl } from './useDashboard';
import { useWidgetResource } from './useWidgetResource';
import { useSensorCatalog } from './sensorCatalog';

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
  is_indoor: boolean;
  color: string;
}

interface SensorDataOptions {
  endpointPath?: string;
  sensorIds?: string[];
}

const EMPTY_SENSOR_IDS: string[] = [];

export type SensorDataRow = SensorData;

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
    const field =
      row._field === 'tempc' || row._field === 'hum' ? row._field : null;
    const time = parseInfluxTime(row._time);
    const numericValue = parseInfluxNumber(row._value);

    if (
      !deviceId ||
      !integrationId ||
      !field ||
      !time ||
      numericValue === null
    ) {
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

export const useTempSensorsResource = (
  endpointPath = '/api/influxdb/temp-sensors',
) => {
  const { apiEndpoint } = useAppConfig();
  const previousRows = useRef<SensorRow[]>([]);
  const previousEndpointPath = useRef(endpointPath);
  if (previousEndpointPath.current !== endpointPath) {
    previousEndpointPath.current = endpointPath;
    previousRows.current = [];
  }
  const query = useWidgetResource<unknown>(
    resolveDashboardWidgetUrl(apiEndpoint, endpointPath),
  );
  const rows = useMemo(() => normalizeSensorRows(query.data), [query.data]);
  const stableRows = useMemo(() => {
    if (rows.length > 0) {
      previousRows.current = rows;
      return rows;
    }

    // Influx can briefly return an empty aggregate while it is restarting or
    // while the development proxy is being reloaded. Keep the last useful
    // sample set visible until a non-empty response arrives.
    return previousRows.current;
  }, [rows]);
  return { ...query, rows: stableRows };
};

export const useTempSensorsQuery = (
  endpointPath = '/api/influxdb/temp-sensors',
) => useTempSensorsResource(endpointPath).rows;

export const useSensorData = (
  optionsOrEndpoint: string | SensorDataOptions = '/api/influxdb/temp-sensors',
) => {
  const options =
    typeof optionsOrEndpoint === 'string'
      ? { endpointPath: optionsOrEndpoint }
      : optionsOrEndpoint;
  const endpointPath = options.endpointPath ?? '/api/influxdb/temp-sensors';
  const selectedSensorIds = options.sensorIds ?? EMPTY_SENSOR_IDS;
  const rawSensorData = useTempSensorsQuery(endpointPath);
  const catalogQuery = useSensorCatalog();

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

    const discoveredDeviceIds = Array.from(
      new Set(rawSensorData.map((row) => row.device_id)),
    );
    const catalog = catalogQuery.catalog;
    const configuredDeviceIds =
      selectedSensorIds.length > 0 ? selectedSensorIds : discoveredDeviceIds;
    const catalogItems = catalog?.sensors ?? [];
    const catalogNames = new Map(catalogItems.map((sensor) => [sensor.id, sensor.name]));
    const defaultIndoorIds = catalog?.groups.find((group) => group.id === 'indoor')?.sensorIds ?? [];
    const effectiveIndoorIds = defaultIndoorIds;
    const knownDeviceIds = Array.from(
      new Set([...catalogItems.map((sensor) => sensor.id), ...configuredDeviceIds]),
    );

    knownDeviceIds.forEach((deviceId, index) => {
      if (
        selectedSensorIds.length > 0 &&
        !selectedSensorIds.includes(deviceId)
      ) {
        return;
      }

      deviceMap.set(deviceId, {
        device_id: deviceId,
        device_name: catalogNames.get(deviceId) ?? deviceId,
        temp_data: [],
        humidity_data: [],
        is_indoor: effectiveIndoorIds.includes(deviceId),
        color: colors[index % colors.length],
      });
    });

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

    // Keep the settings order stable and make the fallback list alphabetical.
    return Array.from(deviceMap.values()).sort((a, b) => {
      return a.device_name.localeCompare(b.device_name);
    });
  }, [catalogQuery.catalog, rawSensorData, selectedSensorIds]);

  return sensorData;
};


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

export const useSpotPriceQuery = (
  endpointPath = '/api/influxdb/spot-prices',
) => {
  return useSpotPriceResource(endpointPath).rows;
};

export const useSpotPriceResource = (
  endpointPath = '/api/influxdb/spot-prices',
) => {
  const { apiEndpoint } = useAppConfig();
  const spotPriceUrl = resolveDashboardWidgetUrl(apiEndpoint, endpointPath);
  const query = useWidgetResource<unknown>(spotPriceUrl);
  const rows = useMemo(() => normalizeSpotPriceRows(query.data), [query.data]);
  return { ...query, rows };
};
