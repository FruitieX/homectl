import { Config } from '@/types/appConfig';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

const appConfigAtom = atom<Config | null>(null);

type ConfigResponse = Partial<Config> & {
  ws_endpoint?: string;
  api_endpoint?: string;
  weather_api_url?: string;
  train_api_url?: string;
  influx_url?: string;
  influx_token?: string;
  calendar_api_url?: string;
  calendar_ics_url?: string;
};

function normalizeConfig(config: ConfigResponse): Config {
  return {
    wsEndpoint:
      config.wsEndpoint ??
      config.ws_endpoint ??
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
    apiEndpoint: config.apiEndpoint ?? config.api_endpoint ?? '',
    weatherApiUrl: config.weatherApiUrl ?? config.weather_api_url ?? '',
    trainApiUrl: config.trainApiUrl ?? config.train_api_url ?? '',
    influxUrl: config.influxUrl ?? config.influx_url ?? '',
    influxToken: config.influxToken ?? config.influx_token ?? '',
    calendarApiUrl:
      config.calendarApiUrl ?? config.calendar_api_url ?? '/api/calendar',
    calendarIcsUrl: config.calendarIcsUrl ?? config.calendar_ics_url ?? '',
  };
}

export const useProvideAppConfig = () => {
  const [loaded, setLoaded] = useState(false);
  const setConfig = useSetAtom(appConfigAtom);

  useEffect(() => {
    const performFetch = async () => {
      const res = await fetch('/api/config');
      const json = (await res.json()) as ConfigResponse;
      setConfig(normalizeConfig(json));
      setLoaded(true);
    };

    performFetch().catch(console.error);
  }, [setConfig]);

  return loaded;
};

export const useAppConfig = (): Config => {
  const config = useAtomValue(appConfigAtom);

  if (config === null) {
    throw new Error(
      'Calling useAppConfig before config has loaded is a fatal error. Make sure your app waits for useProvideAppConfig to return true before rendering.',
    );
  }

  return config;
};
