'use client';

import { useConfigExport, ConfigExport } from '@/hooks/useConfig';
import { useState, useRef } from 'react';

export default function ImportExportPage() {
  const { exportConfig, importConfig } = useConfigExport();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      setExporting(true);
      setError(null);
      const config = await exportConfig();

      // Download as JSON file
      const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homectl-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Configuration exported successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    try {
      setImporting(true);
      setError(null);

      const text = await file.text();
      const config: ConfigExport = JSON.parse(text);

      await importConfig(config);
      setSuccess(
        `Imported: ${config.integrations?.length || 0} integrations, ${config.groups?.length || 0} groups, ${config.scenes?.length || 0} scenes, ${config.routines?.length || 0} routines`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Import / Export Configuration</h1>

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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Export */}
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Export Configuration</h2>
            <p className="text-sm opacity-70">
              Download a JSON backup of all integrations, groups, scenes, and routines.
            </p>
            <div className="card-actions mt-4">
              <button
                className="btn btn-primary"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Exporting...
                  </>
                ) : (
                  'Download Backup'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Import */}
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Import Configuration</h2>
            <p className="text-sm opacity-70">
              Upload a JSON configuration file. Existing items with matching IDs will
              be updated.
            </p>
            <div className="card-actions mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="file-input file-input-bordered w-full max-w-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                }}
                disabled={importing}
              />
              {importing && (
                <span className="loading loading-spinner loading-sm"></span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="alert alert-info">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          className="stroke-current shrink-0 w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <div>
          <h3 className="font-bold">Configuration Hot-Reload</h3>
          <div className="text-sm">
            Changes made through these editors are applied immediately without restarting
            the server.
          </div>
        </div>
      </div>
    </div>
  );
}
