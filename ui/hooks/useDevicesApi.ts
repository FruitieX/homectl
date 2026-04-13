'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useGroups } from '@/hooks/useConfig';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Fetches the current device list from the REST API.
 * Use this in config editors where the apiEndpoint must match the config CRUD endpoint.
 */
export function useDevicesApi() {
  const { apiEndpoint } = useAppConfig();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${apiEndpoint}/api/v1/devices`);
      const data = await res.json();
      if (Array.isArray(data.devices)) {
        setDevices(data.devices);
      }
    } catch {
      // Server not reachable
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const devicesState: DevicesState = useMemo(() => {
    const state: DevicesState = {};
    for (const device of devices) {
      state[`${device.integration_id}/${device.id}`] = device;
    }
    return state;
  }, [devices]);

  return { devices, devicesState, loading, refetch };
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
        group.devices.map((device) => `${device.integration_id}/${device.device_id}`);

      state[group.id] = {
        name: group.name,
        device_keys: deviceKeys,
        hidden: group.hidden,
      };
    }
    return state;
  }, [groups]);
}
