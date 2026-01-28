'use client';

import { useRoutines, Routine } from '@/hooks/useConfig';
import { useState } from 'react';

export default function RoutinesPage() {
  const { data: routines, loading, error, create, update, remove } = useRoutines();
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
        <span>Error loading routines: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Routines</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Add Routine
        </button>
      </div>

      <div className="grid gap-4">
        {routines.map((routine) => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            isEditing={editingId === routine.id}
            onEdit={() => setEditingId(routine.id)}
            onSave={async (updated) => {
              await update(routine.id, updated);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            onDelete={async () => {
              if (confirm(`Delete routine "${routine.name}"?`)) {
                await remove(routine.id);
              }
            }}
          />
        ))}
      </div>

      {showCreate && (
        <CreateRoutineModal
          onClose={() => setShowCreate(false)}
          onCreate={async (routine) => {
            await create(routine);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function RoutineCard({
  routine,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  routine: Routine;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (routine: Partial<Routine>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(routine.name);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [rules, setRules] = useState(JSON.stringify(routine.rules, null, 2));
  const [actions, setActions] = useState(JSON.stringify(routine.actions, null, 2));

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
              <span className="label-text">Enabled</span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">Rules (JSON)</span>
              </label>
              <textarea
                className="textarea textarea-bordered h-48 font-mono text-xs"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder='[{"Sensor": {"device_ref": {...}, "state": {...}}}]'
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Actions (JSON)</span>
              </label>
              <textarea
                className="textarea textarea-bordered h-48 font-mono text-xs"
                value={actions}
                onChange={(e) => setActions(e.target.value)}
                placeholder='[{"ActivateScene": {"scene_id": "..."}]'
              />
            </div>
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
                    enabled,
                    rules: JSON.parse(rules),
                    actions: JSON.parse(actions),
                  });
                } catch {
                  alert('Invalid JSON in rules or actions');
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
            <h2 className="card-title">{routine.name}</h2>
            <div className="text-sm opacity-70">{routine.id}</div>
          </div>
          <div className="flex gap-2 items-center">
            <div className={`badge ${routine.enabled ? 'badge-success' : 'badge-error'}`}>
              {routine.enabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
        </div>

        <div className="text-sm mt-2">
          <span className="font-medium">{routine.rules.length}</span> rules ·{' '}
          <span className="font-medium">{routine.actions.length}</span> actions
        </div>

        <div className="grid md:grid-cols-2 gap-2 mt-2">
          <details className="collapse bg-base-300">
            <summary className="collapse-title text-sm font-medium py-2 min-h-0">
              Rules
            </summary>
            <div className="collapse-content">
              <pre className="text-xs overflow-auto">{JSON.stringify(routine.rules, null, 2)}</pre>
            </div>
          </details>
          <details className="collapse bg-base-300">
            <summary className="collapse-title text-sm font-medium py-2 min-h-0">
              Actions
            </summary>
            <div className="collapse-content">
              <pre className="text-xs overflow-auto">{JSON.stringify(routine.actions, null, 2)}</pre>
            </div>
          </details>
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

function CreateRoutineModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (routine: Partial<Routine>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Routine</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Routine ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="motion-lights"
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
            placeholder="Motion Activated Lights"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label cursor-pointer">
            <span className="label-text">Enabled</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
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
            onClick={() => onCreate({ id, name, enabled, rules: [], actions: [] })}
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
