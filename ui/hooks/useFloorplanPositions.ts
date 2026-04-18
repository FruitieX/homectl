'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { useCallback, useEffect, useState } from 'react';

export interface GroupPosition {
  group_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
}

export function useGroupPositions() {
  const { apiEndpoint } = useAppConfig();
  const [positions, setPositions] = useState<Record<string, GroupPosition>>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${apiEndpoint}/api/v1/config/floorplan/groups`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const map: Record<string, GroupPosition> = {};
        for (const pos of json.data as GroupPosition[]) {
          map[pos.group_id] = pos;
        }
        setPositions(map);
      }
    } catch {
      // positions not available
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const upsert = useCallback(
    async (pos: GroupPosition) => {
      await fetch(
        `${apiEndpoint}/api/v1/config/floorplan/groups/${encodeURIComponent(pos.group_id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pos),
        },
      );
      await refetch();
    },
    [apiEndpoint, refetch],
  );

  const remove = useCallback(
    async (groupId: string) => {
      await fetch(
        `${apiEndpoint}/api/v1/config/floorplan/groups/${encodeURIComponent(groupId)}`,
        { method: 'DELETE' },
      );
      await refetch();
    },
    [apiEndpoint, refetch],
  );

  return { positions, loading, upsert, remove, refetch };
}
