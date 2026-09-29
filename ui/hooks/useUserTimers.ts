import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from './appConfig';
import { readApiResponse } from './useConfig';
import type { UserTimers } from '@/bindings/UserTimers';
import type { UserTimerDefinition } from '@/bindings/UserTimerDefinition';

export function useUserTimers({ enabled = true }: { enabled?: boolean } = {}) {
  const { apiEndpoint } = useAppConfig();
  const client = useQueryClient();
  const queryKey = ['config', apiEndpoint, 'user-timers'];
  const url = `${apiEndpoint}/api/v1/config/timers`;
  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const result = await readApiResponse<UserTimers>(
        await fetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        }),
        'Could not load timers',
      );
      return {
        ...result.data!,
        storage_available:
          (result as typeof result & { storage_available?: boolean })
            .storage_available ?? true,
      };
    },
    refetchInterval: enabled ? 3000 : false,
  });
  const write = async (suffix: string, method: string, body?: unknown) => {
    await client.cancelQueries({ queryKey });
    const result = await readApiResponse<UserTimers>(
      await fetch(url + suffix, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      }),
      'Could not update timers',
    );
    client.setQueryData(queryKey, { ...result.data!, storage_available: true });
    return result.data!;
  };
  return {
    ...query,
    apiEndpoint,
    save: (timers: UserTimerDefinition[], expected: UserTimerDefinition[]) =>
      write('', 'PUT', { timers, expected }),
    stop: (id: string) => write(`/${encodeURIComponent(id)}/stop`, 'POST'),
    cancel: (id: string) => write(`/${encodeURIComponent(id)}/cancel`, 'POST'),
  };
}
