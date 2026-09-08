import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from './appConfig';

export interface SensorCatalogItem {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
}

export interface SensorCatalogGroup {
  id: string;
  name: string;
  sensorIds: string[];
}

export interface SensorCatalog {
  sensors: SensorCatalogItem[];
  groups: SensorCatalogGroup[];
}

export function useSensorCatalog() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();
  const url = `${apiEndpoint}/api/v1/config/sensors/catalog`;
  const query = useQuery({
    queryKey: ['sensor-catalog', url],
    queryFn: async () => {
      const response = await fetch(url);
      const body = (await response.json()) as {
        success?: boolean;
        data?: SensorCatalog;
        error?: string;
      };
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error ?? 'Failed to load sensor catalog');
      }
      return body.data;
    },
  });

  const mutation = useMutation({
    mutationFn: async (catalog: SensorCatalog) => {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      const body = (await response.json()) as {
        success?: boolean;
        data?: SensorCatalog;
        error?: string;
      };
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error ?? 'Failed to save sensor catalog');
      }
      return body.data;
    },
    onSuccess: (catalog) => {
      queryClient.setQueryData(['sensor-catalog', url], catalog);
    },
  });

  return { ...query, catalog: query.data, saveCatalog: mutation.mutateAsync, saving: mutation.isPending };
}
