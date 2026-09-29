import { useAppConfig } from '@/hooks/appConfig';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useGroups } from '@/hooks/useConfig';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

const EMPTY_DEVICES: Device[] = [];

/**
 * Fetches the current device list from the REST API.
 * Use this in config editors where the apiEndpoint must match the config CRUD endpoint.
 */
export function useDevicesApi() {
  const { apiEndpoint } = useAppConfig();
  const query = useQuery({
    queryKey: ['devices', apiEndpoint],
    queryFn: async ({ signal }): Promise<Device[]> => {
      const response = await fetch(`${apiEndpoint}/api/v1/devices`, { signal });
      if (!response.ok) throw new Error('Could not load devices');
      const data = await response.json();
      if (!Array.isArray(data.devices))
        throw new Error('The device catalog response was invalid');
      return data.devices;
    },
    refetchInterval: 10000,
  });
  const devices = query.data ?? EMPTY_DEVICES;

  const devicesState: DevicesState = useMemo(() => {
    const state: DevicesState = {};
    for (const device of devices) {
      state[`${device.integration_id}/${device.id}`] = device;
    }
    return state;
  }, [devices]);

  return {
    devices,
    devicesState,
    loading: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Converts groups from the config API to FlattenedGroupsConfig format.
 * Prefer the server-provided flattened device_keys when available.
 */
export function useGroupsState(): FlattenedGroupsConfig {
  const { data: groups } = useGroups();

  return useMemo(() => {
    const state: FlattenedGroupsConfig = {};
    for (const group of groups) {
      const deviceKeys =
        group.device_keys ??
        group.devices.map(
          (device) => `${device.integration_id}/${device.device_id}`,
        );

      state[group.id] = {
        name: group.name,
        device_keys: deviceKeys,
        hidden: group.hidden,
      };
    }
    return state;
  }, [groups]);
}
