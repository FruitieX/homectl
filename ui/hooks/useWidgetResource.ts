import { useQuery } from '@tanstack/react-query';

import { parseStaleSince } from '@/lib/widgetStale';

type Loaded<T> = { value: T; staleSince: Date | null };

/**
 * Polls a dashboard data feed. When the server could not refresh the feed it
 * serves the last good data and says since when (`x-homectl-stale-since`);
 * that arrives as `staleSince`, so cards can say the data is out of date.
 */
export function useWidgetResource<T>(
  url: string,
  refreshMs = 60000,
  enabled = true,
  parse?: (value: unknown) => T,
) {
  const query = useQuery<Loaded<T>>({
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
        const value: unknown = await response.json();
        return {
          value: parse ? parse(value) : (value as T),
          staleSince: parseStaleSince(
            response.headers.get('x-homectl-stale-since'),
          ),
        };
      } finally {
        clearTimeout(timer);
      }
    },
    refetchInterval: refreshMs,
    staleTime: refreshMs / 2,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
  const staleSince = query.data?.staleSince ?? null;
  return {
    ...query,
    data: query.data?.value,
    staleSince,
    /** The latest refresh failed, whether as an error or as stale data. */
    refreshFailed: query.isError || staleSince !== null,
  };
}
