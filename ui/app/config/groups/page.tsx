import { useState } from 'react';

import { type Device } from '@/bindings/Device';
import {
  type Group,
  useDeviceDisplayNames,
  useGroups,
} from '@/hooks/useConfig';
import { matchesConfigSearch } from '@/lib/configSearch';
import { getDeviceKey } from '@/lib/device';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigReadOnlyGrid,
  ConfigReadOnlyItem,
  ConfigToggleRow,
} from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';

const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const fieldLabelClassName = 'text-sm font-medium';

type GroupDevice = Group['devices'][number];

const getGroupDeviceKey = (device: GroupDevice) =>
  `${device.integration_id}/${device.device_id}`;

const getGroupSearchValues = (
  group: Group,
  deviceDisplayNameMap: Record<string, string>,
  devicesByKey: Record<string, Device>,
) => {
  const deviceLabels = group.devices.map((device) => {
    const deviceKey = getGroupDeviceKey(device);
    const matchingDevice = devicesByKey[deviceKey];

    return matchingDevice
      ? getDeviceDisplayLabel(matchingDevice, deviceDisplayNameMap)
      : getDeviceDisplayLabelFromKey(
          deviceKey,
          device.device_id,
          deviceDisplayNameMap,
        );
  });

  return [
    group.id,
    group.name,
    group.hidden ? 'hidden' : 'visible',
    group.linked_groups,
    group.devices.map((device) => getGroupDeviceKey(device)),
    deviceLabels,
  ];
};

export default function GroupsPage() {
  const { data: groups, loading, error, create, update, remove } = useGroups();
  const { devices: allDevices } = useDevicesApi();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const editingGroup = groups.find((group) => group.id === editingId);
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const devicesByKey = Object.fromEntries(
    allDevices.map((device) => [getDeviceKey(device), device]),
  ) as Record<string, Device>;
  const visibleGroups = groups.filter((group) =>
    matchesConfigSearch(
      search,
      ...getGroupSearchValues(group, deviceDisplayNameMap, devicesByKey),
    ),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading groups: {error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Groups"
        description="Organize devices and nested groups into controllable targets."
        actions={<Button onClick={() => setShowCreate(true)}>Add Group</Button>}
      />

      <ConfigListSearchBar
        filteredCount={visibleGroups.length}
        onChange={setSearch}
        placeholder="Search by name, id, or devices"
        totalCount={groups.length}
        value={search}
      />

      {visibleGroups.length === 0 ? (
        <EmptyState
          title="No groups match the current search"
          description="Try another name, id, linked group, or device label."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              allGroups={groups}
              deviceDisplayNameMap={deviceDisplayNameMap}
              devicesByKey={devicesByKey}
              onEdit={() => setEditingId(group.id)}
              onDelete={async () => {
                if (confirm(`Delete group "${group.name}"?`)) {
                  await remove(group.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <GroupOverlay
          allGroups={groups}
          onClose={() => setShowCreate(false)}
          onSubmit={async (group) => {
            await create(group);
            setShowCreate(false);
          }}
        />
      )}

      {editingGroup && (
        <GroupOverlay
          mode="edit"
          group={editingGroup}
          allGroups={groups}
          onClose={() => setEditingId(null)}
          onSubmit={async (updated) => {
            await update(editingGroup.id, updated);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function DevicePicker({
  selected,
  onChange,
}: {
  selected: GroupDevice[];
  onChange: (devices: GroupDevice[]) => void;
}) {
  const { devices: allDevices } = useDevicesApi();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const [search, setSearch] = useState('');
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const devicesByKey = Object.fromEntries(
    allDevices.map((device) => [getDeviceKey(device), device]),
  ) as Record<string, Device>;
  const availableDevices = allDevices
    .map((device) => ({
      key: getDeviceKey(device),
      label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
      device,
    }))
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
    );

  const isSelected = (deviceKey: string) =>
    selected.some((device) => getGroupDeviceKey(device) === deviceKey);

  const toggle = (deviceKey: string) => {
    if (isSelected(deviceKey)) {
      onChange(
        selected.filter((device) => getGroupDeviceKey(device) !== deviceKey),
      );
      return;
    }

    const nextDevice = devicesByKey[deviceKey];
    if (!nextDevice) {
      return;
    }

    onChange([
      ...selected,
      {
        integration_id: nextDevice.integration_id,
        device_id: nextDevice.id,
      },
    ]);
  };

  const filtered = availableDevices.filter(({ key, label, device }) =>
    `${label} ${device.name} ${key}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <div className={fieldLabelClassName}>
        Devices ({selected.length} selected)
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((device) => {
            const deviceKey = getGroupDeviceKey(device);
            const matchingDevice = devicesByKey[deviceKey];
            const label = matchingDevice
              ? getDeviceDisplayLabel(matchingDevice, deviceDisplayNameMap)
              : getDeviceDisplayLabelFromKey(
                  deviceKey,
                  device.device_id,
                  deviceDisplayNameMap,
                );

            return (
              <Badge key={deviceKey} variant="secondary" className="gap-1">
                {label}
                <button
                  type="button"
                  className="text-xs opacity-60 hover:opacity-100"
                  onClick={() => toggle(deviceKey)}
                >
                  ✕
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <Input
        className="h-9"
        placeholder="Search devices..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="max-h-48 overflow-y-auto rounded-2xl border border-border bg-background/60 p-1">
        {filtered.length === 0 ? (
          <div className="p-2 text-center text-sm text-muted-foreground">
            {availableDevices.length === 0
              ? 'No devices available'
              : 'No matching devices'}
          </div>
        ) : (
          filtered.map(({ key, label, device }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-muted"
            >
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={isSelected(key)}
                onChange={() => toggle(key)}
              />
              <span className="truncate text-sm">{label}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {device.integration_id}/{device.id}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function GroupLinker({
  currentGroupId,
  allGroups,
  selected,
  onChange,
}: {
  currentGroupId?: string;
  allGroups: Group[];
  selected: string[];
  onChange: (groups: string[]) => void;
}) {
  const available = allGroups.filter((group) => group.id !== currentGroupId);

  if (available.length === 0) {
    return null;
  }

  const toggle = (groupId: string) => {
    if (selected.includes(groupId)) {
      onChange(selected.filter((id) => id !== groupId));
    } else {
      onChange([...selected, groupId]);
    }
  };

  return (
    <div className="space-y-2">
      <div className={fieldLabelClassName}>
        Linked Groups ({selected.length} selected)
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => {
            const group = allGroups.find((item) => item.id === id);
            return (
              <Badge key={id} className="gap-1">
                {group?.name ?? id}
                <button
                  type="button"
                  className="text-xs opacity-60 hover:opacity-100"
                  onClick={() => toggle(id)}
                >
                  ✕
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="max-h-32 overflow-y-auto rounded-2xl border border-border bg-background/60 p-1">
        {available.map((group) => (
          <label
            key={group.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-muted"
          >
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={selected.includes(group.id)}
              onChange={() => toggle(group.id)}
            />
            <span className="truncate text-sm">{group.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {group.id}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  allGroups,
  deviceDisplayNameMap,
  devicesByKey,
  onEdit,
  onDelete,
}: {
  group: Group;
  allGroups: Group[];
  deviceDisplayNameMap: Record<string, string>;
  devicesByKey: Record<string, Device>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{group.name}</CardTitle>
            <CardDescription>{group.id}</CardDescription>
          </div>
          {group.hidden && <Badge variant="muted">Hidden</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {group.devices.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {group.devices.map((device) => {
              const deviceKey = getGroupDeviceKey(device);
              const matchingDevice = devicesByKey[deviceKey];
              const label = matchingDevice
                ? getDeviceDisplayLabel(matchingDevice, deviceDisplayNameMap)
                : getDeviceDisplayLabelFromKey(
                    deviceKey,
                    device.device_id,
                    deviceDisplayNameMap,
                  );

              return (
                <Badge key={deviceKey} variant="secondary">
                  {label}
                </Badge>
              );
            })}
          </div>
        )}

        {group.linked_groups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {group.linked_groups.map((id) => {
              const linked = allGroups.find((item) => item.id === id);
              return (
                <Badge key={id} variant="outline">
                  {linked?.name ?? id}
                </Badge>
              );
            })}
          </div>
        )}

        {group.devices.length === 0 && group.linked_groups.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No devices or links
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupOverlay({
  mode = 'create',
  group,
  onClose,
  onSubmit,
  allGroups,
}: {
  mode?: 'create' | 'edit';
  group?: Group;
  onClose: () => void;
  onSubmit: (group: Partial<Group>) => Promise<void>;
  allGroups: Group[];
}) {
  const [id, setId] = useState(group?.id ?? '');
  const [name, setName] = useState(group?.name ?? '');
  const [hidden, setHidden] = useState(group?.hidden ?? false);
  const [devices, setDevices] = useState<GroupDevice[]>(group?.devices ?? []);
  const [linkedGroups, setLinkedGroups] = useState<string[]>(
    group?.linked_groups ?? [],
  );
  const [editTab, setEditTab] = useState<'basics' | 'devices' | 'links'>(
    'basics',
  );
  const isCreate = mode === 'create';

  const changeTab = (value: string) => {
    if (value === 'basics' || value === 'devices' || value === 'links') {
      setEditTab(value);
    }
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={isCreate ? 'Add Group' : `Edit ${group?.name ?? name}`}
      description={
        isCreate
          ? 'Create a group and optionally add devices or linked groups.'
          : 'Update group visibility, device membership, and nested links.'
      }
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="mt-4 space-y-4">
            <ConfigFormSection
              title="Group identity"
              description="Keep ids stable; names and visibility can be adjusted any time."
            >
              {isCreate ? (
                <ConfigField
                  label="Group ID"
                  description="Used in scenes, routines, and nested group references."
                >
                  <Input
                    value={id}
                    onChange={(event) => setId(event.target.value)}
                    placeholder="living-room"
                  />
                </ConfigField>
              ) : (
                <ConfigReadOnlyGrid>
                  <ConfigReadOnlyItem label="Group ID" value={group?.id} />
                </ConfigReadOnlyGrid>
              )}

              <ConfigField label="Name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Living Room"
                />
              </ConfigField>

              <ConfigToggleRow
                label="Hidden"
                description="Hidden groups are available for automation but stay out of primary control surfaces."
              >
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={hidden}
                  onChange={(event) => setHidden(event.target.checked)}
                />
              </ConfigToggleRow>
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="devices" className="mt-4">
            <ConfigFormSection
              title="Devices"
              description="Select all directly controlled devices that belong to this group."
            >
              <DevicePicker selected={devices} onChange={setDevices} />
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="links" className="mt-4">
            <ConfigFormSection
              title="Linked groups"
              description="Nest other groups to build larger controllable areas without duplicating devices."
            >
              <GroupLinker
                currentGroupId={group?.id}
                allGroups={allGroups}
                selected={linkedGroups}
                onChange={setLinkedGroups}
              />
            </ConfigFormSection>
          </TabsContent>
        </Tabs>

        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!id || !name}
            onClick={() =>
              onSubmit({
                id,
                name,
                hidden,
                devices,
                linked_groups: linkedGroups,
              })
            }
          >
            {isCreate ? 'Create' : 'Save'}
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
