import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from './appConfig';
import { readApiResponse } from './useConfig';
import { useRecordConfigWrite } from './configWriteStatus';

export interface SensorCatalogItem {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  [key: string]: unknown;
}
export interface SensorCatalogGroup {
  id: string;
  name: string;
  sensorIds: string[];
  [key: string]: unknown;
}
export interface SensorCatalog {
  sensors: SensorCatalogItem[];
  groups: SensorCatalogGroup[];
  [key: string]: unknown;
}
export function useSensorCatalog() {
  const { apiEndpoint } = useAppConfig();
  const client = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const url = `${apiEndpoint}/api/v1/config/sensors/catalog`;
  const queryKey = ['sensor-catalog', url];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<SensorCatalog>(
          await fetch(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          }),
          'Could not load sensor catalog',
        )
      ).data,
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: async ({
      value,
      expected,
    }: {
      value: SensorCatalog;
      expected?: SensorCatalog;
    }) => {
      await client.cancelQueries({ queryKey });
      const result = await readApiResponse<SensorCatalog>(
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...value, expected }),
          signal: AbortSignal.timeout(20000),
        }),
        'Could not save sensor catalog',
      );
      recordWrite('Sensor catalog', result.write);
      client.setQueryData(queryKey, result.data);
      return result.data;
    },
  });
  return {
    ...query,
    catalog: query.data,
    saving: mutation.isPending,
    saveCatalog: (value: SensorCatalog, expected = query.data) =>
      mutation.mutateAsync({ value, expected }),
  };
}
