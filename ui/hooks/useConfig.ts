import { stringifyConfig } from '@/lib/routineDraft';
import type { ConfigWriteStatus } from '@/bindings/ConfigWriteStatus';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { ReportingPolicy } from '@/bindings/ReportingPolicy';
import type { IntegrationConfigFieldSchema } from '@/bindings/IntegrationConfigFieldSchema';
import type { IntegrationConfigSchema } from '@/bindings/IntegrationConfigSchema';
import type { SourcePresetInfo } from '@/bindings/SourcePresetInfo';
import type { SourcePreview } from '@/bindings/SourcePreview';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { type DeviceSensorConfig } from '@/lib/sensorInteraction';
import { type RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import { type RoutineV2RuntimeStatus } from '@/bindings/RoutineV2RuntimeStatus';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';
import { useAppConfig } from './appConfig';
import { useHelperStatuses } from './websocket';

// Types for config API responses
export interface Integration {
  reporting_policy?: ReportingPolicy;
  revision_token?: string;
  secret_fields?: string[];
  id: string;
  plugin: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export type { IntegrationConfigFieldSchema, IntegrationConfigSchema };

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
  group_state_order?: string[];
}

// Scene device configuration - can be a device link, scene link, or direct state
export type SceneDeviceConfig =
  SceneDeviceLink | ActivateSceneDescriptor | SceneDeviceState;

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
  use_scene_transition?: boolean;
  transition?: number;
}

export interface SceneDeviceState {
  power?: boolean;
  color?: DeviceColor;
  brightness?: number;
  transition?: number;
}

/**
 * The generated binding: the server stores colours as an untagged union of
 * `{h,s}`, `{r,g,b}`, `{x,y}`, and `{ct}`. Never reintroduce a tagged shape
 * here — it makes a saved colour look unset in the editor.
 */
import type { DeviceColor } from '@/bindings/DeviceColor';
export type { DeviceColor };

/**
 * Raw v2 definition body as stored. `condition` and `execution` are
 * normalized server-side when omitted, so editors must preserve unknown
 * fields verbatim instead of round-tripping through the generated type.
 */
export interface RoutineDefinitionV2Body {
  triggers?: TriggerSpec[];
  condition?: unknown;
  program?: unknown;
  execution?: unknown;
}

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  rules: unknown[];
  actions: unknown[];
  semantics_version?: number;
  revision?: number;
  definition_v2?: RoutineDefinitionV2Body | null;
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
  references?: import('@/bindings/LogEntityReference').LogEntityReference[];
  details?: import('@/bindings/serde_json/JsonValue').JsonValue;
}

export type RoutineHistoryTriggerKind =
  'rule_match' | 'force_trigger' | 'v2_run' | 'v2_blocked';

export interface RoutineHistoryEntry {
  id: string;
  timestamp: string;
  routine_id: string;
  routine_name: string;
  trigger_kind: RoutineHistoryTriggerKind;
  event_source_device_key?: string | null;
  action_count: number;
  status?: RoutineRuntimeStatus | null;
  v2?: RoutineV2RuntimeStatus | null;
  /** Identical blocked attempts coalesced into this entry; read as one. */
  occurrence_count?: number | null;
  /** First attempt of a coalesced blocked entry. */
  first_timestamp?: string | null;
  /** Why a matched trigger produced no run. */
  blocked_reason?: string | null;
}

export interface RuntimeStatus {
  persistence_available: boolean;
  memory_only_mode: boolean;
}

export interface DeviceConfigMutationResult {
  deleted_device_key: string;
  replacement_device_key?: string | null;
  updated_integrations: number;
  updated_groups: number;
  updated_scenes: number;
  updated_routines: number;
  updated_scene_overrides: number;
  updated_dashboard_widgets: number;
  updated_calibration_profiles: number;
  display_override_changed: boolean;
  color_calibration_changed: boolean;
  sensor_config_changed: boolean;
  position_changed: boolean;
}

export type SourceComputeConfig =
  | {
      kind: 'circadian_compat';
      preset_version: number;
      params: Record<string, unknown>;
    }
  | {
      kind: 'script';
      preset?: { id: string; version: number };
      source_body?: string;
      params: unknown;
    };

/**
 * DB-backed computed source. `revision` and `refresh_interval_ms` are plain
 * numbers in JSON even though the generated binding maps i64 to bigint.
 */
export interface SourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  timezone: string;
  refresh_interval_ms: number;
  aliases?: string[];
  compute: SourceComputeConfig;
}

export interface ConfigExport {
  version?: number;
  core?: Record<string, unknown>;
  integrations?: Integration[];
  groups?: Group[];
  scenes?: Scene[];
  routines?: Routine[];
  sources?: SourceConfig[];
  floorplan?: Record<string, unknown> | null;
  floorplans?: Record<string, unknown>[];
  device_display_overrides?: DeviceDisplayNameOverride[];
  device_color_calibrations?: import('@/bindings/DeviceColorCalibration').DeviceColorCalibration[];
  color_calibration_profiles?: import('@/bindings/ColorCalibrationProfile').ColorCalibrationProfile[];
  color_calibration_assignments?: import('@/bindings/ColorCalibrationAssignment').ColorCalibrationAssignment[];
  device_sensor_configs?: DeviceSensorConfig[];
  dashboard_layouts?: Record<string, unknown>[];
  dashboard_widgets?: Record<string, unknown>[];
  helpers?: Record<string, unknown>[];
  helper_values?: Record<string, unknown>[];
  group_positions?: Record<string, unknown>[];
  widget_settings?: Record<string, unknown>[];
  scenario_suite?: Record<string, unknown> | null;
}

export interface BackupReview {
  revision_token: string;
  destructive: boolean;
  legacy_routines: number;
  warnings: string[];
  sections: {
    key: string;
    label: string;
    before: number;
    after: number;
    unchanged: number;
    changes: {
      id: string;
      name: string;
      action: 'add' | 'update' | 'remove';
      fields: string[];
    }[];
  }[];
}

type ApiResponse<T> = {
  write?: ConfigWriteStatus;
  success: boolean;
  data?: T;
  error?: string | null;
  current?: T;
};

export class ConfigApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public current?: unknown,
  ) {
    super(message);
    this.name = 'ConfigApiError';
  }
}

export async function readApiResponse<T>(
  response: Response,
  fallbackMessage: string,
) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const result = (await response.json()) as ApiResponse<T>;

    if (response.ok && result.success) {
      return result;
    }

    throw new ConfigApiError(
      result.error || fallbackMessage,
      response.status,
      result.current,
    );
  }

  const responseBody = await response.text();
  throw new ConfigApiError(responseBody || fallbackMessage, response.status);
}

// Generic fetch hook for config API
function useConfigApi<T>(
  endpoint: string,
  keyInBody = false,
  recoverReads = false,
) {
  const recordWrite = useRecordConfigWrite();
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();

  const baseUrl = `${apiEndpoint}/api/v1/config`;
  const queryKey = ['config', baseUrl, endpoint] as const;

  const query = useQuery<T[]>({
    queryKey,
    refetchOnWindowFocus: recoverReads,
    refetchInterval: (query) =>
      recoverReads && query.state.status === 'error' ? 30000 : false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      const result = await readApiResponse<T[]>(response, 'Failed to fetch');
      return result.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (item: Partial<T>) => {
      await queryClient.cancelQueries({ queryKey });
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyConfig(item),
        signal: AbortSignal.timeout(15000),
      });
      const result = await readApiResponse<T>(response, 'Failed to create');
      recordWrite(
        `${endpoint}/${(item as { id?: string }).id ?? 'new'}`,
        result.write,
      );
      return result.data;
    },
    onSuccess: (saved) => {
      const keyField = keyInBody ? 'device_key' : 'id';
      const savedId = (
        saved as { id?: string; device_key?: string } | undefined
      )?.[keyField];
      if (saved && savedId !== undefined)
        queryClient.setQueryData<T[]>(queryKey, (rows = []) => [
          ...rows.filter(
            (row) =>
              (row as { id?: string; device_key?: string })[keyField] !==
              savedId,
          ),
          saved,
        ]);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      item,
      expected,
    }: {
      id: string;
      item: Partial<T>;
      expected?: T;
    }) => {
      await queryClient.cancelQueries({ queryKey });
      const response = await fetch(
        keyInBody
          ? `${baseUrl}/${endpoint}`
          : `${baseUrl}/${endpoint}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: stringifyConfig({
            ...(keyInBody ? { ...item, device_key: id } : { id, ...item }),
            ...(expected === undefined ? {} : { expected }),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await readApiResponse<T>(response, 'Failed to update');
      recordWrite(
        `${endpoint}/${id}`,
        result.write,
        endpoint === 'routines' ? 'routines/' : undefined,
      );
      return result.data;
    },
    onSuccess: (saved, { id }) => {
      if (saved)
        queryClient.setQueryData<T[]>(queryKey, (rows) =>
          rows?.map((row) =>
            (row as { id?: string; device_key?: string })[
              keyInBody ? 'device_key' : 'id'
            ] === id
              ? saved
              : row,
          ),
        );
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        keyInBody
          ? `${baseUrl}/${endpoint}`
          : `${baseUrl}/${endpoint}/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(15000),
          ...(keyInBody
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_key: id }),
              }
            : {}),
        },
      );
      const result = await readApiResponse<unknown>(
        response,
        'Failed to delete',
      );
      recordWrite(`${endpoint}/${id}`, result.write);
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const refetch = async () => {
    await query.refetch();
  };

  const create = (item: Partial<T>) => createMutation.mutateAsync(item);
  const update = (id: string, item: Partial<T>, expected?: T) =>
    updateMutation.mutateAsync({ id, item, expected });
  const remove = (id: string) => removeMutation.mutateAsync(id);
  const error = query.error instanceof Error ? query.error.message : null;

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error,
    refetch,
    create,
    update,
    remove,
  };
}

// Specialized hooks for each config type
export function useIntegrations() {
  return useConfigApi<Integration>('integrations');
}

export function useIntegrationConfigSchemas() {
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config`;
  const endpoint = 'integration-schemas';
  const queryKey = ['config', baseUrl, endpoint] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/${endpoint}`);
      const result = await readApiResponse<IntegrationConfigSchema[]>(
        response,
        'Failed to fetch integration config schemas',
      );
      return result.data ?? [];
    },
  });

  const error = query.error instanceof Error ? query.error.message : null;

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error,
    refetch: query.refetch,
  };
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

export function useSources() {
  return useConfigApi<SourceConfig>('sources');
}

export function useSourcePresets() {
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config`;
  const endpoint = 'source-presets';
  const queryKey = ['config', baseUrl, endpoint] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/${endpoint}`);
      const result = await readApiResponse<SourcePresetInfo[]>(
        response,
        'Failed to fetch source presets',
      );
      return result.data ?? [];
    },
  });

  const error = query.error instanceof Error ? query.error.message : null;

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error,
    refetch: query.refetch,
  };
}

export interface SourcePreviewArgs {
  timezone: string;
  compute: SourceComputeConfig;
  samples?: number;
}

// Stateless preview of a draft source definition. The request is not
// persisted; validation errors mirror saving.
export function useSourcePreview() {
  const { apiEndpoint } = useAppConfig();
  const [data, setData] = useState<SourcePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const preview = useCallback(
    async (request: SourcePreviewArgs) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const response = await fetch(
          `${apiEndpoint}/api/v1/config/source-preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        const result = await readApiResponse<SourcePreview>(
          response,
          'Failed to preview source',
        );
        if (controller.signal.aborted) return null;
        setData(result.data ?? null);
        return result.data ?? null;
      } catch (previewFailure) {
        if (controller.signal.aborted) return null;
        setError(
          previewFailure instanceof Error
            ? previewFailure.message
            : 'Failed to preview source',
        );
        return null;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [apiEndpoint],
  );

  return { preview, data, loading, error };
}

export function useHelpers() {
  const api = useConfigApi<HelperRuntimeStatus>('helpers');
  const live = useHelperStatuses();
  const data = useMemo(
    () =>
      api.data.map((row) => {
        const current = live?.find((status) => status.id === row.id);
        return current &&
          current.revision >= row.revision &&
          JSON.stringify(current.kind) === JSON.stringify(row.kind)
          ? { ...row, value: current.value, revision: current.revision }
          : row;
      }),
    [api.data, live],
  );
  return { ...api, data };
}

/** Definition writes share the status query, but compare only configuration. */
export function useHelperDefinitions() {
  return useConfigApi<HelperDefinition & { create_only?: boolean }>('helpers');
}

export function useSetHelperValue() {
  const recordWrite = useRecordConfigWrite();
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: unknown }) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/helpers/${encodeURIComponent(id)}/value`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await readApiResponse<{ id: string }>(
        response,
        'Failed to set helper value',
      );
      recordWrite(`helpers/${id}`, result.write);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export type SchedulePreviewInput = {
  cron?: string;
  every_ms?: number;
  timezone?: string;
  backlog: import('@/bindings/BacklogPolicy').BacklogPolicy;
  catch_up_lateness_ms?: number;
};

/**
 * Preview the next occurrences of an unsaved schedule trigger. Debounced so
 * typing a cron expression does not spam the server; the server validates the
 * cron/zone and clamps the occurrence count. Returns null occurrences while
 * the schedule has neither a cron expression nor an interval.
 */
export function useSchedulePreview(schedule: SchedulePreviewInput | null) {
  const { apiEndpoint } = useAppConfig();
  const [occurrences, setOccurrences] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const serialized = schedule ? JSON.stringify(schedule) : '';
  const [debounced] = useDebounceValue(serialized, 400);

  useEffect(() => {
    if (!debounced) {
      setOccurrences(null);
      setError(null);
      setPending(false);
      return;
    }

    const parsed = JSON.parse(debounced) as SchedulePreviewInput;
    if (!parsed.cron && !parsed.every_ms) {
      setOccurrences(null);
      setError(null);
      setPending(false);
      return;
    }

    const controller = new AbortController();
    setPending(true);
    fetch(`${apiEndpoint}/api/v1/config/routines/schedule-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: parsed, count: 5 }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as ApiResponse<{
          occurrences: number[];
        }>;
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Failed to preview schedule');
        }
        return result.data?.occurrences ?? [];
      })
      .then((next) => {
        setOccurrences(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setOccurrences(null);
        setError(
          err instanceof Error ? err.message : 'Failed to preview schedule',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPending(false);
        }
      });

    return () => controller.abort();
  }, [apiEndpoint, debounced]);

  return { occurrences, error, pending };
}

export function useDeviceDisplayNames() {
  return useConfigApi<DeviceDisplayNameOverride>('device-display-names', true);
}

export function useDeviceColorCalibrations() {
  return useConfigApi<
    import('@/bindings/DeviceColorCalibration').DeviceColorCalibration
  >('device-color-calibrations');
}

export function useDeviceSensorConfigs() {
  return useConfigApi<DeviceSensorConfig>('device-sensor-configs');
}

export function useCalibrationProfiles() {
  return useConfigApi<
    import('@/bindings/ColorCalibrationProfile').ColorCalibrationProfile
  >('calibration-profiles');
}

export function useCalibrationAssignments() {
  return useConfigApi<
    import('@/bindings/ColorCalibrationAssignment').ColorCalibrationAssignment
  >('calibration-assignments');
}

export function useAssignCalibrationProfile() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  return useMutation({
    mutationFn: async ({
      deviceKeys,
      profileId,
    }: {
      deviceKeys: string[];
      profileId: string | null;
    }) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/calibration-assignments`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_keys: deviceKeys,
            profile_id: profileId,
          }),
        },
      );
      const result = await readApiResponse<null>(
        response,
        'Failed to assign calibration profile',
      );
      if (!result.success)
        throw new Error(result.error || 'Failed to assign calibration profile');
      recordWrite('calibration-assignments', result.write);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useConfigDevices() {
  const queryClient = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config/devices`;

  const replace = useCallback(
    async (deviceKey: string, replacementDeviceKey: string) => {
      const response = await fetch(`${baseUrl}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_device_key: deviceKey,
          replacement_device_key: replacementDeviceKey,
        }),
      });
      const result = await readApiResponse<DeviceConfigMutationResult>(
        response,
        'Failed to replace device references',
      );
      recordWrite(`devices/${deviceKey}`, result.write);
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      window.dispatchEvent(new CustomEvent('homectl:device-config-changed'));
      return result.data;
    },
    [baseUrl, queryClient, recordWrite],
  );

  const remove = useCallback(
    async (deviceKey: string) => {
      // The key contains a `/`; sending it in the path needs `%2F`, which
      // gateways normalize back into a path separator and answer with a 307 to a
      // route that cannot delete anything. Keep the key in the body instead.
      const response = await fetch(`${baseUrl}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_key: deviceKey }),
      });
      const result = await readApiResponse<DeviceConfigMutationResult>(
        response,
        'Failed to delete device',
      );
      recordWrite(`devices/${deviceKey}`, result.write);
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      window.dispatchEvent(new CustomEvent('homectl:device-config-changed'));
      return result.data;
    },
    [baseUrl, queryClient, recordWrite],
  );

  return { replace, remove };
}

export function useFloorplans() {
  // Room cards stay mounted on wall dashboards; retry exhausted catalog reads
  // even if the browser never loses focus or disconnects its websocket.
  return useConfigApi<FloorplanMetadata>('floorplans', false, true);
}

export function useLogs(pollIntervalMs = 5000, paused = false) {
  const { apiEndpoint } = useAppConfig();
  const query = useQuery({
    queryKey: ['config', apiEndpoint, 'logs'],
    queryFn: async ({ signal }) => {
      const result = await readApiResponse<UiLogEntry[]>(
        await fetch(`${apiEndpoint}/api/v1/config/logs`, { signal }),
        'Could not load logs',
      );
      return result.data ?? [];
    },
    refetchInterval: paused ? false : pollIntervalMs,
    refetchOnWindowFocus: !paused,
  });
  return {
    data: query.data ?? [],
    loading: query.isFetching,
    error: query.error?.message ?? null,
    refetch: () => query.refetch(),
    lastUpdated: query.dataUpdatedAt
      ? new Date(query.dataUpdatedAt).toISOString()
      : null,
  };
}

export function useRoutineHistory(pollIntervalMs = 5000, paused = false) {
  const { apiEndpoint } = useAppConfig();
  const query = useQuery({
    queryKey: ['config', apiEndpoint, 'routine-history'],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/routine-history`,
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        },
      );
      const result = await readApiResponse<RoutineHistoryEntry[]>(
        response,
        'Could not load routine activity',
      );
      return result.data ?? [];
    },
    refetchInterval: paused ? false : pollIntervalMs,
    refetchOnWindowFocus: !paused,
  });
  return {
    data: query.data ?? [],
    loading: query.isFetching,
    error: query.error?.message ?? null,
    refetch: () => query.refetch(),
    lastUpdated: query.dataUpdatedAt
      ? new Date(query.dataUpdatedAt).toISOString()
      : null,
  };
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
        const response = await fetch(
          `${apiEndpoint}/api/v1/config/runtime-status`,
        );
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
          setError(
            nextError instanceof Error ? nextError.message : 'Unknown error',
          );
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
  const recordWrite = useRecordConfigWrite();
  const queryClient = useQueryClient();
  const { apiEndpoint } = useAppConfig();
  const baseUrl = `${apiEndpoint}/api/v1/config`;

  const exportConfig = useCallback(
    async (includeSecrets = false): Promise<ConfigExport> => {
      const query = includeSecrets ? '?include_secrets=true' : '';
      const response = await fetch(`${baseUrl}/export${query}`, {
        signal: AbortSignal.timeout(30000),
      });
      const result = await readApiResponse<ConfigExport>(
        response,
        'Could not download the backup.',
      );
      return result.data!;
    },
    [baseUrl],
  );

  const importConfig = useCallback(
    async (config: ConfigExport, expected?: string) => {
      const query = expected ? `?expected=${encodeURIComponent(expected)}` : '';
      const response = await fetch(`${baseUrl}/import${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(60000),
      });
      const result = await readApiResponse<unknown>(
        response,
        'Could not restore the backup.',
      );
      recordWrite('Configuration import', result.write, '');
      for (const key of ['config', 'sensor-catalog', 'device-health'])
        void queryClient.invalidateQueries({ queryKey: [key] });
      return result.write;
    },
    [baseUrl, recordWrite, queryClient],
  );

  const previewImport = useCallback(
    async (config: unknown, signal?: AbortSignal) => {
      const response = await fetch(`${baseUrl}/import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      const result = await readApiResponse<BackupReview>(
        response,
        'Could not review the backup.',
      );
      return result.data!;
    },
    [baseUrl],
  );

  return { exportConfig, importConfig, previewImport };
}
