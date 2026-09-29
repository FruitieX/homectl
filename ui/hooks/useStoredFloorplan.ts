import { useAppConfig } from '@/hooks/appConfig';
import { useFloorplans } from '@/hooks/useConfig';
import { deserializeGrid, type FloorplanGrid } from '@/ui/FloorplanGridEditor';
import { useQueries, useQuery } from '@tanstack/react-query';

function floorplanOptions(apiEndpoint: string, id: string) {
  return {
    queryKey: ['config', apiEndpoint, 'floorplan-grid', id],
    enabled: Boolean(id),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/floorplans/${encodeURIComponent(id)}/editor`,
        { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) },
      );
      if (!response.ok) throw new Error('Could not load floorplan.');
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error ?? 'Could not load floorplan.');
      return {
        grid:
          typeof result.data?.grid_data === 'string'
            ? deserializeGrid(result.data.grid_data)
            : null,
        imageUrl:
          result.data?.image?.kind === 'stored'
            ? `${apiEndpoint}/api/v1/config/floorplan/image?id=${encodeURIComponent(id)}&revision=${encodeURIComponent(result.data.image.revision)}`
            : undefined,
      };
    },
    staleTime: 30000,
    retry: 2,
    // Wall dashboards must recover even without a focus/reconnect event.
    refetchInterval: (query: { state: { status: string } }) =>
      query.state.status === 'error' ? 30000 : false,
    refetchOnWindowFocus: true,
  };
}

export function useStoredFloorplan(floorplanId?: string | null) {
  const { apiEndpoint } = useAppConfig();
  const query = useQuery(floorplanOptions(apiEndpoint, floorplanId ?? ''));
  return {
    grid: query.data?.grid ?? null,
    imageUrl: query.data?.imageUrl,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export type StoredFloorplan = {
  id: string;
  name: string;
  grid: FloorplanGrid | null;
  imageUrl?: string;
};

/** Shared query keys deduplicate previews and participate in config invalidation.
 * Failed reads are retried; they cannot permanently cache a missing map.
 */
export function useAllFloorplans(): { floorplans: StoredFloorplan[] } {
  const { apiEndpoint } = useAppConfig();
  const { data: metadata } = useFloorplans();
  const queries = useQueries({
    queries: metadata.map(({ id }) => floorplanOptions(apiEndpoint, id)),
  });
  const floorplans = metadata.map(({ id, name }, index) => ({
    id,
    name,
    grid: queries[index].data?.grid ?? null,
    imageUrl: queries[index].data?.imageUrl,
  }));
  return { floorplans };
}
