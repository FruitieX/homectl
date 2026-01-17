'use client';

import { type DeviceSensorConfig } from '@/lib/sensorInteraction';
import { useCallback, useEffect, useState } from 'react';
import { useAppConfig } from './appConfig';

// Types for config API responses
export interface Integration {
  id: string;
  plugin: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface Group {
  id: string;
  name: string;
  hidden: boolean;
  devices: { integration_id: string; device_name: string; device_id?: string }[];
  linked_groups: string[];
}

export interface Scene {
  id: string;
  name: string;
  hidden: boolean;
  script?: string;
  device_states: Record<string, SceneDeviceConfig>;
  group_states: Record<string, SceneDeviceConfig>;
}

// Scene device configuration - can be a device link, scene link, or direct state
export type SceneDeviceConfig =
  | SceneDeviceLink
  | ActivateSceneDescriptor
  | SceneDeviceState;

export interface SceneDeviceLink {
  brightness?: number;
  integration_id: string;
  name?: string;
  id?: string;
}

export interface ActivateSceneDescriptor {
  scene_id: string;
  device_keys?: string[];
  group_keys?: string[];
}

export interface SceneDeviceState {
  power?: boolean;
  color?: DeviceColor;
  brightness?: number;
  transition?: number;
}

export interface DeviceColor {
  Hs?: { h: number; s: number };
  Xy?: { x: number; y: number };
  Rgb?: { r: number; g: number; b: number };
  Ct?: { ct: number };
}

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  rules: unknown[];
  actions: unknown[];
}

export interface DeviceDisplayNameOverride {
  device_key: string;
  display_name: string;
}

export interface FloorplanMetadata {
  id: string;
  name: string;
}

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export interface UiLogEntry {
  timestamp: string;
  level: LogLevel;
  target: string;
  message: string;
}

export interface ConfigExport {
  version?: number;
  core?: Record<string, unknown>;
  integrations?: Integration[];
  groups?: Group[];
  scenes?: Scene[];
  routines?: Routine[];
  floorplan?: Record<string, unknown> | null;
  floorplans?: Record<string, unknown>[];
  device_positions?: Record<string, unknown>[];
  device_display_overrides?: DeviceDisplayNameOverride[];
  device_sensor_configs?: DeviceSensorConfig[];
  dashboard_layouts?: Record<string, unknown>[];
  dashboard_widgets?: Record<string, unknown>[];
}

// Generic fetch hook for config API
function useConfigApi<T>(endpoint: string) {
  const { apiEndpoint } = useAppConfig();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `${apiEndpoint}/api/v1/config`;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${baseUrl}/${endpoint}`);
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to fetch');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, endpoint]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const create = useCallback(
    async (item: Partial<T>) => {
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const result = await response.json();
      if (result.success) {
        await fetchData();
        return result.data;
      }
      throw new Error(result.error || 'Failed to create');
    },
    [baseUrl, endpoint, fetchData],
  );

  const update = useCallback(
    async (id: string, item: Partial<T>) => {
      const response = await fetch(`${baseUrl}/${endpoint}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const result = await response.json();
      if (result.success) {
        await fetchData();
        return result.data;
      }
      throw new Error(result.error || 'Failed to update');
    },
    [baseUrl, endpoint, fetchData],
  );

  const remove = useCallback(
    async (id: string) => {
      const response = await fetch(`${baseUrl}/${endpoint}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        await fetchData();
      } else {
        throw new Error(result.error || 'Failed to delete');
      }
    },
    [baseUrl, endpoint, fetchData],
  );

  return { data, loading, error, refetch: fetchData, create, update, remove };
}

// Specialized hooks for each config type
export function useIntegrations() {
  return useConfigApi<Integration>('integrations');
}

export function useGroups() {
  return useConfigApi<Group>('groups');
}

export function useScenes() {
  return useConfigApi<Scene>('scenes');
}

export function useRoutines() {
  return useConfigApi<Routine>('routines');
}

export function useDeviceDisplayNames() {
  return useConfigApi<DeviceDisplayNameOverride>('device-display-names');
}

export function useDeviceSensorConfigs() {
  return useConfigApi<DeviceSensorConfig>('device-sensor-configs');
}

export function useFloorplans() {
  return useConfigApi<FloorplanMetadata>('floorplans');
}

export function useLogs(pollIntervalMs = 5000) {
  const { apiEndpoint } = useAppConfig();
  const [data, setData] = useState<UiLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const baseUrl = `${apiEndpoint}/api/v1/config`;

  const fetchLogs = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true);
      }

      try {
        const response = await fetch(`${baseUrl}/logs`);
        const result = await response.json();
        if (result.success) {
          setData(result.data);
          setError(null);
          setLastUpdated(new Date().toISOString());
          return;
        }

        setError(result.error || 'Failed to fetch logs');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Unknown error');
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    void fetchLogs();

    const intervalId = window.setInterval(() => {
      void fetchLogs(true);
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchLogs, pollIntervalMs]);

  return { data, loading, error, refetch: fetchLogs, lastUpdated };
}

// Export/Import hooks
export function useConfigExport() {
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config`;

  const exportConfig = useCallback(async (): Promise<ConfigExport> => {
    const response = await fetch(`${baseUrl}/export`);
    const result = await response.json();
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to export');
  }, [baseUrl]);

  const importConfig = useCallback(
    async (config: ConfigExport) => {
      const response = await fetch(`${baseUrl}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to import');
      }
    },
    [baseUrl],
  );

  return { exportConfig, importConfig };
}
