'use client';

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
import { useWebsocketState } from '@/hooks/websocket';
import { getDeviceKey } from '@/lib/device';
import { getDefaultDeviceLabel, getDeviceDisplayLabel } from '@/lib/deviceLabel';
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
import { useEffect, useMemo, useState } from 'react';

type DeviceTypeFilter = 'all' | 'controllable' | 'sensor' | 'other';

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
    return managed.Partial.prev_change_committed ? 'Partial' : 'Partial pending commit';
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
    source.group_id !== null ? groupNameById[source.group_id] ?? source.group_id : null;

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
      <div className="rounded-lg border border-dashed border-base-300 bg-base-100/40 p-3 text-sm opacity-80">
        Auto mode currently resolves to <span className="font-medium">{resolvedLabel}</span>{' '}
        based on the latest sensor payload. Use a manual mode when a switch should look like
        the physical remote instead of a raw text or JSON field.
      </div>
    );
  }

  if (kind === 'on_off_buttons') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-sm">On value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.on_value ?? ''}
            onChange={(e) => onChange('on_value', e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-sm">Off value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.off_value ?? ''}
            onChange={(e) => onChange('off_value', e.target.value)}
          />
        </label>
      </div>
    );
  }

  if (kind === 'hue_dimmer') {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="form-control">
          <span className="label-text text-sm">On value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.on_value ?? ''}
            onChange={(e) => onChange('on_value', e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-sm">Dim up value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.up_value ?? ''}
            onChange={(e) => onChange('up_value', e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-sm">Dim down value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.down_value ?? ''}
            onChange={(e) => onChange('down_value', e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-sm">Off value</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={config.off_value ?? ''}
            onChange={(e) => onChange('off_value', e.target.value)}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-base-300 bg-base-100/40 p-3 text-sm opacity-80">
      This mode does not need extra mapping values. The inline sensor panel will render a{' '}
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
      <span className="opacity-60">{label}</span>
      <span className="wrap-break-word font-medium">{value}</span>
    </div>
  );
}

export default function DevicesPage() {
  const { devices, loading: devicesLoading, refetch: refetchDevices } = useDevicesApi();
  const wsState = useWebsocketState();
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
  const { replace: replaceConfigDevice, remove: removeConfigDevice } = useConfigDevices();
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<DeviceTypeFilter>('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const [displayNameDrafts, setDisplayNameDrafts] = useState<Record<string, string>>({});
  const [sensorConfigDrafts, setSensorConfigDrafts] = useState<Record<string, DeviceSensorConfig>>(
    {},
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openDeviceKey, setOpenDeviceKey] = useState<string | null>(null);
  const [replacementDrafts, setReplacementDrafts] = useState<Record<string, string>>({});

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
            interaction_kind: normalizeSensorInteractionKind(row.interaction_kind),
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
    () => Object.fromEntries(deviceDisplayNames.map((row) => [row.device_key, row.display_name])),
    [deviceDisplayNames],
  );
  const deviceSensorConfigMap = useMemo(
    () => Object.fromEntries(deviceSensorConfigs.map((row) => [row.device_ref, row])),
    [deviceSensorConfigs],
  );
  const groups = useMemo(() => {
    const nextGroups: FlattenedGroupsConfig = {};

    for (const group of groupRows) {
      nextGroups[group.id] = {
        name: group.name,
        device_keys:
          group.device_keys ??
          group.devices.map((device) => `${device.integration_id}/${device.device_id}`),
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
          (entry): entry is [string, NonNullable<(typeof groups)[string]>] => Boolean(entry[1]),
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
    () => Object.fromEntries(availableGroups.map((group) => [group.id, group.name])),
    [availableGroups],
  );

  const liveDevices = useMemo(() => {
    const mergedDevices = new Map<string, Device>();

    for (const device of devices) {
      mergedDevices.set(getDeviceKey(device), device);
    }

    for (const device of Object.values(wsState?.devices ?? {})) {
      if (device) {
        mergedDevices.set(getDeviceKey(device), device);
      }
    }

    return Array.from(mergedDevices.values());
  }, [devices, wsState]);

  const replacementOptions = useMemo(
    () =>
      liveDevices
        .map((device) => ({
          key: getDeviceKey(device),
          label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
        }))
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) || left.key.localeCompare(right.key),
        ),
    [deviceDisplayNameMap, liveDevices],
  );

  const groupIdsByDeviceKey = useMemo(
    () =>
      Object.entries(groups).reduce<Record<string, string[]>>((result, [groupId, group]) => {
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
      }, {}),
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
          const groupNames = groupIds.map((groupId) => groups[groupId]?.name ?? groupId);
          const resolvedInteraction = resolveSensorInteraction(
            device,
            deviceSensorConfigMap[deviceRef] ?? null,
          );
          const sensorDetails = getSensorDetails(device);
          const resolvedColorState = getResolvedDeviceColorState(device.data);

          return {
            activeSceneId:
              'Controllable' in device.data ? device.data.Controllable.scene_id : null,
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
              'Controllable' in device.data ? getControllableStateDetails(device) : [],
            stateSource:
              'Controllable' in device.data ? device.data.Controllable.state_source : null,
            type,
          } satisfies VisibleDeviceEntry;
        })
        .filter((entry) => {
          if (deviceTypeFilter !== 'all' && entry.type !== deviceTypeFilter) {
            return false;
          }

          if (deviceGroupFilter !== 'all' && !entry.groupIds.includes(deviceGroupFilter)) {
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
            left.label.localeCompare(right.label) || left.deviceKey.localeCompare(right.deviceKey),
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

  const updateSensorDraftKind = (deviceRef: string, kind: SensorInteractionKind) => {
    setSensorConfigDrafts((previous) => ({
      ...previous,
      [deviceRef]: {
        device_ref: deviceRef,
        interaction_kind: kind,
        config: normalizeSensorInteractionConfig(kind, {}),
      },
    }));
  };

  const updateSensorDraftField = (deviceRef: string, field: string, value: string) => {
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
    const sensorDraft = sensorConfigDrafts[deviceRef] ?? createEmptySensorConfig(deviceRef);
    const nextInteractionKind = normalizeSensorInteractionKind(sensorDraft.interaction_kind);
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
          stringifyConfig(existingInteractionKind, existingSensorConfig?.config ?? {}));

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
      setError(nextError instanceof Error ? nextError.message : 'Failed to save device settings');
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
      setError(nextError instanceof Error ? nextError.message : 'Failed to replace device');
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
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete device');
    } finally {
      setMutatingKey(null);
    }
  };

  if (devicesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Devices</h1>
        <p className="max-w-3xl text-sm opacity-70">
          Configure user-facing device labels, inspect live runtime state, and trigger fake sensor
          updates without opening the floorplan. Active scenes and scene-derived state sources are
          shown for controllable devices whenever the runtime exposes them.
        </p>
      </div>

      {error && (
        <div className="alert alert-warning">
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="alert alert-success">
          <span>{notice}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="form-control w-full max-w-xs">
              <span className="label-text text-sm">Search</span>
              <input
                type="text"
                className="input input-bordered input-sm"
                placeholder="Search by label, id, or group"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
              />
            </label>

            <label className="form-control w-full max-w-48">
              <span className="label-text text-sm">Type</span>
              <select
                className="select select-bordered select-sm"
                value={deviceTypeFilter}
                onChange={(e) => setDeviceTypeFilter(e.target.value as DeviceTypeFilter)}
              >
                <option value="all">All devices</option>
                <option value="controllable">Lights / devices</option>
                <option value="sensor">Sensors</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="form-control w-full max-w-xs">
              <span className="label-text text-sm">Group</span>
              <select
                className="select select-bordered select-sm"
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

            {(deviceSearch || deviceTypeFilter !== 'all' || deviceGroupFilter !== 'all') && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="text-sm opacity-70">
            Matching devices: {visibleDevices.length} total ·{' '}
            {visibleDevices.filter((entry) => entry.type === 'sensor').length} sensors ·{' '}
            {visibleDevices.filter((entry) => entry.type === 'controllable').length} controllables
          </div>
        </div>
      </div>

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
          const sensorDraft = sensorConfigDrafts[deviceRef] ?? createEmptySensorConfig(deviceRef);
          const interactionKind = normalizeSensorInteractionKind(sensorDraft.interaction_kind);
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
                setOpenDeviceKey((current) => (current === deviceKey ? null : current))
              }
              cardClassName="h-fit"
              dialogTitle={label}
              dialogSubtitle={deviceKey}
              summary={
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold">{label}</h2>
                      <div className="text-xs opacity-60">{deviceKey}</div>
                    </div>

                    {hasDisplayOverride && (
                      <span className="badge badge-primary badge-sm">Custom label</span>
                    )}
                  </div>

                  <div className="text-sm opacity-80">{runtimeSummary}</div>

                  {resolvedColorPreview && (
                    <div className="flex items-center gap-2 text-xs opacity-75">
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
                        <span className="opacity-60">device off</span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="badge badge-outline badge-sm">{type}</span>
                    {'Controllable' in device.data && (
                      <span className="badge badge-outline badge-sm">
                        {getSceneLabel(activeSceneId, sceneNameById)}
                      </span>
                    )}
                    {'Controllable' in device.data ? (
                      <span className="badge badge-outline badge-sm">{sourceSummary.badge}</span>
                    ) : (
                      <span className="badge badge-outline badge-sm">{interactionLabel}</span>
                    )}
                    {groupNames.length > 0 && (
                      <span className="badge badge-ghost badge-sm">
                        {getGroupCountLabel(groupNames)}
                      </span>
                    )}
                  </div>
                </div>
              }
            >
              {isOpen ? (
                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="rounded-xl border border-base-300 bg-base-100/70 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide opacity-60">
                        Runtime
                      </div>

                      {'Controllable' in device.data ? (
                        <div className="space-y-3">
                          <DeviceFactRow
                            label="Active scene"
                            value={getSceneLabel(activeSceneId, sceneNameById)}
                          />
                          <DeviceFactRow label="Current state" value={runtimeSummary} />
                          <DeviceFactRow label="State source" value={sourceSummary.description} />

                          {stateDetails.length > 0 && (
                            <div className="space-y-2 pt-1">
                              <div className="text-xs uppercase tracking-wide opacity-60">
                                State details
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {stateDetails.map((detail) => (
                                  <span key={`${deviceKey}-${detail}`} className="badge badge-outline badge-sm">
                                    {detail}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <DeviceFactRow label="Current value" value={runtimeSummary} />
                          <DeviceFactRow label="Payload shape" value={sensorDetails.kind} />
                          <DeviceFactRow
                            label="Sensor UI"
                            value={getSensorInteractionLabel(resolvedInteraction.kind)}
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
                    </section>

                    <section className="rounded-xl border border-base-300 bg-base-100/70 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide opacity-60">
                        Identity
                      </div>

                      <div className="space-y-3">
                        <DeviceFactRow label="Default label" value={entry.defaultLabel} />
                        <DeviceFactRow label="Integration" value={device.integration_id} />
                        <DeviceFactRow
                          label={'Sensor' in device.data ? 'Sensor ref' : 'Device key'}
                          value={'Sensor' in device.data ? deviceRef : deviceKey}
                        />

                        {manageLabel && <DeviceFactRow label="Manage mode" value={manageLabel} />}

                        {capabilityLabels.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div className="text-xs uppercase tracking-wide opacity-60">
                              Capabilities
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {capabilityLabels.map((capability) => (
                                <span key={`${deviceKey}-${capability}`} className="badge badge-outline badge-sm">
                                  {capability}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 pt-1">
                          <div className="text-xs uppercase tracking-wide opacity-60">Groups</div>
                          {groupNames.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {groupNames.map((groupName) => (
                                <span key={`${deviceKey}-${groupName}`} className="badge badge-ghost badge-sm">
                                  {groupName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm opacity-70">No config groups reference this device.</div>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="rounded-xl border border-base-300 bg-base-100/70 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                      Raw JSON payload
                    </div>
                    {device.raw ? (
                      <details>
                        <summary className="cursor-pointer select-none text-sm opacity-80">
                          Show live payload from the integration
                        </summary>
                        <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-base-300 bg-base-100 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                          {JSON.stringify(device.raw, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <p className="text-sm opacity-70">
                        This device has not published a raw payload.
                      </p>
                    )}
                  </section>

                  {'Sensor' in device.data && (
                    <section className="rounded-xl border border-base-300 bg-base-100/70 p-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                        Fake Sensor Actions
                      </div>
                      <p className="mb-4 text-sm opacity-75">
                        Trigger the same fake sensor actions available on the floorplan directly
                        from configuration.
                      </p>
                      <SensorActionPanel
                        device={device}
                        sensorConfig={deviceSensorConfigMap[deviceRef] ?? null}
                      />
                    </section>
                  )}

                  <section className="rounded-xl border border-base-300 bg-base-100/70 p-4 space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Configuration
                    </div>

                    <label className="form-control w-full max-w-md">
                      <span className="label-text text-sm">Custom label</span>
                      <input
                        type="text"
                        className="input input-bordered"
                        placeholder="Use integration label"
                        value={labelDraft}
                        onChange={(e) =>
                          setDisplayNameDrafts((previous) => ({
                            ...previous,
                            [deviceKey]: e.target.value,
                          }))
                        }
                      />
                    </label>

                    {'Sensor' in device.data ? (
                      <div className="space-y-4 rounded-xl border border-base-300 bg-base-100/40 p-4">
                        <div className="flex flex-wrap items-start gap-4">
                          <label className="form-control w-full max-w-sm">
                            <span className="label-text text-sm">Map interaction</span>
                            <select
                              className="select select-bordered"
                              value={interactionKind}
                              onChange={(e) =>
                                updateSensorDraftKind(
                                  deviceRef,
                                  e.target.value as SensorInteractionKind,
                                )
                              }
                            >
                              {SENSOR_INTERACTION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="space-y-2 text-sm opacity-70">
                            <div>Sensor reference: {deviceRef}</div>
                            <div>
                              Current payload mode: {getSensorInteractionLabel(resolvedInteraction.kind)}
                            </div>
                            <div>Last seen sensor shape: {sensorDetails.kind}</div>
                          </div>
                        </div>

                        <SensorConfigFields
                          kind={interactionKind}
                          config={interactionConfig}
                          resolvedLabel={getSensorInteractionLabel(resolvedInteraction.kind)}
                          onChange={(field, value) => updateSensorDraftField(deviceRef, field, value)}
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-base-300 bg-base-100/40 p-4 text-sm opacity-80">
                        This device is not a sensor, so only the user-facing label applies here.
                      </div>
                    )}

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={isMutating}
                        onClick={() =>
                          setDisplayNameDrafts((previous) => ({
                            ...previous,
                            [deviceKey]: '',
                          }))
                        }
                      >
                        Use Integration Label
                      </button>
                      {'Sensor' in device.data && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={isMutating}
                          onClick={() => updateSensorDraftKind(deviceRef, 'auto')}
                        >
                          Use Auto Sensor UI
                        </button>
                      )}
                      <button
                        className={`btn btn-sm btn-primary ${isSaving ? 'loading' : ''}`}
                        disabled={isSaving || isMutating}
                        onClick={() => void saveDeviceSettings(device)}
                      >
                        Save Changes
                      </button>
                    </div>

                    {hasDisplayOverride && (
                      <div className="text-xs opacity-60">
                        A display name override is active for this device.
                      </div>
                    )}
                  </section>

                  <section className="rounded-xl border border-error/30 bg-error/5 p-4 space-y-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-error">
                        Device Replacement / Deletion
                      </div>
                      <p className="mt-2 text-sm opacity-80">
                        Replace config references with another device, or delete this device from
                        runtime memory and the database while removing its saved references.
                      </p>
                    </div>

                    <label className="form-control w-full max-w-md">
                      <span className="label-text text-sm">Replacement device</span>
                      <select
                        className="select select-bordered"
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
                    </label>

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className={`btn btn-sm btn-warning ${isMutating ? 'loading' : ''}`}
                        disabled={isSaving || isMutating || !replacementDraft}
                        onClick={() => void replaceDeviceReferences(device)}
                      >
                        Replace References
                      </button>
                      <button
                        className={`btn btn-sm btn-error ${isMutating ? 'loading' : ''}`}
                        disabled={isSaving || isMutating}
                        onClick={() => void deleteDeviceConfig(device)}
                      >
                        Delete Device
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </ExpandableConfigCard>
          );
        })}
      </div>

      {visibleDevices.length === 0 && (
        <div className="rounded-xl border border-dashed border-base-300 bg-base-200/40 p-6 text-sm opacity-70">
          No devices match the current filters.
        </div>
      )}
    </div>
  );
}