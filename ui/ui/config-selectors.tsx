import { type Device } from '@/bindings/Device';
import { type DevicesState } from '@/bindings/DevicesState';
import { type FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useDeviceDisplayNames } from '@/hooks/useConfig';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import {
  SearchableMultiPicker,
  SearchablePicker,
  type PickerOption,
} from '@/ui/SearchablePicker';

type IdNameOption = { id: string; name: string };

function useDeviceOptions(devices: DevicesState): PickerOption[] {
  const { data: names } = useDeviceDisplayNames();
  const displayNames = Object.fromEntries(
    names.map((row) => [row.device_key, row.display_name]),
  );
  return Object.entries(devices)
    .filter((entry): entry is [string, Device] => Boolean(entry[1]))
    .map(([key, device]) => ({
      value: key,
      label: getDeviceDisplayLabel(device, displayNames),
      detail: key,
    }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
    );
}

function groupOptions(groups: FlattenedGroupsConfig): PickerOption[] {
  return Object.entries(groups)
    .map(([key, group]) => ({
      value: key,
      label: group?.name ?? key,
      detail: key,
    }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
    );
}

export function splitDeviceKey(deviceKey: string) {
  const [integrationId, ...deviceIdParts] = deviceKey.split('/');
  if (!integrationId || deviceIdParts.length === 0) return null;
  return { integration_id: integrationId, device_id: deviceIdParts.join('/') };
}

export function DeviceSelect({
  devices,
  value,
  onChange,
  placeholder = 'Select device...',
}: {
  devices: DevicesState;
  value: string;
  onChange: (deviceKey: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <SearchablePicker
      options={useDeviceOptions(devices)}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
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
  return (
    <SearchableMultiPicker
      options={useDeviceOptions(devices)}
      value={value}
      onChange={onChange}
      placeholder="Add devices…"
    />
  );
}

export function GroupSelect({
  groups,
  value,
  onChange,
  placeholder = 'Select group...',
}: {
  groups: FlattenedGroupsConfig;
  value: string;
  onChange: (groupId: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <SearchablePicker
      options={groupOptions(groups)}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
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
  return (
    <SearchableMultiPicker
      options={groupOptions(groups)}
      value={value}
      onChange={onChange}
      placeholder="Add groups…"
    />
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
    <SearchablePicker
      options={scenes.map((scene) => ({
        value: scene.id,
        label: scene.name,
        detail: scene.id,
      }))}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
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
    <SearchablePicker
      options={routines.map((routine) => ({
        value: routine.id,
        label: routine.name,
        detail: routine.id,
      }))}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}
