'use client';

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
  devices: { integration_id: string; device_name: string }[];
  linked_groups: string[];
}

export interface Scene {
  id: string;
  name: string;
  hidden: boolean;
  script?: string;
}

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  rules: unknown[];
  actions: unknown[];
}

export interface ConfigExport {
  integrations: Integration[];
  groups: Group[];
  scenes: Scene[];
  routines: Routine[];
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
      const response = await fetch(`${baseUrl}/${endpoint}/${id}`, {
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
      const response = await fetch(`${baseUrl}/${endpoint}/${id}`, {
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
