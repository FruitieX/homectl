'use client';

import { useScenes, Scene } from '@/hooks/useConfig';
import { useState } from 'react';

export default function ScenesPage() {
  const { data: scenes, loading, error, create, update, remove } = useScenes();
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
        <span>Error loading scenes: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Scenes</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Add Scene
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            isEditing={editingId === scene.id}
            onEdit={() => setEditingId(scene.id)}
            onSave={async (updated) => {
              await update(scene.id, updated);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            onDelete={async () => {
              if (confirm(`Delete scene "${scene.name}"?`)) {
                await remove(scene.id);
              }
            }}
          />
        ))}
      </div>

      {showCreate && (
        <CreateSceneModal
          onClose={() => setShowCreate(false)}
          onCreate={async (scene) => {
            await create(scene);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function SceneCard({
  scene,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  scene: Scene;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (scene: Partial<Scene>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(scene.name);
  const [hidden, setHidden] = useState(scene.hidden);
  const [script, setScript] = useState(scene.script || '');

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
              <span className="label-text">Script (JavaScript)</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-32 font-mono text-sm"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="// Optional JS script for dynamic scene logic
// Access devices, groups via globals
// Return device state overrides"
            />
          </div>

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
                  script: script || undefined,
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
            <h2 className="card-title">{scene.name}</h2>
            <div className="text-sm opacity-70">{scene.id}</div>
          </div>
          <div className="flex gap-1">
            {scene.hidden && <div className="badge badge-ghost">Hidden</div>}
            {scene.script && <div className="badge badge-info">Script</div>}
          </div>
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

function CreateSceneModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (scene: Partial<Scene>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Scene</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Scene ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="evening-relax"
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
            placeholder="Evening Relax"
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
            onClick={() => onCreate({ id, name, hidden })}
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
