'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { useState, useRef } from 'react';

export default function MigrationPage() {
  const { apiEndpoint } = useAppConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTomlUpload = async (file: File) => {
    try {
      setLoading(true);
      setError(null);
      setPreview(null);

      const text = await file.text();

      // Send to migration preview endpoint
      const response = await fetch(`${apiEndpoint}/api/v1/config/migrate/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });

      const result = await response.json();
      if (result.success) {
        setPreview(result.data);
        setSuccess('TOML parsed successfully. Review the preview below.');
      } else {
        setError(result.error || 'Failed to parse TOML');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMigrate = async () => {
    if (!preview) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiEndpoint}/api/v1/config/migrate/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview),
      });

      const result = await response.json();
      if (result.success) {
        setSuccess(
          `Migration complete! Imported ${result.data.integrations || 0} integrations, ` +
            `${result.data.groups || 0} groups, ${result.data.scenes || 0} scenes, ` +
            `${result.data.routines || 0} routines.`,
        );
        setPreview(null);
      } else {
        setError(result.error || 'Migration failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Migration failed');
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">TOML Migration</h1>
      </div>

      <div className="alert alert-warning">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="stroke-current shrink-0 h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div>
          <h3 className="font-bold">One-time Migration</h3>
          <div className="text-sm">
            This tool imports your existing Settings.toml configuration into the database.
            Existing entries with matching IDs will be updated. This is intended for
            initial migration from file-based config to database config.
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <span>{success}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Upload section */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Upload Settings.toml</h2>
          <p className="text-sm opacity-70">
            Upload your existing TOML configuration file to preview and migrate to the
            database.
          </p>

          <div className="form-control mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".toml"
              className="file-input file-input-bordered w-full max-w-md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleTomlUpload(file);
              }}
              disabled={loading}
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 mt-2">
              <span className="loading loading-spinner loading-sm"></span>
              <span>Processing...</span>
            </div>
          )}
        </div>
      </div>

      {/* Preview section */}
      {preview && (
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Migration Preview</h2>
            <p className="text-sm opacity-70">
              Review the parsed configuration before applying the migration.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              <PreviewSection
                title="Integrations"
                items={preview.integrations as unknown[]}
              />
              <PreviewSection title="Groups" items={preview.groups as unknown[]} />
              <PreviewSection title="Scenes" items={preview.scenes as unknown[]} />
              <PreviewSection title="Routines" items={preview.routines as unknown[]} />
            </div>

            <details className="collapse bg-base-300 mt-4">
              <summary className="collapse-title text-sm font-medium">
                Full Configuration JSON
              </summary>
              <div className="collapse-content">
                <pre className="text-xs overflow-auto max-h-96">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
            </details>

            <div className="card-actions mt-4">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPreview(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleMigrate}
                disabled={loading}
              >
                Apply Migration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Migration Steps</h2>
          <ol className="list-decimal list-inside space-y-2 mt-2">
            <li>Backup your current Settings.toml file</li>
            <li>Upload the TOML file using the form above</li>
            <li>Review the parsed configuration in the preview</li>
            <li>Click &quot;Apply Migration&quot; to import into the database</li>
            <li>Verify the imported configuration in the config editors</li>
            <li>
              Once verified, you can remove the TOML sections from your Settings.toml
              (keep only server settings like port, database URL, etc.)
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({
  title,
  items,
}: {
  title: string;
  items: unknown[] | undefined;
}) {
  const count = items?.length || 0;

  return (
    <div className="p-4 bg-base-300 rounded">
      <div className="text-3xl font-bold">{count}</div>
      <div className="text-sm opacity-70">{title}</div>
    </div>
  );
}
