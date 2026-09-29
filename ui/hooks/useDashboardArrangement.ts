import { useMemo } from 'react';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import type { DashboardWidget } from '@/hooks/useDashboard';

export type Arrangement = {
  layout_id: number;
  placements: Record<
    string,
    {
      grid_x: number;
      grid_y: number;
      grid_w: number;
      grid_h: number;
      sort_order: number;
      revision_token: string;
    }
  >;
  removed_ids: number[];
};
export function useDashboardArrangement(
  layoutId: string | undefined,
  widgets: DashboardWidget[],
  loaded: boolean,
  refetch: () => Promise<void>,
) {
  const { apiEndpoint } = useAppConfig(),
    recordWrite = useRecordConfigWrite();
  const item = useMemo<Arrangement | undefined>(
    () =>
      loaded && layoutId
        ? {
            layout_id: Number(layoutId),
            removed_ids: [],
            placements: Object.fromEntries(
              widgets.map((row) => [
                row.id,
                {
                  grid_x: row.x,
                  grid_y: row.y,
                  grid_w: row.width,
                  grid_h: row.height,
                  sort_order: row.position,
                  revision_token: row.revision_token ?? '',
                },
              ]),
            ),
          }
        : undefined,
    [layoutId, loaded, widgets],
  );
  const draft = useEntityDraft({
    key: `${apiEndpoint}/dashboard-arrangement/${layoutId}`,
    item,
    label: 'Dashboard arrangement',
    href: `/?edit=1&layout=${layoutId}`,
    save: async (value, expected) => {
      const result = await readApiResponse<Arrangement>(
        await fetch(
          `${apiEndpoint}/api/v1/config/dashboard/layouts/${layoutId}/arrangement`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value, expected }),
            signal: AbortSignal.timeout(20000),
          },
        ),
        'Could not save the dashboard arrangement',
      );
      recordWrite('Dashboard arrangement', result.write);
      await refetch();
      return result.data;
    },
  });
  const arranged = useMemo(
    () =>
      widgets
        .filter((row) => !draft.value?.removed_ids.includes(Number(row.id)))
        .map((row) => {
          const placement = draft.value?.placements[row.id];
          return placement
            ? {
                ...row,
                x: placement.grid_x,
                y: placement.grid_y,
                width: placement.grid_w,
                height: placement.grid_h,
                position: placement.sort_order,
              }
            : row;
        })
        .sort((a, b) => a.position - b.position),
    [widgets, draft.value],
  );
  return {
    draft,
    widgets: arranged,
    resize: async (id: string, patch: Partial<DashboardWidget>) => {
      const row = arranged.find((row) => row.id === id);
      if (!row) throw Error('Widget is unavailable.');
      draft.change((current) => ({
        ...current,
        placements: {
          ...current.placements,
          [id]: {
            ...current.placements[id],
            grid_w: patch.width ?? row.width,
            grid_h: patch.height ?? row.height,
          },
        },
      }));
      return { ...row, ...patch };
    },
    reorder: async (ids: string[]) => {
      draft.change((current) => ({
        ...current,
        placements: Object.fromEntries(
          Object.entries(current.placements).map(([id, placement]) => [
            id,
            ids.includes(id)
              ? { ...placement, sort_order: ids.indexOf(id) }
              : placement,
          ]),
        ),
      }));
    },
    remove: (id: string) =>
      draft.change((current) => ({
        ...current,
        removed_ids: [...new Set([...current.removed_ids, Number(id)])],
      })),
  };
}
