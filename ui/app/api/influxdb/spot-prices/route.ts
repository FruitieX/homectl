import { NextResponse } from 'next/server';
import { InfluxDB } from '@influxdata/influxdb-client';
import { serverCache } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

interface SpotPriceRow {
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

    const spotPrices = await serverCache.get<SpotPriceRow[]>(
      'spotPriceQuery',
      1, // Cache for 1 minute
      async () => {
        const influxDB = new InfluxDB({
          url: influxUrl,
          token: influxToken,
        });

        const queryApi = influxDB.getQueryApi('influxdata');

        const query = `
          import "date"
          import "timezone"

          option location = timezone.location(name: "Europe/Helsinki")

          from(bucket: "nordpool")
            |> range(start: date.truncate(t: now(), unit: 1d), stop: 48h)
            |> filter(fn: (r) => r["_measurement"] == "price")
        `;

        const result = await queryApi.collectRows(query);
        return result as SpotPriceRow[];
      },
    );

    return NextResponse.json(spotPrices);
  } catch (error) {
    console.error('Error fetching spot prices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch spot price data' },
      { status: 500 },
    );
  }
}
