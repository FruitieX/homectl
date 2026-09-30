import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import type {
  DashboardLayoutRow,
  DashboardWidgetRow,
} from '@/hooks/useDashboard';
export type { DashboardLayoutRow, DashboardWidgetRow };
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function widgetOptions(
  row: DashboardWidgetRow,
): Record<string, unknown> {
  return isRecord(row.config)
    ? isRecord(row.config.options)
      ? row.config.options
      : row.config
    : {};
}
export function widgetTitle(row: DashboardWidgetRow) {
  return isRecord(row.config) && typeof row.config.title === 'string'
    ? row.config.title
    : row.widget_type;
}
export function useDashboardConfig(layoutId?: string) {
  const { apiEndpoint } = useAppConfig(),
    client = useQueryClient(),
    recordWrite = useRecordConfigWrite();
  const endpoint = `${apiEndpoint}/api/v1/config/dashboard`,
    queryKey = ['config', apiEndpoint, 'dashboard'];
  const read = async <T>(path: string, signal: AbortSignal) =>
    (
      await readApiResponse<T>(
        await fetch(endpoint + path, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        }),
        'Could not load dashboard settings',
      )
    ).data!;
  const layouts = useQuery({
    queryKey: [...queryKey, 'layouts'],
    queryFn: ({ signal }) => read<DashboardLayoutRow[]>('/layouts', signal),
    refetchInterval: 30000,
  });
  const widgets = useQuery({
    queryKey: [...queryKey, 'widgets', layoutId],
    queryFn: ({ signal }) =>
      read<DashboardWidgetRow[]>(`/layouts/${layoutId}/widgets`, signal),
    enabled: !!layoutId && layoutId !== 'new',
    refetchInterval: 30000,
  });
  const write = async <T>(path: string, value?: unknown, method = 'POST') => {
    await client.cancelQueries({ queryKey });
    const result = await readApiResponse<T>(
      await fetch(endpoint + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value),
        signal: AbortSignal.timeout(20000),
      }),
      'Could not save dashboard settings',
    );
    recordWrite('Dashboard', result.write);
    await client.invalidateQueries({ queryKey });
    return result.data!;
  };
  return { layouts, widgets, write, endpoint };
}

/** Reuse per-layout editor caches while finding references across dashboards. */
export function useDashboardWidgetCatalog() {
  const { layouts, endpoint } = useDashboardConfig();
  const { apiEndpoint } = useAppConfig();
  const widgets = useQueries({
    queries: (layouts.data ?? []).map((layout) => ({
      queryKey: [
        'config',
        apiEndpoint,
        'dashboard',
        'widgets',
        String(layout.id),
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (
          await readApiResponse<DashboardWidgetRow[]>(
            await fetch(`${endpoint}/layouts/${layout.id}/widgets`, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
            }),
            'Could not load widget references',
          )
        ).data!,
      refetchInterval: 30000,
    })),
  });
  return { layouts, widgets };
}
