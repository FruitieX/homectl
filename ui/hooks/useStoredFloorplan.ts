import { useAppConfig } from '@/hooks/appConfig';
import { deserializeGrid, type FloorplanGrid } from '@/ui/FloorplanGridEditor';
import { useEffect, useMemo, useState } from 'react';

export function useStoredFloorplan(floorplanId?: string | null) {
  const { apiEndpoint } = useAppConfig();
  const [grid, setGrid] = useState<FloorplanGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const floorplanQuery = floorplanId ? `?id=${encodeURIComponent(floorplanId)}` : '';

  useEffect(() => {
    let isCancelled = false;

    const loadGrid = async () => {
      if (!floorplanId && floorplanId !== undefined && floorplanId !== null) {
        if (!isCancelled) {
          setGrid(null);
          setLoading(false);
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
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadGrid();

    return () => {
      isCancelled = true;
    };
  }, [apiEndpoint, floorplanId, floorplanQuery]);

  const imageUrl = useMemo(
    () => `${apiEndpoint}/api/v1/config/floorplan/image${floorplanQuery}`,
    [apiEndpoint, floorplanQuery],
  );

  return { grid, imageUrl, loading };
}