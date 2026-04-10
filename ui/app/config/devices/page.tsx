'use client';

import { Device } from '@/bindings/Device';
import {
  useDeviceDisplayNames,
  useDeviceSensorConfigs,
} from '@/hooks/useConfig';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import { getDeviceKey } from '@/lib/device';
import { getDefaultDeviceLabel, getDeviceDisplayLabel } from '@/lib/deviceLabel';
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
import { useEffect, useMemo, useState } from 'react';

type DeviceTypeFilter = 'all' | 'controllable' | 'sensor' | 'other';

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
      This mode does not need extra mapping values. The map modal will render a{' '}
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

export default function DevicesPage() {
  const { devices, loading: devicesLoading } = useDevicesApi();
  const groups = useGroupsState();
  const {
    data: deviceDisplayNames,
    update: updateDeviceDisplayName,
    remove: removeDeviceDisplayName,
  } = useDeviceDisplayNames();
  const {
    data: deviceSensorConfigs,
    update: updateDeviceSensorConfig,
    remove: removeDeviceSensorConfig,
  } = useDeviceSensorConfigs();
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<DeviceTypeFilter>('all');
  const [deviceGroupFilter, setDeviceGroupFilter] = useState('all');
  const [displayNameDrafts, setDisplayNameDrafts] = useState<Record<string, string>>({});
  const [sensorConfigDrafts, setSensorConfigDrafts] = useState<Record<string, DeviceSensorConfig>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      devices
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
          return {
            device,
            deviceKey,
            deviceRef,
            type,
            groupIds,
            groupNames,
            label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
            defaultLabel: getDefaultDeviceLabel(device),
            resolvedInteraction,
            sensorDetails: getSensorDetails(device),
          };
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
      devices,
      groupIdsByDeviceKey,
      groups,
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

  if (devicesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Devices</h1>
        <p className="max-w-3xl text-sm opacity-70">
          Configure user-facing device labels and decide how sensors behave when clicked on the map.
          Button remotes can use fixed button panels, while numeric and text sensors can stay as
          typed inputs.
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
          <div className="flex flex-wrap gap-3 items-end">
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

            <label className="form-control w-full max-w-[12rem]">
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

      <div className="space-y-4">
        {visibleDevices.map((entry) => {
          const {
            device,
            deviceKey,
            deviceRef,
            type,
            groupNames,
            resolvedInteraction,
            sensorDetails,
          } = entry;
          const labelDraft = displayNameDrafts[deviceKey] ?? '';
          const hasDisplayOverride = Boolean(deviceDisplayNameMap[deviceKey]);
          const sensorDraft = sensorConfigDrafts[deviceRef] ?? createEmptySensorConfig(deviceRef);
          const interactionKind = normalizeSensorInteractionKind(sensorDraft.interaction_kind);
          const interactionConfig = normalizeSensorInteractionConfig(interactionKind, sensorDraft.config);
          const isSaving = savingKey === deviceKey;

          return (
            <div key={deviceKey} className="card bg-base-200 shadow-xl">
              <div className="card-body space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div>
                      <h2 className="card-title truncate">{entry.label}</h2>
                      <div className="text-sm opacity-70">{deviceKey}</div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="badge badge-outline">{type}</span>
                      <span className="badge badge-outline">Default label: {entry.defaultLabel}</span>
                      {groupNames.map((groupName) => (
                        <span key={`${deviceKey}-${groupName}`} className="badge badge-ghost">
                          {groupName}
                        </span>
                      ))}
                    </div>
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
                </div>

                {'Sensor' in device.data ? (
                  <div className="space-y-4 rounded-xl border border-base-300 bg-base-100/50 p-4">
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
                      onClick={() => updateSensorDraftKind(deviceRef, 'auto')}
                    >
                      Use Auto Sensor UI
                    </button>
                  )}
                  <button
                    className={`btn btn-sm btn-primary ${isSaving ? 'loading' : ''}`}
                    disabled={isSaving}
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
              </div>
            </div>
          );
        })}

        {visibleDevices.length === 0 && (
          <div className="rounded-xl border border-dashed border-base-300 bg-base-200/40 p-6 text-sm opacity-70">
            No devices match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}