import { NextResponse } from 'next/server';
import { InfluxDB } from '@influxdata/influxdb-client';
import { serverCache } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

interface TempSensorRow {
  device_id: string;
  integration_id: string;
  _time: Date;
  _value: number;
  _field: string; // Added to distinguish between tempc and hum
}

// Mapping from device_id to sensor name
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

// Priority sensors (currently visible ones) - these will be shown first
const PRIORITY_SENSORS = [
  'D9353438450D', // Backyard
  'D4343037362D', // Patio
  'D7353530665A', // Living room
  'C76A0246647E', // Car
];

export async function GET() {
  try {
    const influxUrl = process.env.INFLUX_URL;
    const influxToken = process.env.INFLUX_TOKEN;

    if (!influxUrl || !influxToken) {
      return NextResponse.json(
        { error: 'INFLUX_URL or INFLUX_TOKEN environment variables not set' },
        { status: 500 },
      );
    }

    const sensorData = await serverCache.get<TempSensorRow[]>(
      'tempHumiditySensorQuery',
      1, // Cache for 1 minute
      async () => {
        const influxDB = new InfluxDB({
          url: influxUrl,
          token: influxToken,
        });

        const queryApi = influxDB.getQueryApi('influxdata');

        // Create dynamic filter for all known device IDs
        const deviceFilters = Object.keys(DEVICE_ID_TO_NAME)
          .map((deviceId) => `(r["device_id"] == "${deviceId}")`)
          .join(' or ');

        const query = `
          from(bucket: "home")
            |> range(start: -6h)
            |> filter(fn: (r) => ${deviceFilters})
            |> filter(fn: (r) => r["_field"] == "tempc" or r["_field"] == "hum")
            |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
            |> yield(name: "mean")
        `;

        const result = await queryApi.collectRows(query);
        return result as TempSensorRow[];
      },
    );

    return NextResponse.json(sensorData);
  } catch (error) {
    console.error('Error fetching temperature and humidity sensors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sensor data' },
      { status: 500 },
    );
  }
}
