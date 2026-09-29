import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import type { DeviceHealthSnapshot } from '@/bindings/DeviceHealthSnapshot';
export function useDeviceHealth() {
  const { apiEndpoint } = useAppConfig();
  return useQuery({
    queryKey: ['device-health', apiEndpoint],
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<DeviceHealthSnapshot>(
          await fetch(`${apiEndpoint}/api/v1/config/device-health`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          }),
          'Could not check device health',
        )
      ).data,
    refetchInterval: 5000,
    staleTime: 3000,
  });
}
