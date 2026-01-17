'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppConfig } from '@/hooks/appConfig';

interface CoreConfig {
  warmupTimeSeconds: number;
}

interface CoreConfigApiResponse {
  warmupTimeSeconds?: number;
  warmup_time_seconds?: number;
}

export default function SettingsPage() {
  const { apiEndpoint } = useAppConfig();
  const [config, setConfig] = useState<CoreConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const normalizeCoreConfig = useCallback((value: CoreConfigApiResponse | null | undefined) => {
    const warmupTimeSeconds = value?.warmupTimeSeconds ?? value?.warmup_time_seconds ?? 1;
    return { warmupTimeSeconds };
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${apiEndpoint}/api/v1/config/core`);
      const data = await res.json();
      if (data.success) {
        setConfig(normalizeCoreConfig(data.data));
        setError(null);
      } else {
        setError(data.error || 'Failed to load settings');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint, normalizeCoreConfig]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    try {
      const res = await fetch(`${apiEndpoint}/api/v1/config/core`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warmup_time_seconds: config.warmupTimeSeconds }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(normalizeCoreConfig(data.data));
        setDirty(false);
        setError(null);
      } else {
        setError(data.error || 'Failed to save settings');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (updates: Partial<CoreConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...updates });
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="alert alert-error">
        <span>{error}</span>
        <button className="btn btn-sm" onClick={() => void fetchConfig()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Server Settings</h1>
        <button
          className={`btn btn-primary ${saving ? 'loading' : ''}`}
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="alert alert-warning">
          <span>{error}</span>
        </div>
      )}

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Core Settings</h2>

          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Warmup Time (seconds)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full max-w-xs"
              min={0}
              max={60}
              value={config?.warmupTimeSeconds ?? 1}
              onChange={(e) =>
                updateConfig({
                  warmupTimeSeconds: parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <label className="label">
              <span className="label-text-alt opacity-70">
                Time in seconds to wait for integrations to discover devices before starting
                routines. Increase this if devices are not ready when routines first run.
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Server Information</h2>
          <div className="text-sm opacity-70 space-y-1">
            <p>
              <span className="font-medium">API Endpoint:</span>{' '}
              <code className="bg-base-300 px-1 rounded">/api/v1</code>
            </p>
            <p>
              <span className="font-medium">WebSocket:</span>{' '}
              <code className="bg-base-300 px-1 rounded">/api/v1/ws</code>
            </p>
            <p>Device labels and map sensor controls now live under the Devices page.</p>
          </div>
        </div>
      </div>
    </div>
  );
}