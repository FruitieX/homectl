import {
  useConfigExport,
  ConfigApiError,
  type ConfigExport,
  type BackupReview,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { ConfigPageHeader } from '../page-header';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/primitives/dialog';
import { Download, FileJson, LoaderCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';

const EMPTY: RestoreDraft = { filename: '', backup: null, review: null };
type RestoreDraft = {
  filename: string;
  backup: ConfigExport | null;
  review: BackupReview | null;
};
const labels = { add: 'Add', update: 'Replace', remove: 'Remove' };
const destinations: Record<string, string> = {
  integrations: '/config/integrations',
  groups: '/config/groups',
  scenes: '/config/scenes',
  routines: '/config/routines',
  blocks: '/config/blocks',
  helpers: '/config/helpers',
  sources: '/config/sources',
  dashboard_layouts: '/config/dashboard',
};

export default function ImportExportPage() {
  const { exportConfig, importConfig, previewImport } = useConfigExport();
  const { apiEndpoint } = useAppConfig();
  const { advanced } = useSettingsPreferences();
  const [exporting, setExporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reading, setReading] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [result, setResult] = useState('');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(80);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const reviewRequest = useRef<AbortController | null>(null);
  const fileGeneration = useRef(0);
  useEffect(() => {
    setHost(document.getElementById('settings-save-slot'));
    return () => {
      fileGeneration.current++;
      reviewRequest.current?.abort();
    };
  }, []);
  const draft = useEntityDraft<RestoreDraft>({
    key: `${apiEndpoint}/backup-restore`,
    item: EMPTY,
    label: 'Backup restore',
    href: '/config/import-export',
    save: async (value) => {
      if (!value.backup || !value.review)
        throw Error('Review the backup before restoring it.');
      try {
        const write = await importConfig(
          value.backup,
          value.review.revision_token,
        );
        const message =
          write?.persistence === 'persisted'
            ? 'Backup restored and saved to the database.'
            : 'Backup applied, but not saved to the database. Download a backup and resolve the persistence warning.';
        setResult(message);
        if (write?.persistence === 'persisted')
          toast.success('Backup restored');
        if (fileInput.current) fileInput.current.value = '';
        return EMPTY;
      } catch (error) {
        // A rejected or uncertain request needs a new review, never a blind
        // retry against an obsolete snapshot. The uploaded file stays in memory.
        draft.patch({ review: null });
        if (error instanceof ConfigApiError && error.status === 409)
          setError(
            'The saved setup changed. Review the backup again before restoring.',
          );
        throw error;
      }
    },
  });
  const value = draft.value!;
  const review = value.review;
  const entries =
    review?.sections.flatMap((section) =>
      section.changes.map((change) => ({ ...change, section })),
    ) ?? [];
  const counts = {
    add: entries.filter((row) => row.action === 'add').length,
    update: entries.filter((row) => row.action === 'update').length,
    remove: entries.filter((row) => row.action === 'remove').length,
  };
  const visible = entries.filter((row) =>
    `${row.name} ${row.id} ${row.section.label} ${labels[row.action]}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  const reviewBackup = async (backup: ConfigExport) => {
    reviewRequest.current?.abort();
    const request = new AbortController();
    reviewRequest.current = request;
    setError('');
    setResult('');
    setReviewing(true);
    setConfirm(false);
    draft.patch({ review: null });
    try {
      const reviewed = await previewImport(backup, request.signal);
      if (!request.signal.aborted) {
        draft.patch({ review: reviewed });
        setLimit(80);
        setFilter('');
        requestAnimationFrame(() => {
          if (request.signal.aborted) return;
          const heading = document.getElementById('backup-review-title');
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: 'start' });
        });
      }
    } catch (error) {
      if (!request.signal.aborted)
        setError(
          error instanceof Error
            ? error.name === 'TimeoutError'
              ? 'Review timed out. The backup has not been applied; try reviewing again.'
              : error.message
            : 'Could not review this backup.',
        );
    } finally {
      if (reviewRequest.current === request) setReviewing(false);
    }
  };
  const chooseFile = async (file: File) => {
    const generation = ++fileGeneration.current;
    reviewRequest.current?.abort();
    draft.patch({ filename: file.name, backup: null, review: null });
    setConfirm(false);
    setError('');
    setResult('');
    setReading(false);
    if (file.size > 32 * 1024 * 1024) {
      setError('Choose a backup smaller than 32 MB.');
      return;
    }
    setReading(true);
    try {
      const backup = JSON.parse(await file.text()) as ConfigExport;
      if (generation !== fileGeneration.current) return;
      if (!backup || typeof backup !== 'object' || Array.isArray(backup))
        throw Error('Choose a homectl JSON backup.');
      draft.patch({ filename: file.name, backup, review: null });
      setReading(false);
      await reviewBackup(backup);
    } catch (error) {
      if (generation !== fileGeneration.current) return;
      setError(
        error instanceof Error
          ? `Could not read the backup: ${error.message}`
          : 'Could not read the backup.',
      );
    } finally {
      if (generation === fileGeneration.current) setReading(false);
    }
  };
  const download = async () => {
    setExportError('');
    setExporting(true);
    try {
      const config = await exportConfig(includeSecrets);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], {
          type: 'application/json',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `homectl-config-${new Date().toISOString().slice(0, 10)}${includeSecrets ? '-with-credentials' : ''}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Backup downloaded');
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : 'Could not download the backup.',
      );
    } finally {
      setExporting(false);
    }
  };
  const discard = () => {
    fileGeneration.current++;
    reviewRequest.current?.abort();
    draft.discard();
    setError('');
    setResult('');
    setReading(false);
    setConfirm(false);
    setFilter('');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="settings-detail space-y-5">
      <ConfigPageHeader
        title="Backups & restore"
        description="Download your saved setup or review a backup before restoring it."
      />
      <ConfigTabs
        tabs={[
          { label: 'Backups', to: '/config/import-export', active: true },
          { label: 'Legacy import', to: '/config/migration' },
        ]}
      />
      <SettingsSection
        title="Download a backup"
        description="Includes saved configuration, dashboards, floorplans, calibration and durable helper values. Live device readings, history and this browser’s appearance preferences are not included."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeSecrets}
              disabled={exporting}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
            />
            <span>
              Include credentials
              <span className="block max-w-xl text-xs text-muted-foreground">
                Off by default. Include them to restore connections on a new
                server; keep that file private.
              </span>
            </span>
          </label>
          <Button onClick={() => void download()} disabled={exporting}>
            <Download className="size-4" />
            {exporting ? 'Preparing…' : 'Download backup'}
          </Button>
        </div>
        {exportError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {exportError}
          </p>
        )}
      </SettingsSection>
      <SettingsSection
        title="Restore a backup"
        description="Restoring replaces the saved setup. Entries absent from the file are removed. Review shows exactly which entries are affected before anything is applied."
      >
        <label className="block space-y-2 text-sm">
          Backup file
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="block w-full min-w-0 rounded-md border border-input p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-2"
            disabled={draft.saving || reviewing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void chooseFile(file);
            }}
          />
        </label>
        {value.filename && (
          <p className="mt-3 flex min-w-0 items-center gap-2 break-all text-sm">
            <FileJson className="size-4 shrink-0" />
            {value.filename}
          </p>
        )}
        {reviewing && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Reviewing backup…
          </p>
        )}
        {reading && (
          <p role="status" className="mt-3 text-sm">
            Reading backup…
          </p>
        )}
        {value.filename &&
          !value.backup &&
          !reading &&
          !reviewing &&
          !error && (
            <p role="status" className="mt-3 text-sm">
              Choose this file again to read and review it.
            </p>
          )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="mt-3 text-sm">
            {result}
          </p>
        )}
      </SettingsSection>
      {review && (
        <SettingsSection
          id="backup-review"
          title="Review changes"
          description="Nothing has been applied. Credential values are never displayed in this review."
        >
          <div
            className="flex flex-wrap gap-2 text-sm"
            aria-label="Restore summary"
          >
            <span className="rounded bg-emerald-500/10 px-3 py-1">
              {counts.add} to add
            </span>
            <span className="rounded bg-amber-500/10 px-3 py-1">
              {counts.update} to replace
            </span>
            <span className="rounded bg-red-500/10 px-3 py-1">
              {counts.remove} to remove
            </span>
            <span className="px-3 py-1 text-muted-foreground">
              {review.sections.reduce(
                (sum, section) => sum + section.unchanged,
                0,
              )}{' '}
              unchanged
            </span>
          </div>
          <div className="my-4 space-y-2 text-xs text-muted-foreground">
            {review.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {review.legacy_routines > 0 && (
              <p>
                {review.legacy_routines} legacy routines will remain read-only
                until converted.{' '}
                <Link className="underline" to="/config/routines?filter=legacy">
                  Review legacy routines
                </Link>
              </p>
            )}
          </div>
          <label className="block text-sm">
            Filter affected entries
            <Input
              className="mt-1"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setLimit(80);
              }}
              placeholder="Name, category or change"
            />
          </label>
          <ul
            className="mt-3 divide-y divide-border"
            aria-label="Affected entries"
          >
            {visible.slice(0, limit).map((row) => (
              <li
                key={`${row.section.key}/${row.id}`}
                className="flex items-start gap-3 py-3 text-sm"
              >
                <span
                  className={`w-16 shrink-0 text-xs font-medium ${row.action === 'remove' ? 'text-destructive' : row.action === 'add' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}
                >
                  {labels[row.action]}
                </span>
                <div className="min-w-0 flex-1 break-words">
                  <div className="font-medium">
                    {row.action !== 'add' && destinations[row.section.key] ? (
                      <Link
                        className="underline decoration-border underline-offset-4"
                        to={`${destinations[row.section.key]}/${encodeURIComponent(row.id)}`}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.section.label}
                    {advanced && row.id !== row.name ? ` · ${row.id}` : ''}
                  </p>
                  {advanced && row.fields.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Changed:{' '}
                      {row.fields
                        .map((field) => field.replaceAll('_', ' '))
                        .join(', ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {visible.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              {entries.length
                ? 'No affected entries match this filter.'
                : 'The configuration in this backup matches the saved setup.'}
            </p>
          )}
          {visible.length > limit && (
            <Button variant="outline" onClick={() => setLimit(limit + 80)}>
              Show more ({visible.length - limit} remaining)
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {visible.length} affected entries
            {filter ? ' matching this filter' : ''}. Changes to the saved setup
            require a new review.
          </p>
        </SettingsSection>
      )}
      {draft.dirty &&
        host &&
        createPortal(
          <div className="settings-savebar" aria-label="Restore backup">
            {draft.errors.map((error, index) => (
              <p key={index} role="alert" className="settings-save-errors">
                {error.message}
              </p>
            ))}
            <div className="settings-save-actions">
              <div className="min-w-0 flex-1 text-xs">
                <strong>
                  {draft.saving ? 'Restoring…' : 'Backup ready for review'}
                </strong>
                <p className="truncate text-muted-foreground">
                  {value.filename}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={draft.saving}
                onClick={discard}
              >
                Discard
              </Button>
              <Button
                ref={restoreButton}
                disabled={draft.saving || reviewing || reading || !value.backup}
                onClick={() => {
                  if (!review) void reviewBackup(value.backup!);
                  else if (review.destructive) setConfirm(true);
                  else void draft.save();
                }}
              >
                {reading
                  ? 'Reading…'
                  : reviewing
                    ? 'Reviewing…'
                    : review
                      ? 'Restore backup'
                      : 'Review again'}
              </Button>
            </div>
          </div>,
          host,
        )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          className="settings-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Replace the saved setup?</DialogTitle>
            <DialogDescription>
              This restore will replace {counts.update} entries, remove{' '}
              {counts.remove} and add {counts.add}. Running routines may be
              interrupted and pending timers are canceled. Other open editor
              drafts are retained and may need conflict review.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                void draft.save();
              }}
            >
              Restore and replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
