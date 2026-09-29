import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
export type SettingsPreferences = {
  show_advanced_details: boolean;
  [field: string]: unknown;
};
export function useSettingsPreferences() {
  const { apiEndpoint } = useAppConfig();
  const client = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const queryKey = ['config', apiEndpoint, 'preferences'];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<SettingsPreferences>(
          await fetch(`${apiEndpoint}/api/v1/config/preferences`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          }),
          'Could not load preferences',
        )
      ).data,
    refetchInterval: 30000,
  });
  return {
    ...query,
    advanced: query.data?.show_advanced_details ?? true,
    save: async (value: SettingsPreferences, expected: SettingsPreferences) => {
      await client.cancelQueries({ queryKey });
      const result = await readApiResponse<SettingsPreferences>(
        await fetch(`${apiEndpoint}/api/v1/config/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ ...value, expected }),
        }),
        'Could not save preferences',
      );
      recordWrite('preferences', result.write);
      client.setQueryData(queryKey, result.data);
      return result.data;
    },
  };
}
