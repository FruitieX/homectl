'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { Modal } from 'react-daisyui';
import { useRef, useState } from 'react';

type MigrationSelection = {
  core: boolean;
  integrations: boolean;
  groups: boolean;
  scenes: boolean;
  routines: boolean;
};

type MigrationSectionKey = keyof MigrationSelection;

type MigrationPreview = {
  core: {
    warmup_time_seconds: number;
  };
  integrations: unknown[];
  groups: unknown[];
  scenes: unknown[];
  routines: unknown[];
};

type MigrationPreviewData = {
  preview: MigrationPreview;
  validation_errors: string[];
};

type MigrationApplyResult = {
  core: boolean;
  integrations: number;
  groups: number;
  scenes: number;
  routines: number;
};

type ApiResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

const defaultMigrationSelection: MigrationSelection = {
  core: false,
  integrations: true,
  groups: false,
  scenes: false,
  routines: false,
};

const migrationSectionOptions: Array<{
  key: MigrationSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'integrations',
    label: 'Integrations',
    description: 'Load integrations first so they can discover devices.',
  },
  {
    key: 'core',
    label: 'Core Settings',
    description: 'Warmup and other shared runtime settings.',
  },
  {
    key: 'groups',
    label: 'Groups',
    description: 'Import group definitions after devices are available.',
  },
  {
    key: 'scenes',
    label: 'Scenes',
    description: 'Import scene device links after discovery finishes.',
  },
  {
    key: 'routines',
    label: 'Routines',
    description: 'Import rules and actions once device refs can resolve.',
  },
];

function hasSelectedSections(selection: MigrationSelection) {
  return Object.values(selection).some(Boolean);
}

function buildMigrationQuery(selection: MigrationSelection) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(selection)) {
    query.set(key, String(value));
  }

  return query.toString();
}

function getSelectedSectionLabels(selection: MigrationSelection) {
  return migrationSectionOptions
    .filter((option) => selection[option.key])
    .map((option) => option.label);
}

function formatPreviewSuccess(selection: MigrationSelection) {
  const selected = getSelectedSectionLabels(selection);

  if (selected.length === 0) {
    return 'Select at least one section to import.';
  }

  return `${selected.join(', ')} parsed and validated successfully. Review the preview below.`;
}

function formatPreviewWarning(selection: MigrationSelection, validationErrors: string[]) {
  const selected = getSelectedSectionLabels(selection);
  const label = selected.join(', ');
  const issueLabel = validationErrors.length === 1 ? 'warning' : 'warnings';

  return `${label} parsed successfully with ${validationErrors.length} ${issueLabel}. The affected entries will be dropped if you continue with the import.`;
}

function formatMigrationSuccess(
  result: MigrationApplyResult,
  selection: MigrationSelection,
) {
  const parts: string[] = [];

  if (result.core) {
    parts.push('updated core settings');
  }
  if (selection.integrations) {
    parts.push(`imported ${result.integrations} integrations`);
  }
  if (selection.groups) {
    parts.push(`imported ${result.groups} groups`);
  }
  if (selection.scenes) {
    parts.push(`imported ${result.scenes} scenes`);
  }
  if (selection.routines) {
    parts.push(`imported ${result.routines} routines`);
  }

  const summary = parts.length > 0 ? `${parts.join(', ')}.` : 'made no changes.';
  const integrationsOnly =
    selection.integrations &&
    !selection.core &&
    !selection.groups &&
    !selection.scenes &&
    !selection.routines;

  if (integrationsOnly) {
    return `Migration complete! ${summary} Wait for device discovery and the warmup period to finish, then rerun the migration for the remaining sections.`;
  }

  return `Migration complete! ${summary}`;
}

export default function MigrationPage() {
  const { apiEndpoint } = useAppConfig();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selection, setSelection] = useState<MigrationSelection>(defaultMigrationSelection);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSectionLabels = getSelectedSectionLabels(selection);

  const handleSelectionChange = (
    section: MigrationSectionKey,
    checked: boolean,
  ) => {
    setSelection((current) => ({
      ...current,
      [section]: checked,
    }));
    setError(null);
    setSuccess(null);
    setConfirmOpen(false);
    setValidationErrors([]);
    setPreview(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleSelection = (section: MigrationSectionKey) => {
    handleSelectionChange(section, !selection[section]);
  };

  const handleTomlUpload = async (file: File) => {
    if (!hasSelectedSections(selection)) {
      setError('Select at least one section to import.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setConfirmOpen(false);
      setValidationErrors([]);
      setPreview(null);

      const text = await file.text();

      const response = await fetch(
        `${apiEndpoint}/api/v1/config/migrate/preview?${buildMigrationQuery(selection)}`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
        },
      );

      const result: ApiResult<MigrationPreviewData> = await response.json();
      if (result.success && result.data) {
        setPreview(result.data.preview);
        setValidationErrors(result.data.validation_errors);
        setSuccess(
          result.data.validation_errors.length > 0
            ? formatPreviewWarning(selection, result.data.validation_errors)
            : formatPreviewSuccess(selection),
        );
      } else {
        setValidationErrors([]);
        setError(result.error || 'Failed to parse TOML');
      }
    } catch (e) {
      setValidationErrors([]);
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const applyMigration = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    let result: ApiResult<MigrationApplyResult>;

    try {
      const response = await fetch(`${apiEndpoint}/api/v1/config/migrate/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview, selection }),
      });

      result = await response.json();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Migration failed');
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    if (result.success && result.data) {
      setSuccess(formatMigrationSuccess(result.data, selection));
      setValidationErrors([]);
      setPreview(null);
      setConfirmOpen(false);
    } else {
      setError(result.error || 'Migration failed');
    }

    setLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMigrate = async () => {
    if (!hasSelectedSections(selection)) {
      setError('Select at least one section to import.');
      return;
    }

    if (!preview) {
      return;
    }

    if (validationErrors.length > 0) {
      setConfirmOpen(true);
      return;
    }

    await applyMigration();
  };

  const handleConfirmMigrate = async () => {
    await applyMigration();
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
            This tool imports your existing Settings.toml configuration into the
            database. Use it in two passes: import integrations first, wait for device
            discovery and the warmup period, then rerun the migration for groups,
            scenes, and routines.
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Import Scope</h2>
          <p className="text-sm opacity-70">
            Preview and apply only use the sections checked below.
          </p>

          <div className="alert alert-info mt-4">
            <span className="text-sm leading-6">
              Recommended flow: first import integrations only, then wait for
              the integrations to discover devices. This is needed to be able to
              translate device names as possibly used in the config into device
              ID:s correctly. After that, upload the same TOML again and import
              the remaining sections.
            </span>
          </div>

          <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {migrationSectionOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                aria-pressed={selection[option.key]}
                className={`flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition-none ${
                  selection[option.key]
                    ? 'border-primary bg-base-100'
                    : 'border-base-300 bg-base-100/60'
                }`}
                disabled={loading}
                onClick={() => toggleSelection(option.key)}
              >
                <div>
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs opacity-70">{option.description}</div>
                </div>
                <span
                  className={`badge badge-sm shrink-0 ${
                    selection[option.key] ? 'badge-primary' : 'badge-ghost'
                  }`}
                >
                  {selection[option.key] ? 'Include' : 'Skip'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Upload section */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Upload Settings.toml</h2>
          <p className="text-sm opacity-70">
            Upload your existing TOML configuration file. Preview and apply will only
            use the sections selected above.
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


      {error && (
        <div className="alert alert-error">
          <span className="whitespace-pre-wrap text-sm">{error}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {preview && validationErrors.length > 0 && (
        <div className="alert alert-warning">
          <div>
            <h3 className="font-bold">Entries Will Be Dropped On Import</h3>
            <div className="mt-1 text-sm opacity-80">
              Some entries in the uploaded TOML could not be matched to existing
              devices. You can proceed with the import, but the affected entries
              below will be skipped.
            </div>
            <ul className="mt-3 list-disc list-inside space-y-1 text-sm whitespace-pre-wrap">
              {validationErrors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
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

      {/* Preview section */}
      {preview && (
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Migration Preview</h2>
            <p className="text-sm opacity-70">
              Review the selected sections before applying this migration run.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="opacity-70">Previewing:</span>
              {selectedSectionLabels.map((label) => (
                <span key={label} className="badge badge-outline">
                  {label}
                </span>
              ))}
            </div>

            <div className="grid gap-4 mt-4 md:grid-cols-2 xl:grid-cols-5">
              <PreviewSection title="Core Settings" count={selection.core ? 1 : 0} />
              <PreviewSection title="Integrations" count={preview.integrations.length} />
              <PreviewSection title="Groups" count={preview.groups.length} />
              <PreviewSection title="Scenes" count={preview.scenes.length} />
              <PreviewSection title="Routines" count={preview.routines.length} />
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
                  setValidationErrors([]);
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
                Apply Selected Sections
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal.Legacy
        responsive
        open={confirmOpen}
        onClickBackdrop={() => {
          if (!loading) {
            setConfirmOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="btn btn-sm btn-circle absolute right-2 top-2"
          onClick={() => setConfirmOpen(false)}
          disabled={loading}
          aria-label="Close warning confirmation"
        >
          ✕
        </button>

        <Modal.Header className="font-bold">
          Apply migration with warnings?
        </Modal.Header>

        <Modal.Body>
          <p className="text-sm leading-6 opacity-80">
            This migration preview contains {validationErrors.length} name-resolution{' '}
            {validationErrors.length === 1 ? 'issue' : 'issues'}.
          </p>
          <p className="mt-3 text-sm leading-6 opacity-80">
            If you continue, the affected entries will be dropped from the
            imported groups, scenes, routines, or other migrated config.
          </p>

          <div className="alert alert-warning mt-4">
            <div>
              <h3 className="font-bold">Affected entries</h3>
              <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm whitespace-pre-wrap">
                {validationErrors.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </Modal.Body>

        <Modal.Actions>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirmOpen(false)}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-warning"
            onClick={handleConfirmMigrate}
            disabled={loading}
          >
            Apply anyway
          </button>
        </Modal.Actions>
      </Modal.Legacy>
    </div>
  );
}

function PreviewSection({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="p-4 bg-base-300 rounded">
      <div className="text-3xl font-bold">{count}</div>
      <div className="text-sm opacity-70">{title}</div>
    </div>
  );
}
