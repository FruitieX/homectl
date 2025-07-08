import { NextResponse } from 'next/server';
import { InfluxDB } from '@influxdata/influxdb-client';
import { serverCache } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

interface TempSensorRow {
  device_id: string;
  integration_id: string;
  _time: Date;
  _value: number;
}

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

    const tempSensors = await serverCache.get<TempSensorRow[]>(
      'tempSensorQuery',
      1, // Cache for 1 minute
      async () => {
        const influxDB = new InfluxDB({
          url: influxUrl,
          token: influxToken,
        });

        const queryApi = influxDB.getQueryApi('influxdata');

        const query = `
          from(bucket: "home")
            |> range(start: -6h)
            |> filter(fn: (r) =>
                // backyard
                (r["device_id"] == "D9353438450D" and r["integration_id"] == "ble1") or

                // front yard
                (r["device_id"] == "D83534387029" and r["integration_id"] == "ble2") or 

                // patio
                (r["device_id"] == "D4343037362D" and r["integration_id"] == "ble1") or

                // living room
                (r["device_id"] == "D7353530665A" and r["integration_id"] == "ble1") or

                // car
                (r["device_id"] == "C76A0246647E" and r["integration_id"] == "ble2")
            )
            |> filter(fn: (r) => r["_field"] == "tempc")
            |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
            |> yield(name: "mean")
        `;

        const result = await queryApi.collectRows(query);
        return result as TempSensorRow[];
      },
    );

    return NextResponse.json(tempSensors);
  } catch (error) {
    console.error('Error fetching temperature sensors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch temperature sensor data' },
      { status: 500 },
    );
  }
}
