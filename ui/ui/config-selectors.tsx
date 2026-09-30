import { useScenesState } from '@/hooks/websocket';
import { StatePreview } from '@/ui/settings/StatePreview';
import { Link } from 'react-router-dom';
import { ExternalLink, Plus } from 'lucide-react';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';
import type { ReactNode } from 'react';
export function ReferenceField({
  kind,
  value,
  children,
}: {
  kind:
    'device' | 'group' | 'scene' | 'routine' | 'helper' | 'source' | 'block';
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {value && !value.startsWith('__block_input__') && (
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={`Open ${kind} details`}
        >
          <Link to={configItemHref(kind, value)}>
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      )}
    </div>
  );
}
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
    <ReferenceField kind="device" value={value}>
      <SearchablePicker
        options={useDeviceOptions(devices)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </ReferenceField>
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
      hrefFor={(key) =>
        key.startsWith('__block_input__')
          ? undefined
          : configItemHref('device', key)
      }
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
    <ReferenceField kind="group" value={value}>
      <SearchablePicker
        options={groupOptions(groups)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </ReferenceField>
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
      hrefFor={(key) =>
        key.startsWith('__block_input__')
          ? undefined
          : configItemHref('group', key)
      }
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
  createReturnTo,
  ariaLabel,
}: {
  scenes: IdNameOption[];
  value: string;
  onChange: (sceneId: string) => void;
  placeholder?: string;
  createReturnTo?: string;
  ariaLabel?: string;
}) {
  const state = useScenesState()?.[value];
  const resolved = Object.values(state?.devices ?? {});
  const first = resolved[0];
  const mixed = resolved.some(
    (item) => JSON.stringify(item) !== JSON.stringify(first),
  );
  return (
    <div className="space-y-2">
      <ReferenceField kind="scene" value={value}>
        <div className="flex min-w-0 items-start gap-2">
          {value && (
            <div className="flex h-11 shrink-0 items-center md:h-9">
              <StatePreview
                {...first}
                certainty={!first ? 'unresolved' : mixed ? 'mixed' : 'known'}
                samples={resolved.flatMap((item) =>
                  item.color ? [item.color] : [],
                )}
                source="Saved scene"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <SearchablePicker
              options={scenes.map((scene) => ({
                value: scene.id,
                label: scene.name,
                detail: scene.id,
              }))}
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              ariaLabel={ariaLabel}
            />
          </div>
        </div>
      </ReferenceField>
      {createReturnTo && (
        <Link
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          to={`/config/scenes/new?returnTo=${encodeURIComponent(createReturnTo)}`}
        >
          <Plus className="size-3" />
          Create a scene
        </Link>
      )}
    </div>
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
    <ReferenceField kind="routine" value={value}>
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
    </ReferenceField>
  );
}
