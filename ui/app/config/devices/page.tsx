import { Device } from '@/bindings/Device';
import { DeviceColor } from '@/bindings/DeviceColor';
import { DeviceStateSource } from '@/bindings/DeviceStateSource';
import { ManageKind } from '@/bindings/ManageKind';
import {
  useConfigDevices,
  useDeviceDisplayNames,
  useGroups,
  useDeviceSensorConfigs,
  useScenes,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useDevicesState } from '@/hooks/websocket';
import { ConfigPageHeader } from '../page-header';
import { getDeviceKey } from '@/lib/device';
import {
  getDefaultDeviceLabel,
  getDeviceDisplayLabel,
} from '@/lib/deviceLabel';
import { black, getResolvedDeviceColorState } from '@/lib/colors';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import {
  type DeviceSensorConfig,
  type SensorInteractionKind,
  SENSOR_INTERACTION_OPTIONS,
  getSensorConfigRef,
  getSensorDetails,
  getSensorInteractionLabel,
  normalizeSensorInteractionConfig,
  normalizeSensorInteractionKind,
  resolveSensorInteraction,
} from '@/lib/sensorInteraction';
import { SensorActionPanel } from '@/ui/SensorActionPanel';
import { ResolvedColorDot } from '@/ui/SceneResolvedColorPreview';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormSection,
  ConfigHelpPanel,
} from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { useEffect, useMemo, useState } from 'react';

type DeviceTypeFilter = 'all' | 'controllable' | 'sensor' | 'other';

const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const fieldClassName = 'space-y-2';
const fieldLabelClassName = 'text-sm font-medium';
const dashedPanelClassName =
  'rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground';
const spinnerClassName =
  'size-3 animate-spin rounded-full border-2 border-current border-t-transparent';

type VisibleDeviceEntry = {
  activeSceneId: string | null;
  capabilityLabels: string[];
  defaultLabel: string;
  device: Device;
  deviceKey: string;
  deviceRef: string;
  groupIds: string[];
  groupNames: string[];
  label: string;
  manageLabel: string | null;
  resolvedInteraction: ReturnType<typeof resolveSensorInteraction>;
  resolvedColorPreview: {
    color: NonNullable<ReturnType<typeof getResolvedDeviceColorState>>['color'];
    isPowered: boolean;
  } | null;
  runtimeSummary: string;
  sensorDetails: ReturnType<typeof getSensorDetails>;
  stateDetails: string[];
  stateSource: DeviceStateSource | null;
  type: DeviceTypeFilter;
};

const getDeviceType = (device: Device) => {
  if ('Sensor' in device.data) {
    return 'sensor' as const;
  }

  if ('Controllable' in device.data) {
    return 'controllable' as const;
  }

  return 'other' as const;
};

const createEmptySensorConfig = (deviceRef: string): DeviceSensorConfig => ({
  device_ref: deviceRef,
  interaction_kind: 'auto',
  config: {},
});

const stringifyConfig = (
  kind: SensorInteractionKind,
  config: Record<string, unknown>,
) => JSON.stringify(normalizeSensorInteractionConfig(kind, config));

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number') {
    return null;
  }

  return `${Math.round(value * 100)}%`;
};

const formatDeviceColor = (color: DeviceColor | null | undefined) => {
  if (!color) {
    return null;
  }

  if ('h' in color && 's' in color) {
    return `HS ${Math.round(color.h)} / ${Math.round(color.s * 100)}%`;
  }

  if ('r' in color && 'g' in color && 'b' in color) {
    return `RGB ${color.r}, ${color.g}, ${color.b}`;
  }

  if ('ct' in color) {
    return `CT ${color.ct}`;
  }

  if ('x' in color && 'y' in color) {
    return `XY ${color.x.toFixed(2)}, ${color.y.toFixed(2)}`;
  }

  return 'Color set';
};

const getControllableStateDetails = (device: Device) => {
  if (!('Controllable' in device.data)) {
    return [];
  }

  const { state } = device.data.Controllable;
  const details = [state.power ? 'Powered on' : 'Powered off'];
  const brightness = formatPercent(state.brightness);
  const color = formatDeviceColor(state.color);

  if (brightness) {
    details.push(`Brightness ${brightness}`);
  }

  if (color) {
    details.push(color);
  }

  if (typeof state.transition === 'number') {
    details.push(`${state.transition}s transition`);
  }

  return details;
};

const getControllableStateSummary = (device: Device) => {
  const details = getControllableStateDetails(device);

  return details.length > 0 ? details.join(' · ') : 'No live state available';
};

const getSensorRuntimeSummary = (device: Device) => {
  const sensorDetails = getSensorDetails(device);

  switch (sensorDetails.kind) {
    case 'boolean':
      return sensorDetails.value ? 'Boolean sensor: on' : 'Boolean sensor: off';
    case 'number':
      return `Numeric sensor: ${sensorDetails.value}`;
    case 'text':
      return sensorDetails.value.length > 0
        ? `Text sensor: ${sensorDetails.value}`
        : 'Text sensor';
    case 'state': {
      const brightness = formatPercent(
        typeof sensorDetails.value.brightness === 'number'
          ? sensorDetails.value.brightness
          : null,
      );
      const stateBits = [
        sensorDetails.value.power === true
          ? 'State sensor: on'
          : sensorDetails.value.power === false
            ? 'State sensor: off'
            : 'State sensor payload',
      ];

      if (brightness) {
        stateBits.push(brightness);
      }

      return stateBits.join(' · ');
    }
    default:
      return 'Sensor payload available';
  }
};

const getManageKindLabel = (managed: ManageKind) => {
  if (managed === 'Full') {
    return 'Managed';
  }

  if (managed === 'Unmanaged') {
    return 'Unmanaged';
  }

  if (managed === 'FullReadOnly') {
    return 'Managed, read only';
  }

  if (managed === 'UnmanagedReadOnly') {
    return 'Unmanaged, read only';
  }

  if ('Partial' in managed) {
    return managed.Partial.prev_change_committed
      ? 'Partial'
      : 'Partial pending commit';
  }

  return 'Managed';
};

const getCapabilitiesSummary = (device: Device) => {
  if (!('Controllable' in device.data)) {
    return [];
  }

  const { capabilities } = device.data.Controllable;
  const labels = [] as string[];

  if (capabilities.hs) {
    labels.push('HS');
  }

  if (capabilities.xy) {
    labels.push('XY');
  }

  if (capabilities.rgb) {
    labels.push('RGB');
  }

  if (capabilities.ct) {
    labels.push(`CT ${capabilities.ct.start}-${capabilities.ct.end}`);
  }

  return labels;
};

const getSceneLabel = (
  sceneId: string | null | undefined,
  sceneNameById: Record<string, string>,
) => {
  if (!sceneId) {
    return 'Manual / direct';
  }

  return sceneNameById[sceneId] ?? sceneId;
};

const getStateSourceSummary = (
  source: DeviceStateSource | null,
  activeSceneId: string | null,
  sceneNameById: Record<string, string>,
  groupNameById: Record<string, string>,
) => {
  if (!source) {
    if (activeSceneId) {
      return {
        badge: 'scene',
        description: `Active scene ${getSceneLabel(activeSceneId, sceneNameById)} does not expose source metadata for this device.`,
      };
    }

    return {
      badge: 'manual',
      description: 'Current state is not tied to an active scene.',
    };
  }

  const scopePrefix =
    source.scope === 'group'
      ? 'group'
      : source.scope === 'script'
        ? 'script'
        : source.scope === 'override'
          ? 'override'
          : 'scene';
  const kindSuffix =
    source.kind === 'device_link'
      ? 'device link'
      : source.kind === 'scene_link'
        ? 'scene link'
        : 'state';
  const badge = `${scopePrefix} ${kindSuffix}`;
  const groupLabel =
    source.group_id !== null
      ? (groupNameById[source.group_id] ?? source.group_id)
      : null;

  if (source.kind === 'device_link') {
    const linkedDevice = source.linked_device_key ?? 'unknown device';
    if (source.scope === 'group') {
      return {
        badge,
        description: `Group target${groupLabel ? ` ${groupLabel}` : ''} tracks ${linkedDevice}.`,
      };
    }

    if (source.scope === 'script') {
      return {
        badge,
        description: `Scene script tracks ${linkedDevice}.`,
      };
    }

    if (source.scope === 'override') {
      return {
        badge,
        description: `Scene override tracks ${linkedDevice}.`,
      };
    }

    return {
      badge,
      description: `Scene target tracks ${linkedDevice}.`,
    };
  }

  if (source.kind === 'scene_link') {
    const linkedScene = getSceneLabel(source.linked_scene_id, sceneNameById);
    if (source.scope === 'group') {
      return {
        badge,
        description: `Group target${groupLabel ? ` ${groupLabel}` : ''} inherits from ${linkedScene}.`,
      };
    }

    if (source.scope === 'script') {
      return {
        badge,
        description: `Scene script inherits from ${linkedScene}.`,
      };
    }

    if (source.scope === 'override') {
      return {
        badge,
        description: `Scene override inherits from ${linkedScene}.`,
      };
    }

    return {
      badge,
      description: `Scene target inherits from ${linkedScene}.`,
    };
  }

  if (source.scope === 'group') {
    return {
      badge,
      description: `Group target${groupLabel ? ` ${groupLabel}` : ''} sets state directly.`,
    };
  }

  if (source.scope === 'script') {
    return {
      badge,
      description: 'Scene script sets the state directly.',
    };
  }

  if (source.scope === 'override') {
    return {
      badge,
      description: 'Scene override sets the state directly.',
    };
  }

  return {
    badge,
    description: 'Scene target sets the state directly.',
  };
};

const getGroupCountLabel = (groupNames: string[]) =>
  `${groupNames.length} group${groupNames.length === 1 ? '' : 's'}`;

type SensorConfigFieldsProps = {
  kind: SensorInteractionKind;
  config: Record<string, string>;
  resolvedLabel: string;
  onChange: (field: string, value: string) => void;
};

function SensorConfigFields({
  kind,
  config,
  resolvedLabel,
  onChange,
}: SensorConfigFieldsProps) {
  if (kind === 'auto') {
    return (
      <div className={dashedPanelClassName}>
        Auto mode currently resolves to{' '}
        <span className="font-medium">{resolvedLabel}</span> based on the latest
        sensor payload. Use a manual mode when a switch should look like the
        physical remote instead of a raw text or JSON field.
      </div>
    );
  }

  if (kind === 'on_off_buttons') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <ConfigField label="On value">
          <Input
            type="text"
            className="h-9"
            value={config.on_value ?? ''}
            onChange={(e) => onChange('on_value', e.target.value)}
          />
        </ConfigField>
        <ConfigField label="Off value">
          <Input
            type="text"
            className="h-9"
            value={config.off_value ?? ''}
            onChange={(e) => onChange('off_value', e.target.value)}
          />
        </ConfigField>
      </div>
    );
  }

  if (kind === 'hue_dimmer') {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ConfigField label="On value">
          <Input
            type="text"
            className="h-9"
            value={config.on_value ?? ''}
            onChange={(e) => onChange('on_value', e.target.value)}
          />
        </ConfigField>
        <ConfigField label="Dim up value">
          <Input
            type="text"
            className="h-9"
            value={config.up_value ?? ''}
            onChange={(e) => onChange('up_value', e.target.value)}
          />
        </ConfigField>
        <ConfigField label="Dim down value">
          <Input
            type="text"
            className="h-9"
            value={config.down_value ?? ''}
            onChange={(e) => onChange('down_value', e.target.value)}
          />
        </ConfigField>
        <ConfigField label="Off value">
          <Input
            type="text"
            className="h-9"
            value={config.off_value ?? ''}
            onChange={(e) => onChange('off_value', e.target.value)}
          />
        </ConfigField>
      </div>
    );
  }

  return (
    <div className={dashedPanelClassName}>
      This mode does not need extra mapping values. The inline sensor panel will
      render a{' '}
      {kind === 'boolean'
        ? 'boolean button set'
        : kind === 'number'
          ? 'number input'
          : kind === 'text'
            ? 'text input'
            : 'state patcher'}
      .
    </div>
  );
}

function DeviceFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="wrap-break-word font-medium">{value}</span>
    </div>
  );
}

export default function DevicesPage() {
  const {
    devices,
    loading: devicesLoading,
    refetch: refetchDevices,
  } = useDevicesApi();
  const websocketDevices = useDevicesState();
  const { data: groupRows, refetch: refetchGroups } = useGroups();
  const { data: scenes, refetch: refetchScenes } = useScenes();
  const {
    data: deviceDisplayNames,
    refetch: refetchDeviceDisplayNames,
    update: updateDeviceDisplayName,
    remove: removeDeviceDisplayName,
  } = useDeviceDisplayNames();
  const {
    data: deviceSensorConfigs,
    refetch: refetchDeviceSensorConfigs,
    update: updateDeviceSensorConfig,
    remove: removeDeviceSensorConfig,
  } = useDeviceSensorConfigs();
  const { replace: replaceConfigDevice, remove: removeConfigDevice } =
    useConfigDevices();
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] =
    useState<DeviceTypeFilter>('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const [displayNameDrafts, setDisplayNameDrafts] = useState<
    Record<string, string>
  >({});
  const [sensorConfigDrafts, setSensorConfigDrafts] = useState<
    Record<string, DeviceSensorConfig>
  >({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openDeviceKey, setOpenDeviceKey] = useState<string | null>(null);
  const [deviceDetailTab, setDeviceDetailTab] = useState<
    'runtime' | 'config' | 'actions' | 'raw'
  >('runtime');
  const [replacementDrafts, setReplacementDrafts] = useState<
    Record<string, string>
  >({});

  const changeDeviceDetailTab = (value: string) => {
    if (
      value === 'runtime' ||
      value === 'config' ||
      value === 'actions' ||
      value === 'raw'
    ) {
      setDeviceDetailTab(value);
    }
  };

  useEffect(() => {
    setDisplayNameDrafts(
      Object.fromEntries(
        deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
      ),
    );
  }, [deviceDisplayNames]);

  useEffect(() => {
    setSensorConfigDrafts(
      Object.fromEntries(
        deviceSensorConfigs.map((row) => [
          row.device_ref,
          {
            ...row,
            interaction_kind: normalizeSensorInteractionKind(
              row.interaction_kind,
            ),
            config: normalizeSensorInteractionConfig(
              normalizeSensorInteractionKind(row.interaction_kind),
              row.config,
            ),
          },
        ]),
      ),
    );
  }, [deviceSensorConfigs]);

  const deviceDisplayNameMap = useMemo(
    () =>
      Object.fromEntries(
        deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
      ),
    [deviceDisplayNames],
  );
  const deviceSensorConfigMap = useMemo(
    () =>
      Object.fromEntries(
        deviceSensorConfigs.map((row) => [row.device_ref, row]),
      ),
    [deviceSensorConfigs],
  );
  const groups = useMemo(() => {
    const nextGroups: FlattenedGroupsConfig = {};

    for (const group of groupRows) {
      nextGroups[group.id] = {
        name: group.name,
        device_keys:
          group.device_keys ??
          group.devices.map(
            (device) => `${device.integration_id}/${device.device_id}`,
          ),
        hidden: group.hidden,
      };
    }

    return nextGroups;
  }, [groupRows]);
  const sceneNameById = useMemo(
    () => Object.fromEntries(scenes.map((scene) => [scene.id, scene.name])),
    [scenes],
  );

  const availableGroups = useMemo(
    () =>
      Object.entries(groups)
        .filter(
          (entry): entry is [string, NonNullable<(typeof groups)[string]>] =>
            Boolean(entry[1]),
        )
        .map(([id, group]) => ({
          id,
          name: group.name,
          hidden: group.hidden,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [groups],
  );
  const groupNameById = useMemo(
    () =>
      Object.fromEntries(
        availableGroups.map((group) => [group.id, group.name]),
      ),
    [availableGroups],
  );

  const liveDevices = useMemo(() => {
    const mergedDevices = new Map<string, Device>();

    for (const device of devices) {
      mergedDevices.set(getDeviceKey(device), device);
    }

    for (const device of Object.values(websocketDevices ?? {})) {
      if (device) {
        mergedDevices.set(getDeviceKey(device), device);
      }
    }

    return Array.from(mergedDevices.values());
  }, [devices, websocketDevices]);

  const replacementOptions = useMemo(
    () =>
      liveDevices
        .map((device) => ({
          key: getDeviceKey(device),
          label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
        }))
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) ||
            left.key.localeCompare(right.key),
        ),
    [deviceDisplayNameMap, liveDevices],
  );

  const groupIdsByDeviceKey = useMemo(
    () =>
      Object.entries(groups).reduce<Record<string, string[]>>(
        (result, [groupId, group]) => {
          if (!group) {
            return result;
          }

          for (const deviceKey of group.device_keys) {
            if (!result[deviceKey]) {
              result[deviceKey] = [];
            }
            result[deviceKey].push(groupId);
          }

          return result;
        },
        {},
      ),
    [groups],
  );

  const normalizedSearch = deviceSearch.trim().toLowerCase();
  const visibleDevices = useMemo(
    () =>
      liveDevices
        .map((device) => {
          const deviceKey = getDeviceKey(device);
          const deviceRef = getSensorConfigRef(device);
          const type = getDeviceType(device);
          const groupIds = groupIdsByDeviceKey[deviceKey] ?? [];
          const groupNames = groupIds.map(
            (groupId) => groups[groupId]?.name ?? groupId,
          );
          const resolvedInteraction = resolveSensorInteraction(
            device,
            deviceSensorConfigMap[deviceRef] ?? null,
          );
          const sensorDetails = getSensorDetails(device);
          const resolvedColorState = getResolvedDeviceColorState(device.data);

          return {
            activeSceneId:
              'Controllable' in device.data
                ? device.data.Controllable.scene_id
                : null,
            capabilityLabels: getCapabilitiesSummary(device),
            defaultLabel: getDefaultDeviceLabel(device),
            device,
            deviceKey,
            deviceRef,
            groupIds,
            groupNames,
            label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
            manageLabel:
              'Controllable' in device.data
                ? getManageKindLabel(device.data.Controllable.managed)
                : null,
            resolvedInteraction,
            resolvedColorPreview: resolvedColorState
              ? {
                  color: resolvedColorState.color.mix(
                    black,
                    1 - Math.max(0, Math.min(1, resolvedColorState.brightness)),
                  ),
                  isPowered: resolvedColorState.power,
                }
              : null,
            runtimeSummary:
              'Controllable' in device.data
                ? getControllableStateSummary(device)
                : getSensorRuntimeSummary(device),
            sensorDetails,
            stateDetails:
              'Controllable' in device.data
                ? getControllableStateDetails(device)
                : [],
            stateSource:
              'Controllable' in device.data
                ? device.data.Controllable.state_source
                : null,
            type,
          } satisfies VisibleDeviceEntry;
        })
        .filter((entry) => {
          if (deviceTypeFilter !== 'all' && entry.type !== deviceTypeFilter) {
            return false;
          }

          if (
            deviceGroupFilter !== 'all' &&
            !entry.groupIds.includes(deviceGroupFilter)
          ) {
            return false;
          }

          if (!normalizedSearch) {
            return true;
          }

          return [
            entry.label,
            entry.defaultLabel,
            entry.deviceKey,
            entry.deviceRef,
            entry.runtimeSummary,
            entry.activeSceneId ?? '',
            ...entry.groupNames,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch);
        })
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) ||
            left.deviceKey.localeCompare(right.deviceKey),
        ),
    [
      deviceDisplayNameMap,
      deviceGroupFilter,
      deviceSensorConfigMap,
      deviceTypeFilter,
      groupIdsByDeviceKey,
      groups,
      liveDevices,
      normalizedSearch,
    ],
  );

  const updateSensorDraftKind = (
    deviceRef: string,
    kind: SensorInteractionKind,
  ) => {
    setSensorConfigDrafts((previous) => ({
      ...previous,
      [deviceRef]: {
        device_ref: deviceRef,
        interaction_kind: kind,
        config: normalizeSensorInteractionConfig(kind, {}),
      },
    }));
  };

  const updateSensorDraftField = (
    deviceRef: string,
    field: string,
    value: string,
  ) => {
    setSensorConfigDrafts((previous) => {
      const current = previous[deviceRef] ?? createEmptySensorConfig(deviceRef);
      const kind = normalizeSensorInteractionKind(current.interaction_kind);
      return {
        ...previous,
        [deviceRef]: {
          device_ref: deviceRef,
          interaction_kind: kind,
          config: {
            ...normalizeSensorInteractionConfig(kind, current.config),
            [field]: value,
          },
        },
      };
    });
  };

  const saveDeviceSettings = async (device: Device) => {
    const deviceKey = getDeviceKey(device);
    const deviceRef = getSensorConfigRef(device);
    const labelDraft = displayNameDrafts[deviceKey]?.trim() ?? '';
    const existingLabel = deviceDisplayNameMap[deviceKey] ?? '';
    const sensorDraft =
      sensorConfigDrafts[deviceRef] ?? createEmptySensorConfig(deviceRef);
    const nextInteractionKind = normalizeSensorInteractionKind(
      sensorDraft.interaction_kind,
    );
    const nextInteractionConfig = normalizeSensorInteractionConfig(
      nextInteractionKind,
      sensorDraft.config,
    );
    const existingSensorConfig = deviceSensorConfigMap[deviceRef];
    const existingInteractionKind = normalizeSensorInteractionKind(
      existingSensorConfig?.interaction_kind,
    );
    const labelChanged = labelDraft !== existingLabel;
    const sensorChanged =
      'Sensor' in device.data &&
      (nextInteractionKind !== existingInteractionKind ||
        stringifyConfig(nextInteractionKind, nextInteractionConfig) !==
          stringifyConfig(
            existingInteractionKind,
            existingSensorConfig?.config ?? {},
          ));

    if (!labelChanged && !sensorChanged) {
      setNotice(`No changes to save for ${getDefaultDeviceLabel(device)}.`);
      return;
    }

    setSavingKey(deviceKey);
    setError(null);
    setNotice(null);

    try {
      if (labelChanged) {
        if (labelDraft.length === 0) {
          if (existingLabel) {
            await removeDeviceDisplayName(deviceKey);
          }
        } else {
          await updateDeviceDisplayName(deviceKey, {
            device_key: deviceKey,
            display_name: labelDraft,
          });
        }
      }

      if ('Sensor' in device.data && sensorChanged) {
        if (nextInteractionKind === 'auto') {
          if (existingSensorConfig) {
            await removeDeviceSensorConfig(deviceRef);
          }
        } else {
          await updateDeviceSensorConfig(deviceRef, {
            device_ref: deviceRef,
            interaction_kind: nextInteractionKind,
            config: nextInteractionConfig,
          });
        }
      }

      setNotice(`Saved device settings for ${getDefaultDeviceLabel(device)}.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to save device settings',
      );
    } finally {
      setSavingKey(null);
    }
  };

  const refreshConfigData = async () => {
    await Promise.all([
      refetchDevices(),
      refetchGroups(),
      refetchScenes(),
      refetchDeviceDisplayNames(),
      refetchDeviceSensorConfigs(),
    ]);
  };

  const replaceDeviceReferences = async (device: Device) => {
    const deviceKey = getDeviceKey(device);
    const replacementDeviceKey = replacementDrafts[deviceKey]?.trim() ?? '';

    if (!replacementDeviceKey) {
      setError('Select a replacement device first.');
      return;
    }

    const replacementOption = replacementOptions.find(
      (option) => option.key === replacementDeviceKey,
    );

    if (!replacementOption) {
      setError('Selected replacement device is no longer available.');
      return;
    }

    if (
      !confirm(
        `Replace all references to "${getDefaultDeviceLabel(device)}" with "${replacementOption.label}" and delete the current device from memory and the database?`,
      )
    ) {
      return;
    }

    setMutatingKey(deviceKey);
    setError(null);
    setNotice(null);

    try {
      const result = await replaceConfigDevice(deviceKey, replacementDeviceKey);
      await refreshConfigData();
      setOpenDeviceKey(null);
      setReplacementDrafts((previous) => ({
        ...previous,
        [deviceKey]: '',
      }));
      setNotice(
        `Replaced ${result?.updated_groups ?? 0} group, ${result?.updated_scenes ?? 0} scene, and ${result?.updated_routines ?? 0} routine references for ${getDefaultDeviceLabel(device)}.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to replace device',
      );
    } finally {
      setMutatingKey(null);
    }
  };

  const deleteDeviceConfig = async (device: Device) => {
    const deviceKey = getDeviceKey(device);

    if (
      !confirm(
        `Delete "${getDefaultDeviceLabel(device)}" from runtime memory and the database, and remove its config references?`,
      )
    ) {
      return;
    }

    setMutatingKey(deviceKey);
    setError(null);
    setNotice(null);

    try {
      const result = await removeConfigDevice(deviceKey);
      await refreshConfigData();
      setOpenDeviceKey(null);
      setNotice(
        `Deleted ${getDefaultDeviceLabel(device)} and removed ${result?.updated_groups ?? 0} group, ${result?.updated_scenes ?? 0} scene, and ${result?.updated_routines ?? 0} routine references.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to delete device',
      );
    } finally {
      setMutatingKey(null);
    }
  };

  if (devicesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConfigPageHeader
        title="Devices"
        description={
          <>
            Configure user-facing device labels, inspect live runtime state, and
            trigger fake sensor updates without opening the floorplan. Active
            scenes and scene-derived state sources are shown for controllable
            devices whenever the runtime exposes them.
          </>
        }
      />

      {error && (
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              ✕
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className={fieldClassName + ' w-full max-w-xs'}>
              <span className={fieldLabelClassName}>Search</span>
              <Input
                type="text"
                className="h-9"
                placeholder="Search by label, id, or group"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
              />
            </label>

            <label className={fieldClassName + ' w-full max-w-48'}>
              <span className={fieldLabelClassName}>Type</span>
              <select
                className={selectClassName + ' h-9'}
                value={deviceTypeFilter}
                onChange={(e) =>
                  setDeviceTypeFilter(e.target.value as DeviceTypeFilter)
                }
              >
                <option value="all">All devices</option>
                <option value="controllable">Lights / devices</option>
                <option value="sensor">Sensors</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className={fieldClassName + ' w-full max-w-xs'}>
              <span className={fieldLabelClassName}>Group</span>
              <select
                className={selectClassName + ' h-9'}
                value={deviceGroupFilter}
                onChange={(e) => setDeviceGroupFilter(e.target.value)}
              >
                <option value="all">All groups</option>
                {availableGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.hidden ? ' (hidden)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {(deviceSearch ||
              deviceTypeFilter !== 'all' ||
              deviceGroupFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            Matching devices: {visibleDevices.length} total ·{' '}
            {visibleDevices.filter((entry) => entry.type === 'sensor').length}{' '}
            sensors ·{' '}
            {
              visibleDevices.filter((entry) => entry.type === 'controllable')
                .length
            }{' '}
            controllables
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {visibleDevices.map((entry) => {
          const {
            activeSceneId,
            capabilityLabels,
            device,
            deviceKey,
            deviceRef,
            groupNames,
            label,
            manageLabel,
            resolvedInteraction,
            resolvedColorPreview,
            runtimeSummary,
            sensorDetails,
            stateDetails,
            stateSource,
            type,
          } = entry;
          const labelDraft = displayNameDrafts[deviceKey] ?? '';
          const hasDisplayOverride = Boolean(deviceDisplayNameMap[deviceKey]);
          const sensorDraft =
            sensorConfigDrafts[deviceRef] ?? createEmptySensorConfig(deviceRef);
          const interactionKind = normalizeSensorInteractionKind(
            sensorDraft.interaction_kind,
          );
          const interactionConfig = normalizeSensorInteractionConfig(
            interactionKind,
            sensorDraft.config,
          );
          const isSaving = savingKey === deviceKey;
          const isMutating = mutatingKey === deviceKey;
          const isOpen = openDeviceKey === deviceKey;
          const replacementDraft = replacementDrafts[deviceKey] ?? '';
          const availableReplacementOptions = replacementOptions.filter(
            (option) => option.key !== deviceKey,
          );
          const interactionLabel =
            'Sensor' in device.data
              ? getSensorInteractionLabel(resolvedInteraction.kind)
              : 'Runtime only';
          const sourceSummary = getStateSourceSummary(
            stateSource,
            activeSceneId,
            sceneNameById,
            groupNameById,
          );

          return (
            <ExpandableConfigCard
              key={deviceKey}
              open={isOpen}
              onOpen={() => setOpenDeviceKey(deviceKey)}
              onClose={() =>
                setOpenDeviceKey((current) =>
                  current === deviceKey ? null : current,
                )
              }
              cardClassName="h-fit"
              dialogTitle={label}
              dialogSubtitle={deviceKey}
              summary={
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold">
                        {label}
                      </h2>
                      <div className="text-xs text-muted-foreground">
                        {deviceKey}
                      </div>
                    </div>

                    {hasDisplayOverride && <Badge>Custom label</Badge>}
                  </div>

                  <div className="text-sm text-foreground/80">
                    {runtimeSummary}
                  </div>

                  {resolvedColorPreview && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ResolvedColorDot
                        color={resolvedColorPreview.color}
                        isPowered={resolvedColorPreview.isPowered}
                      />
                      <span>
                        {stateSource && stateSource.kind !== 'device_state'
                          ? 'Resolved color'
                          : 'Current color'}
                      </span>
                      {!resolvedColorPreview.isPowered && (
                        <span>device off</span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">{type}</Badge>
                    {'Controllable' in device.data && (
                      <Badge variant="outline">
                        {getSceneLabel(activeSceneId, sceneNameById)}
                      </Badge>
                    )}
                    {'Controllable' in device.data ? (
                      <Badge variant="outline">{sourceSummary.badge}</Badge>
                    ) : (
                      <Badge variant="outline">{interactionLabel}</Badge>
                    )}
                    {groupNames.length > 0 && (
                      <Badge variant="muted">
                        {getGroupCountLabel(groupNames)}
                      </Badge>
                    )}
                  </div>
                </div>
              }
            >
              {isOpen ? (
                <Tabs
                  value={deviceDetailTab}
                  onValueChange={changeDeviceDetailTab}
                  className="space-y-4"
                >
                  <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                    <TabsTrigger value="runtime">Runtime</TabsTrigger>
                    <TabsTrigger value="config">Config</TabsTrigger>
                    <TabsTrigger value="actions">Actions</TabsTrigger>
                    <TabsTrigger value="raw">Raw</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="runtime"
                    className="mt-4 grid gap-4 xl:grid-cols-2"
                  >
                    <ConfigFormSection
                      title="Runtime"
                      description="Live state currently reported by the integration and runtime state resolver."
                    >
                      {'Controllable' in device.data ? (
                        <div className="space-y-3">
                          <DeviceFactRow
                            label="Active scene"
                            value={getSceneLabel(activeSceneId, sceneNameById)}
                          />
                          <DeviceFactRow
                            label="Current state"
                            value={runtimeSummary}
                          />
                          <DeviceFactRow
                            label="State source"
                            value={sourceSummary.description}
                          />

                          {stateDetails.length > 0 && (
                            <div className="space-y-2 pt-1">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                State details
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {stateDetails.map((detail) => (
                                  <Badge
                                    key={`${deviceKey}-${detail}`}
                                    variant="outline"
                                  >
                                    {detail}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <DeviceFactRow
                            label="Current value"
                            value={runtimeSummary}
                          />
                          <DeviceFactRow
                            label="Payload shape"
                            value={sensorDetails.kind}
                          />
                          <DeviceFactRow
                            label="Sensor UI"
                            value={getSensorInteractionLabel(
                              resolvedInteraction.kind,
                            )}
                          />
                          <DeviceFactRow
                            label="Mapping source"
                            value={
                              resolvedInteraction.source === 'saved'
                                ? 'Saved sensor mapping'
                                : 'Auto detected from payload'
                            }
                          />
                        </div>
                      )}
                    </ConfigFormSection>

                    <ConfigFormSection
                      title="Identity"
                      description="Static ids, display names, capabilities, and config group membership."
                    >
                      <div className="space-y-3">
                        <DeviceFactRow
                          label="Default label"
                          value={entry.defaultLabel}
                        />
                        <DeviceFactRow
                          label="Integration"
                          value={device.integration_id}
                        />
                        <DeviceFactRow
                          label={
                            'Sensor' in device.data
                              ? 'Sensor ref'
                              : 'Device key'
                          }
                          value={
                            'Sensor' in device.data ? deviceRef : deviceKey
                          }
                        />

                        {manageLabel && (
                          <DeviceFactRow
                            label="Manage mode"
                            value={manageLabel}
                          />
                        )}

                        {capabilityLabels.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              Capabilities
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {capabilityLabels.map((capability) => (
                                <Badge
                                  key={`${deviceKey}-${capability}`}
                                  variant="outline"
                                >
                                  {capability}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 pt-1">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Groups
                          </div>
                          {groupNames.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {groupNames.map((groupName) => (
                                <Badge
                                  key={`${deviceKey}-${groupName}`}
                                  variant="muted"
                                >
                                  {groupName}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              No config groups reference this device.
                            </div>
                          )}
                        </div>
                      </div>
                    </ConfigFormSection>
                  </TabsContent>

                  <TabsContent value="config" className="mt-4">
                    <ConfigFormSection
                      title="Configuration"
                      description="Customize how this device is displayed and how sensor payloads appear in control surfaces."
                    >
                      <ConfigField
                        label="Custom label"
                        className="w-full max-w-md"
                      >
                        <Input
                          type="text"
                          placeholder="Use integration label"
                          value={labelDraft}
                          onChange={(e) =>
                            setDisplayNameDrafts((previous) => ({
                              ...previous,
                              [deviceKey]: e.target.value,
                            }))
                          }
                        />
                      </ConfigField>

                      {'Sensor' in device.data ? (
                        <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
                          <div className="flex flex-wrap items-start gap-4">
                            <ConfigField
                              label="Map interaction"
                              className="w-full max-w-sm"
                            >
                              <select
                                className={selectClassName}
                                value={interactionKind}
                                onChange={(e) =>
                                  updateSensorDraftKind(
                                    deviceRef,
                                    e.target.value as SensorInteractionKind,
                                  )
                                }
                              >
                                {SENSOR_INTERACTION_OPTIONS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </ConfigField>

                            <div className="space-y-2 text-sm text-muted-foreground">
                              <div>Sensor reference: {deviceRef}</div>
                              <div>
                                Current payload mode:{' '}
                                {getSensorInteractionLabel(
                                  resolvedInteraction.kind,
                                )}
                              </div>
                              <div>
                                Last seen sensor shape: {sensorDetails.kind}
                              </div>
                            </div>
                          </div>

                          <SensorConfigFields
                            kind={interactionKind}
                            config={interactionConfig}
                            resolvedLabel={getSensorInteractionLabel(
                              resolvedInteraction.kind,
                            )}
                            onChange={(field, value) =>
                              updateSensorDraftField(deviceRef, field, value)
                            }
                          />
                        </div>
                      ) : (
                        <div className={dashedPanelClassName}>
                          This device is not a sensor, so only the user-facing
                          label applies here.
                        </div>
                      )}

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isMutating}
                          onClick={() =>
                            setDisplayNameDrafts((previous) => ({
                              ...previous,
                              [deviceKey]: '',
                            }))
                          }
                        >
                          Use Integration Label
                        </Button>
                        {'Sensor' in device.data && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isMutating}
                            onClick={() =>
                              updateSensorDraftKind(deviceRef, 'auto')
                            }
                          >
                            Use Auto Sensor UI
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={isSaving || isMutating}
                          onClick={() => void saveDeviceSettings(device)}
                        >
                          {isSaving && <span className={spinnerClassName} />}
                          Save Changes
                        </Button>
                      </div>

                      {hasDisplayOverride && (
                        <div className="text-xs text-muted-foreground">
                          A display name override is active for this device.
                        </div>
                      )}
                    </ConfigFormSection>
                  </TabsContent>

                  <TabsContent value="actions" className="mt-4 space-y-4">
                    {'Sensor' in device.data ? (
                      <ConfigFormSection
                        title="Fake sensor actions"
                        description="Trigger the same fake sensor actions available on the floorplan directly from configuration."
                      >
                        <SensorActionPanel
                          device={device}
                          sensorConfig={
                            deviceSensorConfigMap[deviceRef] ?? null
                          }
                        />
                      </ConfigFormSection>
                    ) : (
                      <ConfigHelpPanel>
                        This device does not expose fake sensor actions.
                      </ConfigHelpPanel>
                    )}

                    <ConfigFormSection
                      title="Device replacement / deletion"
                      description="Replace config references with another device, or delete this device from runtime memory and the database while removing saved references."
                      className="border-destructive/30 bg-destructive/5"
                    >
                      <ConfigField
                        label="Replacement device"
                        className="w-full max-w-md"
                      >
                        <select
                          className={selectClassName}
                          disabled={isSaving || isMutating}
                          value={replacementDraft}
                          onChange={(event) =>
                            setReplacementDrafts((previous) => ({
                              ...previous,
                              [deviceKey]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select replacement device...</option>
                          {availableReplacementOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label} ({option.key})
                            </option>
                          ))}
                        </select>
                      </ConfigField>

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-amber-400/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                          disabled={isSaving || isMutating || !replacementDraft}
                          onClick={() => void replaceDeviceReferences(device)}
                        >
                          {isMutating && <span className={spinnerClassName} />}
                          Replace References
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isSaving || isMutating}
                          onClick={() => void deleteDeviceConfig(device)}
                        >
                          {isMutating && <span className={spinnerClassName} />}
                          Delete Device
                        </Button>
                      </div>
                    </ConfigFormSection>
                  </TabsContent>

                  <TabsContent value="raw" className="mt-4">
                    <ConfigFormSection
                      title="Raw JSON payload"
                      description="Latest raw payload published by the integration."
                    >
                      {device.raw ? (
                        <details>
                          <summary className="cursor-pointer select-none text-sm text-foreground/80">
                            Show live payload from the integration
                          </summary>
                          <pre className="mt-3 max-h-96 overflow-auto rounded-2xl border border-border bg-background p-3 text-xs font-mono whitespace-pre-wrap break-all">
                            {JSON.stringify(device.raw, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          This device has not published a raw payload.
                        </p>
                      )}
                    </ConfigFormSection>
                  </TabsContent>
                </Tabs>
              ) : null}
            </ExpandableConfigCard>
          );
        })}
      </div>

      {visibleDevices.length === 0 && (
        <EmptyState
          title="No devices match the current filters"
          description="Clear filters or search for another label, id, or group."
        />
      )}
    </div>
  );
}
