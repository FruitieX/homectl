import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from './appConfig';
import type { ValueHistoryEntry } from '@/bindings/ValueHistoryEntry';
export function useSensorHistory(sourceKey: string) {
  const { apiEndpoint } = useAppConfig();
  return useQuery({
    queryKey: ['sensor-history', apiEndpoint, sourceKey],
    enabled: Boolean(sourceKey),
    refetchInterval: 10000,
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ source_key: sourceKey, path: '/value' });
      const r = await fetch(`${apiEndpoint}/api/v1/config/value-history?${p}`, {
        signal,
      });
      if (!r.ok) throw Error('Sensor history could not be loaded.');
      const b = await r.json();
      if (!Array.isArray(b.data)) throw Error('Invalid sensor history.');
      return b.data as ValueHistoryEntry[];
    },
  });
}
