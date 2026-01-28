'use client';

import { useGroups, Group } from '@/hooks/useConfig';
import { useState } from 'react';

export default function GroupsPage() {
  const { data: groups, loading, error, create, update, remove } = useGroups();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
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

      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreate={async (group) => {
            await create(group);
            setShowCreate(false);
          }}
          existingGroups={groups}
        />
      )}
    </div>
  );
}

function GroupCard({
  group,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  group: Group;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (group: Partial<Group>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [hidden, setHidden] = useState(group.hidden);
  const [devices, setDevices] = useState(JSON.stringify(group.devices, null, 2));
  const [linkedGroups, setLinkedGroups] = useState(group.linked_groups.join(', '));

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

          <div className="form-control">
            <label className="label">
              <span className="label-text">Devices (JSON)</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-24 font-mono text-xs"
              value={devices}
              onChange={(e) => setDevices(e.target.value)}
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Linked Groups (comma-separated)</span>
            </label>
            <input
              type="text"
              className="input input-bordered"
              value={linkedGroups}
              onChange={(e) => setLinkedGroups(e.target.value)}
              placeholder="group1, group2"
            />
          </div>

          <div className="card-actions justify-end mt-2">
            <button className="btn btn-sm btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                try {
                  onSave({
                    name,
                    hidden,
                    devices: JSON.parse(devices),
                    linked_groups: linkedGroups
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                } catch {
                  alert('Invalid devices JSON');
                }
              }}
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

        <div className="text-sm mt-2">
          <span className="font-medium">{group.devices.length}</span> devices
          {group.linked_groups.length > 0 && (
            <span className="ml-2">
              · <span className="font-medium">{group.linked_groups.length}</span> linked
            </span>
          )}
        </div>

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
  existingGroups,
}: {
  onClose: () => void;
  onCreate: (group: Partial<Group>) => Promise<void>;
  existingGroups: Group[];
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
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

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !name}
            onClick={() => onCreate({ id, name, hidden, devices: [], linked_groups: [] })}
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
