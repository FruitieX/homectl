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
  devices: { integration_id: string; device_id: string }[];
  linked_groups: string[];
  device_keys?: string[];
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
  device_id?: string;
}

export function getSceneDeviceLinkTargetKey(config: SceneDeviceLink) {
  const targetId = config.device_id;

  if (!config.integration_id || !targetId) {
    return '';
  }

  return `${config.integration_id}/${targetId}`;
}

export interface ActivateSceneDescriptor {
  scene_id: string;
  device_keys?: string[];
  group_keys?: string[];
  transition?: number;
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

export interface RuntimeStatus {
  persistence_available: boolean;
  memory_only_mode: boolean;
}

export interface DeviceConfigMutationResult {
  deleted_device_key: string;
  replacement_device_key?: string | null;
  updated_groups: number;
  updated_scenes: number;
  updated_routines: number;
  display_override_changed: boolean;
  sensor_config_changed: boolean;
  position_changed: boolean;
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

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string | null;
};

async function readApiResponse<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const result = (await response.json()) as ApiResponse<T>;

    if (response.ok && result.success) {
      return result;
    }

    throw new Error(result.error || fallbackMessage);
  }

  const responseBody = await response.text();
  throw new Error(responseBody || fallbackMessage);
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
      const result = await readApiResponse<T[]>(response, 'Failed to fetch');
      if (result.success && result.data) {
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
      const result = await readApiResponse<T>(response, 'Failed to create');
      await fetchData();
      return result.data;
    },
    [baseUrl, endpoint, fetchData],
  );

  const update = useCallback(
    async (id: string, item: Partial<T>) => {
      const response = await fetch(`${baseUrl}/${endpoint}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...item }),
      });
      const result = await readApiResponse<T>(response, 'Failed to update');
      await fetchData();
      return result.data;
    },
    [baseUrl, endpoint, fetchData],
  );

  const remove = useCallback(
    async (id: string) => {
      const response = await fetch(`${baseUrl}/${endpoint}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const result = await readApiResponse<unknown>(response, 'Failed to delete');
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

export function useConfigDevices() {
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config/devices`;

  const replace = useCallback(
    async (deviceKey: string, replacementDeviceKey: string) => {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(deviceKey)}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacement_device_key: replacementDeviceKey }),
      });
      const result = await readApiResponse<DeviceConfigMutationResult>(
        response,
        'Failed to replace device references',
      );
      return result.data;
    },
    [baseUrl],
  );

  const remove = useCallback(
    async (deviceKey: string) => {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(deviceKey)}`, {
        method: 'DELETE',
      });
      const result = await readApiResponse<DeviceConfigMutationResult>(
        response,
        'Failed to delete device',
      );
      return result.data;
    },
    [baseUrl],
  );

  return { replace, remove };
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

export function useRuntimeStatus(pollIntervalMs = 5000) {
  const { apiEndpoint } = useAppConfig();
  const [data, setData] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async (background = false) => {
      if (!background && !cancelled) {
        setLoading(true);
      }

      try {
        const response = await fetch(`${apiEndpoint}/api/v1/config/runtime-status`);
        const result = await readApiResponse<RuntimeStatus>(
          response,
          'Failed to fetch runtime status',
        );

        if (!cancelled) {
          setData(result.data ?? null);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Unknown error');
        }
      } finally {
        if (!background && !cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchStatus();

    const intervalId = window.setInterval(() => {
      void fetchStatus(true);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [apiEndpoint, pollIntervalMs]);

  return { data, loading, error };
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
