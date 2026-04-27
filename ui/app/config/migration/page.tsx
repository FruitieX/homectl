import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Upload, X } from 'lucide-react';

import { useAppConfig } from '@/hooks/appConfig';
import { cn } from '@/lib/cn';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

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

function formatPreviewWarning(
  selection: MigrationSelection,
  validationErrors: string[],
) {
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

  const summary =
    parts.length > 0 ? `${parts.join(', ')}.` : 'made no changes.';
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

async function readApiResult<T>(response: Response, fallbackMessage: string) {
  try {
    return (await response.json()) as ApiResult<T>;
  } catch {
    return { success: false, error: fallbackMessage } satisfies ApiResult<T>;
  }
}

export default function MigrationPage() {
  const { apiEndpoint } = useAppConfig();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selection, setSelection] = useState<MigrationSelection>(
    defaultMigrationSelection,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSectionLabels = getSelectedSectionLabels(selection);

  const resetUploadState = () => {
    setValidationErrors([]);
    setPreview(null);
    setConfirmOpen(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
    resetUploadState();
  };

  const toggleSelection = (section: MigrationSectionKey) => {
    handleSelectionChange(section, !selection[section]);
  };

  const handleTomlUpload = async (file: File) => {
    if (!hasSelectedSections(selection)) {
      setError('Select at least one section to import.');
      resetUploadState();
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setConfirmOpen(false);
    setValidationErrors([]);
    setPreview(null);

    let text: string;
    try {
      text = await file.text();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Upload failed',
      );
      setLoading(false);
      resetUploadState();
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `${apiEndpoint}/api/v1/config/migrate/preview?${buildMigrationQuery(selection)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        },
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Upload failed',
      );
      setLoading(false);
      resetUploadState();
      return;
    }

    const result = await readApiResult<MigrationPreviewData>(
      response,
      'Failed to parse TOML',
    );

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

    setLoading(false);
  };

  const applyMigration = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    let response: Response;
    try {
      response = await fetch(`${apiEndpoint}/api/v1/config/migrate/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview, selection }),
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Migration failed',
      );
      setLoading(false);
      resetUploadState();
      return;
    }

    const result = await readApiResult<MigrationApplyResult>(
      response,
      'Migration failed',
    );

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
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">TOML Migration</h1>
        <p className="text-sm text-muted-foreground">
          Import legacy Settings.toml sections in controlled passes.
        </p>
      </div>

      <Alert variant="warning">
        <AlertTriangle className="size-4" />
        <AlertTitle>One-time Migration</AlertTitle>
        <AlertDescription>
          This tool imports your existing Settings.toml configuration into the
          database. Use it in two passes: import integrations first, wait for
          device discovery and warmup, then rerun the migration for groups,
          scenes, and routines.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Import Scope</CardTitle>
          <CardDescription>
            Preview and apply only use the sections checked below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="size-4" />
            <AlertTitle>Recommended flow</AlertTitle>
            <AlertDescription>
              First import integrations only, then wait for integrations to
              discover devices. After discovery, upload the same TOML again and
              import the remaining sections.
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {migrationSectionOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={selection[option.key]}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-2xl border p-4 text-left transition-colors',
                  selection[option.key]
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background/60 hover:bg-accent/50',
                )}
                disabled={loading}
                onClick={() => toggleSelection(option.key)}
              >
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                <Badge
                  variant={selection[option.key] ? 'default' : 'outline'}
                  className="shrink-0"
                >
                  {selection[option.key] ? 'Include' : 'Skip'}
                </Badge>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload Settings.toml</CardTitle>
          <CardDescription>
            Upload your legacy TOML configuration file. Preview and apply will
            only use selected sections.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".toml"
            className="max-w-md file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleTomlUpload(file);
            }}
            disabled={loading}
          />

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Upload className="size-4 animate-pulse" /> Processing…
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Migration failed</AlertTitle>
          <AlertDescription className="flex items-start justify-between gap-3">
            <span className="whitespace-pre-wrap">{error}</span>
            <Button variant="ghost" size="icon" onClick={() => setError(null)}>
              <X />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preview && validationErrors.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>Entries Will Be Dropped On Import</AlertTitle>
          <AlertDescription>
            <p>
              Some entries in the uploaded TOML could not be matched to existing
              devices. You can proceed, but affected entries will be skipped.
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 whitespace-pre-wrap text-sm">
              {validationErrors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Done</AlertTitle>
          <AlertDescription className="flex items-start justify-between gap-3">
            <span>{success}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSuccess(null)}
            >
              <X />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Migration Preview</CardTitle>
            <CardDescription>
              Review the selected sections before applying this migration run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Previewing:</span>
              {selectedSectionLabels.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <PreviewSection
                title="Core Settings"
                count={selection.core ? 1 : 0}
              />
              <PreviewSection
                title="Integrations"
                count={preview.integrations.length}
              />
              <PreviewSection title="Groups" count={preview.groups.length} />
              <PreviewSection title="Scenes" count={preview.scenes.length} />
              <PreviewSection
                title="Routines"
                count={preview.routines.length}
              />
            </div>

            <details className="rounded-2xl border border-border bg-muted/50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Full Configuration JSON
              </summary>
              <pre className="max-h-96 overflow-auto border-t border-border p-4 text-xs text-muted-foreground">
                {JSON.stringify(preview, null, 2)}
              </pre>
            </details>
          </CardContent>
          <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={resetUploadState}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleMigrate()}
              disabled={loading}
            >
              Apply Selected Sections
            </Button>
          </CardFooter>
        </Card>
      )}

      <ResponsiveOverlay
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!loading) {
            setConfirmOpen(open);
          }
        }}
        title="Apply migration with warnings?"
        description="Some TOML entries cannot be resolved and will be dropped if you continue."
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <p className="text-sm text-muted-foreground">
            This migration preview contains {validationErrors.length}{' '}
            name-resolution {validationErrors.length === 1 ? 'issue' : 'issues'}
            .
          </p>

          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertTitle>Affected entries</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-auto pl-5 whitespace-pre-wrap text-sm">
                {validationErrors.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-500 text-amber-950 hover:bg-amber-400"
              onClick={() => void handleConfirmMigrate()}
              disabled={loading}
            >
              Apply anyway
            </Button>
          </div>
        </div>
      </ResponsiveOverlay>
    </div>
  );
}

function PreviewSection({ title, count }: { title: string; count: number }) {
  return (
    <div className="rounded-2xl border border-border bg-muted p-4">
      <div className="text-3xl font-bold tracking-tight">{count}</div>
      <div className="text-sm text-muted-foreground">{title}</div>
    </div>
  );
}
