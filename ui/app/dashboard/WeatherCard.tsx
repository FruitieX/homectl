import { useEffect, useState } from 'react';
import { Card } from 'react-daisyui';
import { useInterval } from 'usehooks-ts';
import { cachedPromise } from './cachedPromise';
import { useAppConfig } from '@/hooks/appConfig';

type WeatherTimeSeries = {
  data: {
    instant: {
      details: {
        air_temperature: number;
        wind_speed: number;
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

const fetchCachedWeather = async (url: string): Promise<WeatherResponse> => {
  const json = await cachedPromise('weatherResponseCache', 60, async () => {
    if (url === undefined) {
      throw new Error('WEATHER_API_URL is undefined');
    }
    const res = await fetch(url);
    const json: WeatherResponse = await res.json();
    return json;
  });

  return json;
};

export const WeatherCard = () => {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);

  const weatherApiUrl = useAppConfig().weatherApiUrl;

  useEffect(() => {
    let isSubscribed = true;

    const fetch = async () => {
      const weather = await fetchCachedWeather(weatherApiUrl);
      if (isSubscribed === true) {
        setWeather(weather);
      }
    };
    fetch();

    return () => {
      isSubscribed = false;
    };
  }, [weatherApiUrl]);

  useInterval(async () => {
    const weather = await fetchCachedWeather(weatherApiUrl);
    setWeather(weather);
  }, 1000);

  const jsx =
    weather !== null ? (
      <div className="flex flex-1 flex-col items-center">
        <img
          className="w-16"
          src={`/weathericons/${weather.properties.timeseries[0]?.data.next_1_hours.summary.symbol_code}.svg`}
        />
        <div className="flex flex-col items-center">
          <span className="whitespace-nowrap text-2xl">
            {
              weather.properties.timeseries[0]?.data.instant.details
                .air_temperature
            }{' '}
            °C
          </span>
          <span className="stat-title">
            {weather.properties.timeseries[0]?.data.instant.details.wind_speed}{' '}
            m/s
          </span>
        </div>
      </div>
    ) : null;

  return (
    <Card compact className="col-span-1">
      <Card.Body className="shadow-lg">{jsx}</Card.Body>
    </Card>
  );
};
