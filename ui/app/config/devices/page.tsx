import { Link, useSearchParams } from 'react-router-dom';
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
  useCalibrationProfiles,
  useCalibrationAssignments,
  useAssignCalibrationProfile,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useDevicesState } from '@/hooks/websocket';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { ConfigPageHeader } from '../page-header';
import { getDeviceKey } from '@/lib/device';
import {
  canCalibrateDevice,
  toggleSelectedKey,
  toggleSelection,
} from '@/lib/colorCalibration';
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
import { DeviceQuickControls } from '@/ui/DeviceControls';
import { DeviceReportStatus } from '@/ui/DeviceReportStatus';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { ColorCalibrationWizard } from '@/ui/ColorCalibrationWizard';
import { ResolvedColorDot } from '@/ui/SceneResolvedColorPreview';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormSection,
  ConfigHelpPanel,
} from '@/ui/config-form';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/ui/primitives/alert';
import {
  confirmDestructive,
  confirmDialog,
} from '@/ui/primitives/confirm-dialog';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { Skeleton } from '@/ui/primitives/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import { CheckSquare, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { selectClassNameLarge as selectClassName } from '@/ui/form-styles';

type DeviceTypeFilter = 'all' | 'controllable' | 'sensor' | 'other';

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
    data: calibrationProfiles,
    loading: profilesLoading,
    error: profilesError,
  } = useCalibrationProfiles();
  const { data: calibrationAssignments } = useCalibrationAssignments();
  const assignCalibration = useAssignCalibrationProfile();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batchProfileId, setBatchProfileId] = useState('');
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
  const [searchParams] = useSearchParams();
  // /config/devices/detail?key=<encoded device key> is the canonical detail
  // link; ?device= stays supported for older links.
  const requestedDeviceKey =
    searchParams.get('key') ?? searchParams.get('device');
  const appliedDeviceRequest = useRef<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const resultsRef = useRef<HTMLSpanElement | null>(null);
  const [deviceSearch, setDeviceSearch] = useState(
    () => searchParams.get('q') ?? '',
  );
  const [deviceTypeFilter, setDeviceTypeFilter] =
    useState<DeviceTypeFilter>('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const [deviceIntegrationFilter, setDeviceIntegrationFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
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
  const [calibrationOpen, setCalibrationOpen] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const [replacementDrafts, setReplacementDrafts] = useState<
    Record<string, string>
  >({});
  const [feedbackKey, setFeedbackKey] = useState<string | null>(null);

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

  // Opening an editor always starts from saved state, so abandoned drafts
  // cannot resurface later.
  const resetDeviceDrafts = (deviceKey: string) => {
    setDisplayNameDrafts((current) => ({
      ...current,
      [deviceKey]: deviceDisplayNameMap[deviceKey] ?? '',
    }));
    setSensorConfigDrafts((current) => {
      const row = deviceSensorConfigs.find(
        (entry) => entry.device_ref === deviceKey,
      );
      const next = { ...current };
      if (row) {
        const kind = normalizeSensorInteractionKind(row.interaction_kind);
        next[deviceKey] = {
          ...row,
          interaction_kind: kind,
          config: normalizeSensorInteractionConfig(kind, row.config),
        };
      } else {
        delete next[deviceKey];
      }
      return next;
    });
    setReplacementDrafts((current) => ({ ...current, [deviceKey]: '' }));
    setFeedbackKey(null);
  };
  const deviceSensorConfigMap = useMemo(
    () =>
      Object.fromEntries(
        deviceSensorConfigs.map((row) => [row.device_ref, row]),
      ),
    [deviceSensorConfigs],
  );
  const openDevice = useMemo(
    () =>
      openDeviceKey
        ? (devices.find((device) => getDeviceKey(device) === openDeviceKey) ??
          null)
        : null,
    [devices, openDeviceKey],
  );
  useAssistantPageContext(
    openDevice && openDeviceKey
      ? {
          kind: 'device',
          id: openDeviceKey,
          label: getDeviceDisplayLabel(openDevice, deviceDisplayNameMap),
        }
      : { kind: 'device' },
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

  const selectedLights = selectedKeys.filter((key) =>
    liveDevices.some(
      (device) => getDeviceKey(device) === key && canCalibrateDevice(device),
    ),
  );

  // Long-pressing a device card (touch) enters selection mode with that
  // device selected, so one light can be picked without the Select button.
  const selectDeviceByLongPress = (deviceKey: string) => {
    setSelectMode(true);
    setSelectedKeys((selected) => toggleSelectedKey(selected, deviceKey));
  };

  const applyCalibration = async (profileId: string | null) => {
    setError(null);
    setNotice(null);
    try {
      if (selectedLights.length !== selectedKeys.length)
        throw new Error(
          'Some selected lights are no longer available for calibration. Clear the selection and select them again.',
        );
      const count = selectedLights.length;
      await assignCalibration.mutateAsync({
        deviceKeys: selectedLights,
        profileId,
      });
      setNotice(
        profileId
          ? `Applied ${calibrationProfiles.find((profile) => profile.id === profileId)?.name ?? 'profile'} to ${count} lights.`
          : `Removed calibration from ${count} lights.`,
      );
      setSelectedKeys([]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not assign calibration',
      );
    }
  };

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
  // Names that collide are the one case where the raw key is worth showing on
  // the card; otherwise it belongs in the expanded detail.
  const duplicateLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const device of liveDevices) {
      const label = getDeviceDisplayLabel(device, deviceDisplayNameMap);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([label]) => label),
    );
  }, [deviceDisplayNameMap, liveDevices]);

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

          if (
            deviceIntegrationFilter !== 'all' &&
            entry.device.integration_id !== deviceIntegrationFilter
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
      deviceIntegrationFilter,
      deviceSensorConfigMap,
      deviceTypeFilter,
      groupIdsByDeviceKey,
      groups,
      liveDevices,
      normalizedSearch,
    ],
  );
  const integrationIds = useMemo(
    () =>
      Array.from(
        new Set(devices.map((device) => device.integration_id)),
      ).sort(),
    [devices],
  );
  const batchDevices = useMemo(
    () => visibleDevices.slice(0, visibleCount),
    [visibleCount, visibleDevices],
  );
  const remainingDevices = visibleDevices.length - batchDevices.length;

  useEffect(() => {
    setVisibleCount(30);
  }, [
    deviceGroupFilter,
    deviceIntegrationFilter,
    deviceSearch,
    deviceTypeFilter,
  ]);

  const activeFilters = useMemo(() => {
    const chips: { label: string; clear: () => void }[] = [];
    if (deviceSearch.trim() !== '') {
      chips.push({
        label: `Search: ${deviceSearch.trim()}`,
        clear: () => setDeviceSearch(''),
      });
    }
    if (deviceTypeFilter !== 'all') {
      chips.push({
        label:
          deviceTypeFilter === 'controllable'
            ? 'Type: lights / devices'
            : deviceTypeFilter === 'sensor'
              ? 'Type: sensors'
              : 'Type: other',
        clear: () => setDeviceTypeFilter('all'),
      });
    }
    if (deviceGroupFilter !== 'all') {
      chips.push({
        label: `Room: ${availableGroups.find((group) => group.id === deviceGroupFilter)?.name ?? deviceGroupFilter}`,
        clear: () => setDeviceGroupFilter('all'),
      });
    }
    if (deviceIntegrationFilter !== 'all') {
      chips.push({
        label: `Integration: ${deviceIntegrationFilter}`,
        clear: () => setDeviceIntegrationFilter('all'),
      });
    }
    return chips;
  }, [
    availableGroups,
    deviceGroupFilter,
    deviceIntegrationFilter,
    deviceSearch,
    deviceTypeFilter,
  ]);

  const activeFilterCount =
    (deviceTypeFilter !== 'all' ? 1 : 0) +
    (deviceGroupFilter !== 'all' ? 1 : 0) +
    (deviceIntegrationFilter !== 'all' ? 1 : 0);
  const calibratableVisibleKeys = useMemo(
    () =>
      visibleDevices
        .filter((entry) => canCalibrateDevice(entry.device))
        .map((entry) => entry.deviceKey),
    [visibleDevices],
  );

  useEffect(() => {
    if (
      !requestedDeviceKey ||
      appliedDeviceRequest.current === requestedDeviceKey ||
      !visibleDevices.some((entry) => entry.deviceKey === requestedDeviceKey)
    ) {
      return;
    }

    appliedDeviceRequest.current = requestedDeviceKey;
    setOpenDeviceKey(requestedDeviceKey);
  }, [requestedDeviceKey, visibleDevices]);

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
    setFeedbackKey(deviceKey);
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
      !(await confirmDialog({
        title: `Replace "${getDefaultDeviceLabel(device)}"?`,
        description: `All references are rewritten to "${replacementOption.label}", then the current device is deleted from memory and the database.`,
        confirmLabel: 'Replace device',
        destructive: true,
      }))
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
      const updatedReferences = (
        [
          [result?.updated_integrations ?? 0, 'integration'],
          [result?.updated_groups ?? 0, 'group'],
          [result?.updated_scenes ?? 0, 'scene'],
          [result?.updated_routines ?? 0, 'routine'],
          [result?.updated_scene_overrides ?? 0, 'scene override'],
          [result?.updated_dashboard_widgets ?? 0, 'dashboard widget'],
          [result?.updated_calibration_profiles ?? 0, 'calibration profile'],
        ] as Array<[number, string]>
      )
        .filter(([count]) => count > 0)
        .map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`)
        .join(', ');
      setNotice(
        `Replaced references for ${getDefaultDeviceLabel(device)}${updatedReferences ? `: ${updatedReferences}.` : '.'}`,
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
      !(await confirmDestructive(
        `Delete "${getDefaultDeviceLabel(device)}"?`,
        'The device is removed from runtime memory and the database, and its config references are cleaned up.',
      ))
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
      const updatedReferences = (
        [
          [result?.updated_integrations ?? 0, 'integration'],
          [result?.updated_groups ?? 0, 'group'],
          [result?.updated_scenes ?? 0, 'scene'],
          [result?.updated_routines ?? 0, 'routine'],
          [result?.updated_scene_overrides ?? 0, 'scene override'],
          [result?.updated_dashboard_widgets ?? 0, 'dashboard widget'],
          [result?.updated_calibration_profiles ?? 0, 'calibration profile'],
        ] as Array<[number, string]>
      )
        .filter(([count]) => count > 0)
        .map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`)
        .join(', ');
      setNotice(
        `Deleted ${getDefaultDeviceLabel(device)}${updatedReferences ? ` and removed ${updatedReferences}.` : '.'}`,
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
        description="Find a device, see its current state, and change how it appears or behaves."
        actions={undefined}
      />

      {error && (
        <Alert variant="destructive">
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

      <Card className="sticky top-0 z-20 border-border/60 bg-background/95 backdrop-blur">
        <CardContent className="space-y-2 p-3">
          {/* Search has room to type; filters and bulk select sit in a second
              row instead of competing with it for width. */}
          <div className="relative min-w-0">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                className="h-9 pl-9"
                placeholder="Search devices by label, id, or room"
                aria-label="Search devices"
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              aria-expanded={filtersOpen}
              aria-controls="device-filters"
              onClick={() => setFiltersOpen((current) => !current)}
            >
              <SlidersHorizontal className="size-4" />
              Filters
              {activeFilterCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 justify-center rounded-full px-1 text-[0.65rem]"
                >
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
            <span className="sr-only" aria-hidden>
              {''}
            </span>
            <div
              id="device-filters"
              hidden={!filtersOpen}
              className="w-full space-y-4 rounded-xl border border-border bg-card p-3"
            >
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Type</span>
                <select
                  className={selectClassName + ' h-9 w-full'}
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
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Room</span>
                <SearchablePicker
                  options={[
                    { value: 'all', label: 'All rooms' },
                    ...availableGroups.map((group) => ({
                      value: group.id,
                      label: group.name,
                      detail: group.hidden ? `${group.id} · hidden` : group.id,
                    })),
                  ]}
                  value={deviceGroupFilter}
                  onChange={setDeviceGroupFilter}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Integration</span>
                <SearchablePicker
                  options={[
                    { value: 'all', label: 'All integrations' },
                    ...integrationIds.map((integrationId) => ({
                      value: integrationId,
                      label: integrationId,
                    })),
                  ]}
                  value={deviceIntegrationFilter}
                  onChange={setDeviceIntegrationFilter}
                />
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={activeFilterCount === 0}
                onClick={() => {
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                  setDeviceIntegrationFilter('all');
                }}
              >
                Clear filters
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setFiltersOpen(false);
                  resultsRef.current?.focus();
                }}
              >
                Show {visibleDevices.length} device
                {visibleDevices.length === 1 ? '' : 's'}
              </Button>
            </div>

            <Button
              variant={selectMode ? 'secondary' : 'outline'}
              size="sm"
              className="h-9"
              aria-pressed={selectMode}
              onClick={() =>
                setSelectMode((current) => {
                  if (current) {
                    setSelectedKeys([]);
                  }
                  return !current;
                })
              }
            >
              <CheckSquare className="size-4" />
              {selectMode ? 'Done' : 'Select'}
            </Button>

            <span
              ref={resultsRef}
              tabIndex={-1}
              className="ml-auto text-sm text-muted-foreground focus-visible:outline-none"
            >
              {visibleDevices.length === devices.length
                ? `${devices.length} devices`
                : `${visibleDevices.length} of ${devices.length} devices`}
              {visibleDevices.length > batchDevices.length
                ? ` · showing ${batchDevices.length}`
                : ''}
            </span>
          </div>
          {activeFilters.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters.map((chip) => (
                <Badge
                  key={chip.label}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs"
                >
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Remove filter ${chip.label}`}
                    className="rounded px-1 text-muted-foreground hover:text-foreground"
                    onClick={chip.clear}
                  >
                    ✕
                  </button>
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                  setDeviceIntegrationFilter('all');
                }}
              >
                Clear all
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {batchDevices.map((entry) => {
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
          // One actionable line when what the device reports disagrees with
          // what homectl asked for; nothing when they agree.
          const controllable =
            'Controllable' in device.data ? device.data.Controllable : null;
          const reported = controllable?.last_report?.state ?? null;
          const requested = controllable?.state ?? null;
          const discrepancy =
            reported && requested && reported.power !== requested.power
              ? `Reports ${reported.power ? 'on' : 'off'}, but homectl set it ${requested.power ? 'on' : 'off'}`
              : reported && requested && reported.power && requested.power
                ? Math.abs(
                    (reported.brightness ?? 0) - (requested.brightness ?? 0),
                  ) > 0.05
                  ? `Reports ${Math.round((reported.brightness ?? 0) * 100)}%, but homectl set ${Math.round((requested.brightness ?? 0) * 100)}%`
                  : null
                : null;

          return (
            <ExpandableConfigCard
              key={deviceKey}
              open={isOpen}
              onOpen={() => {
                setOpenDeviceKey(deviceKey);
                resetDeviceDrafts(deviceKey);
              }}
              onClose={() => {
                setOpenDeviceKey((current) =>
                  current === deviceKey ? null : current,
                );
                setFeedbackKey((current) =>
                  current === deviceKey ? null : current,
                );
              }}
              cardClassName="h-fit"
              onLongPress={
                canCalibrateDevice(device)
                  ? () => selectDeviceByLongPress(deviceKey)
                  : undefined
              }
              dialogTitle={label}
              dialogSubtitle={deviceKey}
              summary={
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    {selectMode && canCalibrateDevice(device) && (
                      <label
                        className="flex items-center gap-2 pt-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          aria-label={`Select ${label}`}
                          checked={selectedKeys.includes(deviceKey)}
                          disabled={assignCalibration.isPending}
                          onChange={() =>
                            setSelectedKeys((selected) =>
                              toggleSelectedKey(selected, deviceKey),
                            )
                          }
                        />
                      </label>
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold">
                        {label}
                      </h2>
                      {duplicateLabels.has(label) ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {deviceKey}
                        </div>
                      ) : null}
                    </div>

                    {hasDisplayOverride && <Badge>Custom label</Badge>}
                  </div>
                  {calibrationAssignments.find(
                    (row) => row.device_key === deviceKey,
                  ) && (
                    <Badge variant="outline">
                      {calibrationProfiles.find(
                        (profile) =>
                          profile.id ===
                          calibrationAssignments.find(
                            (row) => row.device_key === deviceKey,
                          )?.profile_id,
                      )?.name ?? 'Calibrated'}
                    </Badge>
                  )}

                  <div className="text-sm text-foreground/80">
                    {'Controllable' in device.data
                      ? `Set to ${runtimeSummary}`
                      : runtimeSummary}
                  </div>

                  {resolvedColorPreview && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        title={
                          stateSource && stateSource.kind !== 'device_state'
                            ? 'Colour resolved from its scene or source'
                            : 'Colour the device reports'
                        }
                      >
                        <ResolvedColorDot
                          color={resolvedColorPreview.color}
                          isPowered={resolvedColorPreview.isPowered}
                        />
                      </span>
                    </div>
                  )}

                  {discrepancy && (
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      {discrepancy}
                    </p>
                  )}
                </div>
              }
            >
              {isOpen ? (
                <div className="space-y-4">
                  <div className="space-y-4">
                    {'Controllable' in device.data ? (
                      <ConfigFormSection
                        title="Live controls"
                        description="The same power, brightness, and color controls available from the floorplan device modal. These are immediate commands, not settings."
                        actions={
                          <DeviceReportStatus devices={[device]} detail />
                        }
                      >
                        <DeviceQuickControls devices={[device]} />
                      </ConfigFormSection>
                    ) : null}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <ConfigFormSection
                      title="What this device reports"
                      description="Current information from its connection. Values may lag behind a physical change."
                    >
                      {'Controllable' in device.data ? (
                        <div className="space-y-4">
                          <DeviceFactRow
                            label="Active scene"
                            value={getSceneLabel(activeSceneId, sceneNameById)}
                          />
                          <DeviceFactRow
                            label="Requested state"
                            value={runtimeSummary}
                          />
                          <DeviceFactRow
                            label="State source"
                            value={sourceSummary.description}
                          />

                          {stateDetails.length > 0 && (
                            <div className="space-y-2 pt-1">
                              <div className="text-xs text-muted-foreground">
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
                        <div className="space-y-4">
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
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-2"
                      >
                        <Link
                          to={`/config/routine-history?q=${encodeURIComponent(deviceKey)}`}
                        >
                          See automations started by this device
                        </Link>
                      </Button>
                    </ConfigFormSection>

                    <ConfigFormSection
                      title="Identity"
                      description="Static ids, display names, capabilities, and config group membership."
                    >
                      <div className="space-y-4">
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
                            <div className="text-xs text-muted-foreground">
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
                          <div className="text-xs text-muted-foreground">
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
                  </div>

                  <div className="space-y-4">
                    {canCalibrateDevice(device) ? (
                      <ConfigFormSection
                        title="Color calibration"
                        description="Calibration corrects the color this light shows compared to what the app asked for. It needs the light switched on and takes a few steps; nothing changes until you finish the wizard."
                      >
                        {calibrationOpen === deviceKey ? (
                          <ColorCalibrationWizard
                            key={deviceKey}
                            device={device}
                            devices={liveDevices}
                          />
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-expanded={false}
                            onClick={() => setCalibrationOpen(deviceKey)}
                          >
                            Start calibration
                          </Button>
                        )}
                      </ConfigFormSection>
                    ) : null}
                    <ConfigFormSection
                      title={
                        'Sensor' in device.data
                          ? 'Display and sensor behavior'
                          : 'Display'
                      }
                      description={
                        'Sensor' in device.data
                          ? 'How this device is displayed, and how its sensor payload is presented in control surfaces.'
                          : 'How this device is labelled and displayed in control surfaces.'
                      }
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

                      {feedbackKey === deviceKey && (error || notice) ? (
                        <Alert variant={error ? 'destructive' : 'default'}>
                          <AlertDescription>{error ?? notice}</AlertDescription>
                        </Alert>
                      ) : null}

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
                          Use integration label
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
                            Use auto sensor UI
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
                  </div>

                  <div className="space-y-4">
                    {'Sensor' in device.data ? (
                      <ConfigFormSection
                        title="Testing"
                        description="These actions fake sensor input so you can test routines. They change nothing about the physical device and are separate from everyday controls."
                      >
                        <SensorActionPanel
                          device={device}
                          sensorConfig={
                            deviceSensorConfigMap[deviceRef] ?? null
                          }
                        />
                      </ConfigFormSection>
                    ) : null}

                    <div>
                      <ConfigFormSection
                        title="Technical details"
                        description="The device key and the latest raw payload published by the integration, exactly as it arrived."
                      >
                        <p className="text-sm">
                          <span className="text-muted-foreground">Key: </span>
                          <span className="font-mono text-xs break-all">
                            {deviceRef}
                          </span>
                        </p>
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
                    </div>
                    <details className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Replace references or delete this device
                      </summary>
                      <div className="mt-3 space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Replace references: scenes, rooms, and routines that
                            name this device point at the replacement instead.
                          </p>
                          <ConfigField
                            label="Replacement device"
                            className="w-full max-w-md"
                          >
                            <SearchablePicker
                              options={availableReplacementOptions.map(
                                (option) => ({
                                  value: option.key,
                                  label: option.label,
                                  detail: option.key,
                                }),
                              )}
                              value={replacementDraft}
                              onChange={(key) =>
                                setReplacementDrafts((previous) => ({
                                  ...previous,
                                  [deviceKey]: key,
                                }))
                              }
                              placeholder="Select replacement device…"
                              disabled={isSaving || isMutating}
                            />
                          </ConfigField>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-amber-400/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                            disabled={
                              isSaving || isMutating || !replacementDraft
                            }
                            onClick={() => void replaceDeviceReferences(device)}
                          >
                            {isMutating && (
                              <span className={spinnerClassName} />
                            )}
                            Replace references
                          </Button>
                        </div>

                        <div className="space-y-2 border-t border-destructive/30 pt-3">
                          <p className="text-xs text-muted-foreground">
                            Delete: the device disappears from runtime memory
                            and the database, and saved references to it are
                            removed.
                          </p>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isSaving || isMutating}
                            onClick={() => void deleteDeviceConfig(device)}
                          >
                            {isMutating && (
                              <span className={spinnerClassName} />
                            )}
                            Delete device
                          </Button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              ) : null}
            </ExpandableConfigCard>
          );
        })}
      </div>

      {remainingDevices > 0 ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((count) => count + 30)}
          >
            Show {Math.min(30, remainingDevices)} more ({remainingDevices}{' '}
            hidden by paging)
          </Button>
        </div>
      ) : null}

      {visibleDevices.length === 0 && (
        <EmptyState
          title={
            devices.length === 0
              ? 'No devices yet'
              : 'No devices match the current filters'
          }
          description={
            devices.length === 0
              ? 'Devices appear here once an integration reports them.'
              : 'Clear filters or search for another label, id, or group.'
          }
          action={
            devices.length === 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/config/integrations">Set up an integration</Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeviceSearch('');
                  setDeviceTypeFilter('all');
                  setDeviceGroupFilter('all');
                  setDeviceIntegrationFilter('all');
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      )}
      {selectMode ? (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">
            {selectedKeys.length} selected
            {selectedKeys.some(
              (key) => !visibleDevices.some((entry) => entry.deviceKey === key),
            )
              ? ' (including hidden by filters)'
              : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={calibratableVisibleKeys.length === 0}
            onClick={() =>
              setSelectedKeys((selected) =>
                toggleSelection(selected, calibratableVisibleKeys),
              )
            }
          >
            {calibratableVisibleKeys.length > 0 &&
            calibratableVisibleKeys.every((key) => selectedKeys.includes(key))
              ? 'Deselect visible lights'
              : `Select ${calibratableVisibleKeys.length} visible lights`}
          </Button>
          {selectedKeys.length > 0 ? (
            <>
              <div className="min-w-48">
                <SearchablePicker
                  options={calibrationProfiles.map((profile) => ({
                    value: profile.id,
                    label: profile.name,
                    detail: profile.id,
                  }))}
                  value={batchProfileId}
                  onChange={setBatchProfileId}
                  placeholder="Choose calibration profile"
                  ariaLabel="Calibration profile for selected lights"
                  disabled={assignCalibration.isPending || profilesLoading}
                />
              </div>
              <Button
                size="sm"
                disabled={
                  assignCalibration.isPending ||
                  !batchProfileId ||
                  profilesLoading ||
                  !!profilesError
                }
                onClick={() => void applyCalibration(batchProfileId)}
              >
                Apply to {selectedKeys.length} lights
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={assignCalibration.isPending}
                onClick={() => void applyCalibration(null)}
              >
                Remove calibration
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={assignCalibration.isPending}
                onClick={() => setSelectedKeys([])}
              >
                Clear
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              Select lights to apply a calibration profile in bulk.
            </span>
          )}
          {profilesError && (
            <p role="alert" className="w-full text-sm">
              {profilesError}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
