import { useAppConfig } from '@/hooks/appConfig';
import { useFloorplans } from '@/hooks/useConfig';
import { deserializeGrid, type FloorplanGrid } from '@/ui/FloorplanGridEditor';
import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

export function useStoredFloorplan(floorplanId?: string | null) {
  const { apiEndpoint } = useAppConfig();
  const [grid, setGrid] = useState<FloorplanGrid | null>(null);
  const floorplanQuery = floorplanId
    ? `?id=${encodeURIComponent(floorplanId)}`
    : '';

  useEffect(() => {
    let isCancelled = false;

    const loadGrid = async () => {
      if (!floorplanId && floorplanId !== undefined && floorplanId !== null) {
        if (!isCancelled) {
          setGrid(null);
        }
        return;
      }

      try {
        const response = await fetch(
          `${apiEndpoint}/api/v1/config/floorplan/grid${floorplanQuery}`,
        );
        const result = await response.json();
        const nextGrid =
          result.success && typeof result.data === 'string'
            ? deserializeGrid(result.data)
            : null;

        if (!isCancelled) {
          setGrid(nextGrid);
        }
      } catch {
        if (!isCancelled) {
          setGrid(null);
        }
      }
    };

    loadGrid();

    return () => {
      isCancelled = true;
    };
  }, [apiEndpoint, floorplanId, floorplanQuery]);

  const imageUrl = useMemo(
    () =>
      floorplanId
        ? `${apiEndpoint}/api/v1/config/floorplan/image${floorplanQuery}`
        : undefined,
    [apiEndpoint, floorplanId, floorplanQuery],
  );

  return { grid, imageUrl };
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
    queries: metadata.map(({ id }) => ({
      queryKey: ['config', apiEndpoint, 'floorplan-grid', id],
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
      // An exhausted initial read must not hide previews for the rest of a
      // wall dashboard session, where focus/reconnect events may never occur.
      refetchInterval: (query: { state: { status: string } }) =>
        query.state.status === 'error' ? 30000 : false,
      refetchOnWindowFocus: true,
    })),
  });
  const floorplans = metadata.map(({ id, name }, index) => ({
    id,
    name,
    grid: queries[index].data?.grid ?? null,
    imageUrl: queries[index].data?.imageUrl,
  }));
  return { floorplans };
}
