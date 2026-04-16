import { Device } from '@/bindings/Device';
import { useDeviceDisplayNames, useGroups, Group } from '@/hooks/useConfig';
import { matchesConfigSearch } from '@/lib/configSearch';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel, getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { useMemo, useState } from 'react';

type GroupDevice = Group['devices'][number];

const getGroupDeviceKey = (device: GroupDevice) => `${device.integration_id}/${device.device_id}`;

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
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const devicesByKey = Object.fromEntries(
    allDevices.map((device) => [getDeviceKey(device), device]),
  ) as Record<string, Device>;
  const visibleGroups = groups.filter((group) =>
    matchesConfigSearch(search, ...getGroupSearchValues(group, deviceDisplayNameMap, devicesByKey)),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error loading groups: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Groups</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Add Group
        </button>
      </div>

      <ConfigListSearchBar
        filteredCount={visibleGroups.length}
        onChange={setSearch}
        placeholder="Search by name, id, or devices"
        totalCount={groups.length}
        value={search}
      />

      {visibleGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-base-300 bg-base-200/50 p-6 text-center text-sm opacity-70">
          No groups match the current search.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              allGroups={groups}
              deviceDisplayNameMap={deviceDisplayNameMap}
              devicesByKey={devicesByKey}
              isEditing={editingId === group.id}
              onEdit={() => setEditingId(group.id)}
              onSave={async (updated) => {
                await update(group.id, updated);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
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
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreate={async (group) => {
            await create(group);
            setShowCreate(false);
          }}
          allGroups={groups}
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

  const availableDevices = useMemo(() => {
    return allDevices
      .map((device) => ({
        key: getDeviceKey(device),
        label: getDeviceDisplayLabel(device, deviceDisplayNameMap),
        device,
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }, [allDevices, deviceDisplayNameMap]);

  const isSelected = (deviceKey: string) =>
    selected.some((device) => getGroupDeviceKey(device) === deviceKey);

  const toggle = (deviceKey: string) => {
    if (isSelected(deviceKey)) {
      onChange(
        selected.filter((device) => getGroupDeviceKey(device) !== deviceKey),
      );
    } else {
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
    }
  };

  const filtered = availableDevices.filter(({ key, label, device }) =>
    `${label} ${device.name} ${key}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <label className="label">
        <span className="label-text">
          Devices ({selected.length} selected)
        </span>
      </label>

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
              <span key={deviceKey} className="badge badge-sm gap-1">
                {label}
                <button
                  className="text-xs opacity-60 hover:opacity-100"
                  onClick={() => toggle(deviceKey)}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <input
        type="text"
        className="input input-bordered input-sm w-full"
        placeholder="Search devices..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="max-h-48 overflow-y-auto border border-base-300 rounded-lg p-1">
        {filtered.length === 0 ? (
          <div className="text-sm opacity-60 p-2 text-center">
            {availableDevices.length === 0
              ? 'No devices available'
              : 'No matching devices'}
          </div>
        ) : (
          filtered.map(({ key, label, device }) => (
            <label
              key={key}
              className="flex items-center gap-2 p-1.5 hover:bg-base-200 rounded cursor-pointer"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={isSelected(key)}
                onChange={() => toggle(key)}
              />
              <span className="text-sm truncate">{label}</span>
              <span className="text-xs opacity-50 truncate ml-auto">
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
  const available = allGroups.filter((g) => g.id !== currentGroupId);

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
      <label className="label">
        <span className="label-text">
          Linked Groups ({selected.length} selected)
        </span>
      </label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => {
            const group = allGroups.find((g) => g.id === id);
            return (
              <span key={id} className="badge badge-sm badge-primary gap-1">
                {group?.name ?? id}
                <button
                  className="text-xs opacity-60 hover:opacity-100"
                  onClick={() => toggle(id)}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="max-h-32 overflow-y-auto border border-base-300 rounded-lg p-1">
        {available.map((group) => (
          <label
            key={group.id}
            className="flex items-center gap-2 p-1.5 hover:bg-base-200 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={selected.includes(group.id)}
              onChange={() => toggle(group.id)}
            />
            <span className="text-sm truncate">{group.name}</span>
            <span className="text-xs opacity-50 ml-auto">{group.id}</span>
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
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  group: Group;
  allGroups: Group[];
  deviceDisplayNameMap: Record<string, string>;
  devicesByKey: Record<string, Device>;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (group: Partial<Group>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [hidden, setHidden] = useState(group.hidden);
  const [devices, setDevices] = useState<GroupDevice[]>(group.devices);
  const [linkedGroups, setLinkedGroups] = useState<string[]>(
    group.linked_groups,
  );

  if (isEditing) {
    return (
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <input
            type="text"
            className="input input-bordered font-bold text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="form-control">
            <label className="label cursor-pointer">
              <span className="label-text">Hidden</span>
              <input
                type="checkbox"
                className="toggle"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />
            </label>
          </div>

          <DevicePicker selected={devices} onChange={setDevices} />

          <GroupLinker
            currentGroupId={group.id}
            allGroups={allGroups}
            selected={linkedGroups}
            onChange={setLinkedGroups}
          />

          <div className="card-actions justify-end mt-2">
            <button className="btn btn-sm btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                onSave({
                  name,
                  hidden,
                  devices,
                  linked_groups: linkedGroups,
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200 shadow-xl">
      <div className="card-body">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="card-title">{group.name}</h2>
            <div className="text-sm opacity-70">{group.id}</div>
          </div>
          {group.hidden && <div className="badge badge-ghost">Hidden</div>}
        </div>

        {group.devices.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
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
                <span key={deviceKey} className="badge badge-sm badge-ghost">
                  {label}
                </span>
              );
            })}
          </div>
        )}

        {group.linked_groups.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {group.linked_groups.map((id) => {
              const linked = allGroups.find((g) => g.id === id);
              return (
                <span key={id} className="badge badge-sm badge-primary badge-outline">
                  {linked?.name ?? id}
                </span>
              );
            })}
          </div>
        )}

        {group.devices.length === 0 && group.linked_groups.length === 0 && (
          <div className="text-sm opacity-50 mt-2">No devices or links</div>
        )}

        <div className="card-actions justify-end mt-2">
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-sm btn-error btn-ghost" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateGroupModal({
  onClose,
  onCreate,
  allGroups,
}: {
  onClose: () => void;
  onCreate: (group: Partial<Group>) => Promise<void>;
  allGroups: Group[];
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);
  const [devices, setDevices] = useState<GroupDevice[]>([]);
  const [linkedGroups, setLinkedGroups] = useState<string[]>([]);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="font-bold text-lg">Add Group</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Group ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="living-room"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Name</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Living Room"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label cursor-pointer">
            <span className="label-text">Hidden</span>
            <input
              type="checkbox"
              className="toggle"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
          </label>
        </div>

        <div className="mt-4">
          <DevicePicker selected={devices} onChange={setDevices} />
        </div>

        <div className="mt-4">
          <GroupLinker
            allGroups={allGroups}
            selected={linkedGroups}
            onChange={setLinkedGroups}
          />
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !name}
            onClick={() =>
              onCreate({
                id,
                name,
                hidden,
                devices,
                linked_groups: linkedGroups,
              })
            }
          >
            Create
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
