import { useQuery } from '@tanstack/react-query';

export function useWidgetResource<T>(
  url: string,
  refreshMs = 60000,
  enabled = true,
) {
  return useQuery<T>({
    queryKey: ['widget-resource', url],
    enabled,
    queryFn: async ({ signal }) => {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 10000);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([signal, timeout.signal]),
        });
        if (!response.ok)
          throw new Error(`Data request failed (${response.status})`);
        return (await response.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    refetchInterval: refreshMs,
    staleTime: refreshMs / 2,
    retry: 1,
  });
}
