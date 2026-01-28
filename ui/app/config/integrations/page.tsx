'use client';

import { useIntegrations, Integration } from '@/hooks/useConfig';
import { useState } from 'react';

export default function IntegrationsPage() {
  const { data: integrations, loading, error, create, update, remove } = useIntegrations();
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
        <span>Error loading integrations: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate(true)}
        >
          Add Integration
        </button>
      </div>

      {/* Integrations list */}
      <div className="grid gap-4">
        {integrations.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            isEditing={editingId === integration.id}
            onEdit={() => setEditingId(integration.id)}
            onSave={async (updated) => {
              await update(integration.id, updated);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            onDelete={async () => {
              if (confirm(`Delete integration "${integration.id}"?`)) {
                await remove(integration.id);
              }
            }}
          />
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateIntegrationModal
          onClose={() => setShowCreate(false)}
          onCreate={async (integration) => {
            await create(integration);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  integration: Integration;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (integration: Partial<Integration>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [config, setConfig] = useState(JSON.stringify(integration.config, null, 2));
  const [enabled, setEnabled] = useState(integration.enabled);

  if (isEditing) {
    return (
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">{integration.id}</h2>
          <div className="badge badge-secondary">{integration.plugin}</div>

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

          <div className="form-control">
            <label className="label">
              <span className="label-text">Configuration (JSON)</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-48 font-mono text-sm"
              value={config}
              onChange={(e) => setConfig(e.target.value)}
            />
          </div>

          <div className="card-actions justify-end">
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                try {
                  onSave({
                    config: JSON.parse(config),
                    enabled,
                  });
                } catch {
                  alert('Invalid JSON');
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
            <h2 className="card-title">{integration.id}</h2>
            <div className="flex gap-2 mt-1">
              <div className="badge badge-secondary">{integration.plugin}</div>
              <div className={`badge ${integration.enabled ? 'badge-success' : 'badge-error'}`}>
                {integration.enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-ghost" onClick={onEdit}>
              Edit
            </button>
            <button className="btn btn-sm btn-error btn-ghost" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>

        <details className="collapse bg-base-300 mt-2">
          <summary className="collapse-title text-sm font-medium">
            Configuration
          </summary>
          <div className="collapse-content">
            <pre className="text-xs overflow-auto">
              {JSON.stringify(integration.config, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

function CreateIntegrationModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (integration: Partial<Integration>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [plugin, setPlugin] = useState('');
  const [config, setConfig] = useState('{}');
  const [enabled, setEnabled] = useState(true);

  const plugins = ['mqtt', 'circadian', 'cron', 'timer', 'dummy'];

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Integration</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Integration ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. my-mqtt"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Plugin</span>
          </label>
          <select
            className="select select-bordered"
            value={plugin}
            onChange={(e) => setPlugin(e.target.value)}
          >
            <option value="">Select plugin...</option>
            {plugins.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Configuration (JSON)</span>
          </label>
          <textarea
            className="textarea textarea-bordered h-32 font-mono text-sm"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !plugin}
            onClick={() => {
              try {
                onCreate({
                  id,
                  plugin,
                  config: JSON.parse(config),
                  enabled,
                });
              } catch {
                alert('Invalid JSON');
              }
            }}
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
