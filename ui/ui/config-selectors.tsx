import { type Device } from '@/bindings/Device';
import { type DevicesState } from '@/bindings/DevicesState';
import { type FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type IdNameOption = { id: string; name: string };

function getDeviceOptions(devices: DevicesState) {
  return Object.entries(devices).map(([key, device]) => ({
    key,
    device: device as Device,
  }));
}

function useDeviceDisplayNameMap() {
  const { data: deviceDisplayNames } = useDeviceDisplayNames();

  return Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
}

export function splitDeviceKey(deviceKey: string) {
  const [integrationId, ...deviceIdParts] = deviceKey.split('/');

  if (!integrationId || deviceIdParts.length === 0) {
    return null;
  }

  return {
    integration_id: integrationId,
    device_id: deviceIdParts.join('/'),
  };
}

export function DeviceSelect({
  devices,
  value,
  onChange,
  placeholder = 'Select device...',
  className,
}: {
  devices: DevicesState;
  value: string;
  onChange: (deviceKey: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const deviceDisplayNameMap = useDeviceDisplayNameMap();
  const deviceOptions = getDeviceOptions(devices)
    .map(({ key, device }) => ({
      key,
      label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );

  return (
    <select
      className={className ?? selectClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {deviceOptions.map(({ key, label }) => (
        <option key={key} value={key}>
          {label} ({key})
        </option>
      ))}
    </select>
  );
}

export function DeviceMultiSelect({
  devices,
  value,
  onChange,
}: {
  devices: DevicesState;
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  const deviceDisplayNameMap = useDeviceDisplayNameMap();
  const deviceOptions = getDeviceOptions(devices)
    .map(({ key, device }) => ({
      key,
      label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );

  const toggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((item) => item !== key));
      return;
    }

    onChange([...value, key]);
  };

  return (
    <div className="max-h-48 overflow-y-auto rounded-2xl border border-border bg-background/60 p-2">
      {deviceOptions.length === 0 ? (
        <div className="p-2 text-center text-sm text-muted-foreground">
          No devices available
        </div>
      ) : (
        deviceOptions.map(({ key, label }) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-muted"
          >
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={value.includes(key)}
              onChange={() => toggle(key)}
            />
            <span className="truncate text-sm">
              {label}{' '}
              <span className="text-xs text-muted-foreground">({key})</span>
            </span>
          </label>
        ))
      )}
    </div>
  );
}

export function GroupSelect({
  groups,
  value,
  onChange,
  placeholder = 'Select group...',
  className,
}: {
  groups: FlattenedGroupsConfig;
  value: string;
  onChange: (groupId: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const groupOptions = Object.entries(groups).sort(([, left], [, right]) =>
    (left?.name ?? '').localeCompare(right?.name ?? ''),
  );

  return (
    <select
      className={className ?? selectClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {groupOptions.map(([key, group]) => (
        <option key={key} value={key}>
          {group?.name ?? key}
        </option>
      ))}
    </select>
  );
}

export function GroupMultiSelect({
  groups,
  value,
  onChange,
}: {
  groups: FlattenedGroupsConfig;
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  const groupOptions = Object.entries(groups).sort(([, left], [, right]) =>
    (left?.name ?? '').localeCompare(right?.name ?? ''),
  );

  const toggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((item) => item !== key));
      return;
    }

    onChange([...value, key]);
  };

  return (
    <div className="max-h-48 overflow-y-auto rounded-2xl border border-border bg-background/60 p-2">
      {groupOptions.length === 0 ? (
        <div className="p-2 text-center text-sm text-muted-foreground">
          No groups available
        </div>
      ) : (
        groupOptions.map(([key, group]) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-muted"
          >
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={value.includes(key)}
              onChange={() => toggle(key)}
            />
            <span className="truncate text-sm">{group?.name ?? key}</span>
          </label>
        ))
      )}
    </div>
  );
}

export function SceneSelect({
  scenes,
  value,
  onChange,
  placeholder = 'Select scene...',
}: {
  scenes: IdNameOption[];
  value: string;
  onChange: (sceneId: string) => void;
  placeholder?: string;
}) {
  return (
    <select
      className={selectClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {scenes.map((scene) => (
        <option key={scene.id} value={scene.id}>
          {scene.name}
        </option>
      ))}
    </select>
  );
}

export function RoutineSelect({
  routines,
  value,
  onChange,
  placeholder = 'Select routine...',
}: {
  routines: IdNameOption[];
  value: string;
  onChange: (routineId: string) => void;
  placeholder?: string;
}) {
  return (
    <select
      className={selectClassName}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {routines.map((routine) => (
        <option key={routine.id} value={routine.id}>
          {routine.name}
        </option>
      ))}
    </select>
  );
}
