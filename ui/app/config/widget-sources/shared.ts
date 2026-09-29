import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';

export type WidgetSource = {
  key: string;
  config: Record<string, string>;
  credentials: Record<string, boolean>;
  origins: Record<string, 'saved' | 'environment' | 'unset'>;
  invalidStoredConfig: boolean;
  revisionToken: string;
};
export const sourceDefinitions: Record<
  string,
  {
    name: string;
    description: string;
    fields: { key: string; label: string; secret?: boolean; url?: boolean }[];
  }
> = {
  influxdb: {
    name: 'InfluxDB',
    description: 'Historical sensor readings and electricity prices.',
    fields: [
      { key: 'url', label: 'Server URL', url: true },
      { key: 'token', label: 'API token', secret: true },
    ],
  },
  calendar: {
    name: 'Calendar',
    description: 'Events from a private iCalendar feed.',
    fields: [
      {
        key: 'icsUrl',
        label: 'Private calendar feed URL',
        secret: true,
        url: true,
      },
    ],
  },
  weather: {
    name: 'Weather',
    description: 'Current weather and forecasts for dashboard widgets.',
    fields: [{ key: 'apiUrl', label: 'Weather API URL', url: true }],
  },
  train_schedule: {
    name: 'Train schedules',
    description: 'Departure data for dashboard transport widgets.',
    fields: [{ key: 'apiUrl', label: 'Train API URL', url: true }],
  },
};
export function useWidgetSources() {
  const { apiEndpoint } = useAppConfig();
  const queryKey = ['config', apiEndpoint, 'widget-sources'];
  const endpoint = `${apiEndpoint}/api/v1/config/widget-sources`;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<WidgetSource[]>(
          await fetch(endpoint, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          }),
          'Could not load widget sources',
        )
      ).data ?? [],
    refetchInterval: 30000,
  });
  return { ...query, queryKey, endpoint };
}
