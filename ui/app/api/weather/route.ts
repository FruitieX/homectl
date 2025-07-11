import { NextResponse } from 'next/server';
import { serverCache } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

type WeatherTimeSeries = {
  time: Date;
  data: {
    instant: {
      details: {
        air_temperature: number;
        wind_speed: number;
        ultraviolet_index_clear_sky?: number;
      };
    };
    next_1_hours: {
      details: {
        probability_of_precipitation: number;
      };
      summary: {
        symbol_code: string;
      };
    };
  };
};

type WeatherResponse = {
  properties: {
    meta: {
      updated_at: string;
    };
    timeseries: WeatherTimeSeries[];
  };
};

export async function GET() {
  try {
    const weatherApiUrl = process.env.WEATHER_API_URL;

    if (!weatherApiUrl) {
      return NextResponse.json(
        { error: 'WEATHER_API_URL environment variable not set' },
        { status: 500 },
      );
    }

    const weather = await serverCache.get<WeatherResponse>(
      'weatherResponseCache',
      60, // Cache for 60 minutes
      async () => {
        const res = await fetch(weatherApiUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch weather: ${res.status}`);
        }
        const json: WeatherResponse = await res.json();
        return json;
      },
    );

    return NextResponse.json(weather);
  } catch (error) {
    console.error('Error fetching weather:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weather data' },
      { status: 500 },
    );
  }
}
