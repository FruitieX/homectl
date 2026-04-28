import { Config } from '@/types/appConfig';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

const appConfigAtom = atom<Config | null>(null);
const APP_CONFIG_PATH = '/api/config';

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

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmedValue = value.trim();
    if (trimmedValue !== '') {
      return trimmedValue;
    }
  }
}

function normalizeBaseUrl(baseUrl: string | undefined) {
  return baseUrl?.replace(/\/+$/, '') ?? '';
}

function resolveApiUrl(apiEndpoint: string, path: string) {
  if (!apiEndpoint) {
    return path;
  }

  return `${apiEndpoint}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeConfig(
  config: ConfigResponse,
  fallbackApiEndpoint: string,
): Config {
  return {
    wsEndpoint:
      firstNonEmptyString(config.wsEndpoint, config.ws_endpoint) ??
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
    apiEndpoint: normalizeBaseUrl(
      firstNonEmptyString(
        config.apiEndpoint,
        config.api_endpoint,
        fallbackApiEndpoint,
      ),
    ),
    weatherApiUrl:
      firstNonEmptyString(config.weatherApiUrl, config.weather_api_url) ?? '',
    trainApiUrl:
      firstNonEmptyString(config.trainApiUrl, config.train_api_url) ?? '',
    influxUrl: firstNonEmptyString(config.influxUrl, config.influx_url) ?? '',
    influxToken:
      firstNonEmptyString(config.influxToken, config.influx_token) ?? '',
    calendarApiUrl:
      firstNonEmptyString(config.calendarApiUrl, config.calendar_api_url) ??
      '/api/calendar',
    calendarIcsUrl:
      firstNonEmptyString(config.calendarIcsUrl, config.calendar_ics_url) ?? '',
  };
}

export const useProvideAppConfig = () => {
  const [loaded, setLoaded] = useState(false);
  const setConfig = useSetAtom(appConfigAtom);

  useEffect(() => {
    const apiEndpoint = normalizeBaseUrl(
      firstNonEmptyString(import.meta.env.API_ENDPOINT),
    );

    const performFetch = async () => {
      const res = await fetch(resolveApiUrl(apiEndpoint, APP_CONFIG_PATH));
      const json = (await res.json()) as ConfigResponse;
      setConfig(normalizeConfig(json, apiEndpoint));
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
