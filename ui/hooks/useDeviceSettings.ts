import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import type { DeviceSensorConfig } from '@/lib/sensorInteraction';
import type { ReportingPolicy } from '@/bindings/ReportingPolicy';
export type DeviceSettings = {
  device_key: string;
  display_name: string | null;
  sensor: DeviceSensorConfig | null;
  reporting_policy?: ReportingPolicy;
};
export function useDeviceSettings(key: string) {
  const { apiEndpoint } = useAppConfig();
  const client = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const queryKey = ['config', apiEndpoint, 'device-settings', key];
  const url = `${apiEndpoint}/api/v1/config/device-settings`;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<DeviceSettings>(
          await fetch(`${url}?device_key=${encodeURIComponent(key)}`, {
            signal,
          }),
          'Could not load device settings',
        )
      ).data,
    enabled: Boolean(key),
    refetchInterval: 15000,
  });
  return {
    ...query,
    save: async (value: DeviceSettings, expected: DeviceSettings) => {
      await client.cancelQueries({ queryKey });
      const response = await readApiResponse<DeviceSettings>(
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...value, expected }),
          signal: AbortSignal.timeout(15000),
        }),
        'Could not save device settings',
      );
      recordWrite(`device-settings/${key}`, response.write);
      client.setQueryData(queryKey, response.data);
      await client.invalidateQueries({ queryKey: ['config'] });
      return response.data;
    },
  };
}
