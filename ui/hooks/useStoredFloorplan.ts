import { useAppConfig } from '@/hooks/appConfig';
import { useFloorplans, type FloorplanMetadata } from '@/hooks/useConfig';
import { deserializeGrid, type FloorplanGrid } from '@/ui/FloorplanGridEditor';
import { useEffect, useMemo, useState } from 'react';

export function useStoredFloorplan(floorplanId?: string | null) {
  const { apiEndpoint } = useAppConfig();
  const [grid, setGrid] = useState<FloorplanGrid | null>(null);
  const floorplanQuery = floorplanId ? `?id=${encodeURIComponent(floorplanId)}` : '';

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
        const response = await fetch(`${apiEndpoint}/api/v1/config/floorplan/grid${floorplanQuery}`);
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
  imageUrl: string;
};

// Module-level cache keyed by apiEndpoint so multiple `useAllFloorplans`
// callers (e.g. every group Preview in the list) do not each issue their
// own fetch storm for the floorplan grids.
const allFloorplanCache = new Map<string, Promise<StoredFloorplan[]>>();

const fetchAllFloorplans = (
  apiEndpoint: string,
  metadata: FloorplanMetadata[],
): Promise<StoredFloorplan[]> =>
  Promise.all(
    metadata.map(async ({ id, name }) => {
      const query = `?id=${encodeURIComponent(id)}`;
      let grid: FloorplanGrid | null = null;
      try {
        const response = await fetch(
          `${apiEndpoint}/api/v1/config/floorplan/grid${query}`,
        );
        const result = await response.json();
        if (result.success && typeof result.data === 'string') {
          grid = deserializeGrid(result.data);
        }
      } catch {
        grid = null;
      }

      return {
        id,
        name,
        grid,
        imageUrl: `${apiEndpoint}/api/v1/config/floorplan/image${query}`,
      };
    }),
  );

/**
 * Load every floorplan's grid + image URL. Meant for consumers that need to
 * pick a floorplan dynamically (e.g. the group preview selects the floorplan
 * containing the most devices from the group).
 */
export function useAllFloorplans(): {
  floorplans: StoredFloorplan[];
} {
  const { apiEndpoint } = useAppConfig();
  const { data: metadata } = useFloorplans();
  const [floorplans, setFloorplans] = useState<StoredFloorplan[]>([]);

  const cacheKey = useMemo(
    () =>
      `${apiEndpoint}::${metadata
        .map((meta) => meta.id)
        .sort()
        .join(',')}`,
    [apiEndpoint, metadata],
  );

  useEffect(() => {
    if (metadata.length === 0) {
      setFloorplans([]);
      return;
    }

    let cancelled = false;

    let pending = allFloorplanCache.get(cacheKey);
    if (!pending) {
      pending = fetchAllFloorplans(apiEndpoint, metadata);
      allFloorplanCache.set(cacheKey, pending);
    }

    pending
      .then((result) => {
        if (!cancelled) {
          setFloorplans(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFloorplans([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiEndpoint, cacheKey, metadata]);

  return { floorplans };
}