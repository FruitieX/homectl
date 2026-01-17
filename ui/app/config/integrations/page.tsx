'use client';

import { useIntegrations, Integration } from '@/hooks/useConfig';
import { useState, useCallback } from 'react';

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
  const [config, setConfig] = useState(integration.config);
  const [enabled, setEnabled] = useState(integration.enabled);
  const [useJsonMode, setUseJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(
    JSON.stringify(integration.config, null, 2),
  );

  const updateKey = useCallback(
    (key: string, value: string) => {
      setConfig((prev) => {
        const updated = { ...prev };
        // Try to parse as JSON value (numbers, booleans, arrays, objects)
        try {
          updated[key] = JSON.parse(value);
        } catch {
          updated[key] = value;
        }
        return updated;
      });
    },
    [],
  );

  const removeKey = useCallback((key: string) => {
    setConfig((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  }, []);

  const addKey = useCallback(() => {
    setConfig((prev) => ({ ...prev, '': '' }));
  }, []);

  const renameKey = useCallback((oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setConfig((prev) => {
      const entries = Object.entries(prev);
      const updated: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        updated[k === oldKey ? newKey : k] = v;
      }
      return updated;
    });
  }, []);

  if (isEditing) {
    const effectiveConfig = useJsonMode ? (() => {
      try { return JSON.parse(jsonText); } catch { return config; }
    })() : config;

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

          <div className="flex items-center justify-between">
            <span className="label-text font-medium">Configuration</span>
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => {
                if (!useJsonMode) {
                  setJsonText(JSON.stringify(config, null, 2));
                } else {
                  try {
                    setConfig(JSON.parse(jsonText));
                  } catch {
                    // Keep current config if JSON is invalid
                  }
                }
                setUseJsonMode(!useJsonMode);
              }}
            >
              {useJsonMode ? 'Key-Value' : 'JSON'}
            </button>
          </div>

          {useJsonMode ? (
            <textarea
              className="textarea textarea-bordered h-48 font-mono text-sm"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          ) : (
            <div className="space-y-2">
              {Object.entries(config).map(([key, value], index) => {
                const isComplex =
                  typeof value === 'object' && value !== null;
                const displayValue = isComplex
                  ? JSON.stringify(value)
                  : String(value ?? '');

                return (
                  <div key={`${integration.id}-${index}`} className="flex gap-2 items-start">
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-1 font-mono text-xs"
                      value={key}
                      onChange={(e) => renameKey(key, e.target.value)}
                      placeholder="key"
                    />
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-[2] font-mono text-xs"
                      value={displayValue}
                      onChange={(e) => updateKey(key, e.target.value)}
                      placeholder="value"
                    />
                    <button
                      className="btn btn-ghost btn-xs btn-error"
                      onClick={() => removeKey(key)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                className="btn btn-xs btn-outline w-full"
                onClick={addKey}
              >
                + Add Field
              </button>
            </div>
          )}

          <div className="card-actions justify-end">
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onSave({ config: effectiveConfig, enabled });
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
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [enabled, setEnabled] = useState(true);
  const [useJsonMode, setUseJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('{}');

  const plugins = ['mqtt', 'circadian', 'cron', 'timer', 'dummy'];

  const updateKey = useCallback(
    (key: string, value: string) => {
      setConfig((prev) => {
        const updated = { ...prev };
        try {
          updated[key] = JSON.parse(value);
        } catch {
          updated[key] = value;
        }
        return updated;
      });
    },
    [],
  );

  const removeKey = useCallback((key: string) => {
    setConfig((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  }, []);

  const addKey = useCallback(() => {
    setConfig((prev) => ({ ...prev, '': '' }));
  }, []);

  const renameKey = useCallback((oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setConfig((prev) => {
      const entries = Object.entries(prev);
      const updated: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        updated[k === oldKey ? newKey : k] = v;
      }
      return updated;
    });
  }, []);

  const effectiveConfig = useJsonMode
    ? (() => {
        try {
          return JSON.parse(jsonText);
        } catch {
          return config;
        }
      })()
    : config;

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

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="label-text font-medium">Configuration</span>
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => {
                if (!useJsonMode) {
                  setJsonText(JSON.stringify(config, null, 2));
                } else {
                  try {
                    setConfig(JSON.parse(jsonText));
                  } catch {
                    // Keep current config if JSON is invalid
                  }
                }
                setUseJsonMode(!useJsonMode);
              }}
            >
              {useJsonMode ? 'Key-Value' : 'JSON'}
            </button>
          </div>

          {useJsonMode ? (
            <textarea
              className="textarea textarea-bordered h-32 font-mono text-sm w-full mt-2"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          ) : (
            <div className="space-y-2 mt-2">
              {Object.entries(config).map(([key, value], index) => {
                const isComplex =
                  typeof value === 'object' && value !== null;
                const displayValue = isComplex
                  ? JSON.stringify(value)
                  : String(value ?? '');

                return (
                  <div key={`new-integration-${index}`} className="flex gap-2 items-start">
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-1 font-mono text-xs"
                      value={key}
                      onChange={(e) => renameKey(key, e.target.value)}
                      placeholder="key"
                    />
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-[2] font-mono text-xs"
                      value={displayValue}
                      onChange={(e) => updateKey(key, e.target.value)}
                      placeholder="value"
                    />
                    <button
                      className="btn btn-ghost btn-xs btn-error"
                      onClick={() => removeKey(key)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                className="btn btn-xs btn-outline w-full"
                onClick={addKey}
              >
                + Add Field
              </button>
            </div>
          )}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !plugin}
            onClick={() => {
              onCreate({
                id,
                plugin,
                config: effectiveConfig,
                enabled,
              });
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
