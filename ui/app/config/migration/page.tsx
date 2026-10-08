import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { readApiResponse, type BackupReview } from '@/hooks/useConfig';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';
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
import { ConfigPageHeader } from '../page-header';

type Section = 'integrations' | 'groups' | 'scenes' | 'routines' | 'core';
type Selection = Record<Section, boolean>;
type Review = { review: BackupReview; skipped: string[] };
type Draft = {
  filename: string;
  toml: string;
  selection: Selection;
  reviewed: Review | null;
  acceptSkipped: boolean;
};
const EMPTY: Draft = {
  filename: '',
  toml: '',
  selection: {
    integrations: true,
    groups: false,
    scenes: false,
    routines: false,
    core: false,
  },
  reviewed: null,
  acceptSkipped: false,
};
const sections: {
  key: Section;
  label: string;
  description: string;
  entity?: string;
}[] = [
  {
    key: 'integrations',
    label: 'Connections',
    description: 'Import first so devices can be discovered.',
    entity: 'integration',
  },
  {
    key: 'groups',
    label: 'Rooms & groups',
    description: 'Memberships and linked groups.',
    entity: 'group',
  },
  {
    key: 'scenes',
    label: 'Scenes',
    description: 'Preset states and device links.',
    entity: 'scene',
  },
  {
    key: 'routines',
    label: 'Legacy routines',
    description: 'Imported read-only; convert to edit.',
    entity: 'routine',
  },
  {
    key: 'core',
    label: 'System behavior',
    description: 'Warmup and legacy transition defaults.',
  },
];

export default function MigrationPage() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const { advanced } = useSettingsPreferences();
  const [reviewing, setReviewing] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(80);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const fileGeneration = useRef(0);
  const key = `${apiEndpoint}/legacy-import`;
  useEffect(() => {
    const generation = fileGeneration;
    setHost(document.getElementById('settings-save-slot'));
    return () => {
      request.current?.abort();
      generation.current++;
    };
  }, []);
  const draft = useEntityDraft<Draft>({
    key,
    // A completed first pass keeps the file in session memory for the next pass.
    item: entityDraftStore.get<Draft>(key)?.baseline ?? EMPTY,
    href: '/config/migration',
    label: 'Legacy import',
    validate: (value) =>
      !value.reviewed
        ? [
            {
              field: 'review',
              message: 'Review this file and selection before importing.',
            },
          ]
        : value.reviewed.skipped.length && !value.acceptSkipped
          ? [
              {
                field: 'skipped',
                message:
                  'Acknowledge the skipped references, or change the setup and review again.',
              },
            ]
          : [],
    save: async (value) => {
      try {
        const response = await readApiResponse<{
          core: boolean;
          integrations: number;
          groups: number;
          scenes: number;
          routines: number;
        }>(
          await fetch(`${apiEndpoint}/api/v1/config/migrate/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toml: value.toml,
              selection: value.selection,
              expected: value.reviewed!.review.revision_token,
              accept_skipped: value.acceptSkipped,
            }),
            signal: AbortSignal.timeout(60000),
          }),
          'Could not import this file. Review again before retrying.',
        );
        recordWrite('Legacy import', response.write, '');
        setResult(
          response.write?.persistence === 'persisted'
            ? 'Selected entries imported and saved. The file is kept here for another pass.'
            : 'Selected entries applied, but not saved to the database. Download a backup and resolve the persistence warning.',
        );
        for (const prefix of [
          'config',
          'dashboard',
          'sensor-catalog',
          'device-settings',
          'device-health',
          'settings-preferences',
        ])
          void queryClient.invalidateQueries({ queryKey: [prefix] });
        return { ...value, reviewed: null, acceptSkipped: false };
      } catch (error) {
        draft.patch({ reviewed: null, acceptSkipped: false });
        throw error;
      }
    },
  });
  const value = draft.value!;
  const reviewed = value.reviewed;
  const changes =
    reviewed?.review.sections.flatMap((section) =>
      section.changes.map((change) => ({ ...change, section })),
    ) ?? [];
  const replacements = changes.filter((row) => row.action === 'update').length;
  const additions = changes.filter((row) => row.action === 'add').length;
  const visible = changes.filter((row) =>
    `${row.name} ${row.id} ${row.section.label}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );
  const busy = draft.saving || reviewing || reading;
  const invalidateReview = () => {
    entityDraftStore.errors(key, []);
    request.current?.abort();
    setReviewing(false);
    setConfirm(false);
    setError('');
    setResult('');
    draft.patch({ reviewed: null, acceptSkipped: false });
  };
  const reviewFile = async (toml = value.toml, selection = value.selection) => {
    if (!toml.trim() || !Object.values(selection).some(Boolean)) {
      setError('Choose a TOML file and at least one section.');
      return;
    }
    invalidateReview();
    const controller = new AbortController();
    request.current = controller;
    setReviewing(true);
    try {
      const response = await readApiResponse<Review>(
        await fetch(`${apiEndpoint}/api/v1/config/migrate/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toml, selection }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30000),
          ]),
        }),
        'Could not review this file.',
      );
      if (!controller.signal.aborted && response.data) {
        draft.patch({ reviewed: response.data, acceptSkipped: false });
        setFilter('');
        setLimit(80);
        requestAnimationFrame(() => {
          const heading = document.getElementById('migration-review-title');
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: 'start' });
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.name === 'TimeoutError'
              ? 'Review timed out. Nothing was imported; try again.'
              : error.message
            : 'Could not review this file.',
        );
    } finally {
      if (request.current === controller) setReviewing(false);
    }
  };
  const chooseFile = async (file: File) => {
    const generation = ++fileGeneration.current;
    invalidateReview();
    if (file.size > 16 * 1024 * 1024) {
      setError('Choose a TOML file smaller than 16 MB.');
      return;
    }
    setReading(true);
    try {
      const toml = await file.text();
      if (generation !== fileGeneration.current) return;
      draft.patch({
        filename: file.name,
        toml,
        reviewed: null,
        acceptSkipped: false,
      });
      await reviewFile(toml);
    } catch {
      setError('Could not read this file. Choose it again.');
    } finally {
      if (generation === fileGeneration.current) setReading(false);
    }
  };
  const discard = () => {
    fileGeneration.current++;
    request.current?.abort();
    setReading(false);
    setReviewing(false);
    setConfirm(false);
    setError('');
    setResult('');
    entityDraftStore.forget(key);
    entityDraftStore.sync(key, EMPTY, {
      label: 'Legacy import',
      href: '/config/migration',
    });
    if (fileInput.current) fileInput.current.value = '';
  };
  return (
    <div className="settings-detail space-y-5">
      <ConfigPageHeader
        title="Import an older setup"
        description="Review selected entries from a legacy TOML file before adding them to your saved setup."
      />
      <ConfigSectionTabs />
      <SettingsSection
        title="Choose what to import"
        description="For a new setup, import connections first, wait for device discovery, then review rooms, scenes and routines from the same file. Other saved entries are kept."
      >
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Import sections</legend>
          {sections.map((section) => (
            <label key={section.key} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={value.selection[section.key]}
                onChange={(event) => {
                  invalidateReview();
                  draft.patch({
                    selection: {
                      ...value.selection,
                      [section.key]: event.target.checked,
                    },
                  });
                }}
              />
              <span>
                {section.label}
                <span className="block text-xs text-muted-foreground">
                  {section.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="mt-4 text-xs text-muted-foreground">
          Entries with matching IDs are replaced.{' '}
          <Link className="settings-link" to="/config/import-export">
            Download a backup
          </Link>{' '}
          or{' '}
          <Link className="settings-link" to="/config/integrations">
            check connections and device discovery
          </Link>
          .
        </p>
      </SettingsSection>
      <SettingsSection
        title="Legacy file"
        description="The file stays in this session while you visit related settings. Nothing is imported during review."
      >
        <label className="block space-y-2 text-sm">
          TOML file
          <input
            ref={fileInput}
            type="file"
            accept=".toml,text/plain"
            disabled={busy}
            className="block w-full min-w-0 rounded-md border border-input p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-2"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void chooseFile(file);
            }}
          />
        </label>
        {value.filename && (
          <p className="mt-3 break-all text-sm">
            {value.filename} · retained in this session
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              busy ||
              !value.toml.trim() ||
              !Object.values(value.selection).some(Boolean)
            }
            onClick={() => void reviewFile()}
          >
            {reviewing ? 'Reviewing…' : 'Review selected entries'}
          </Button>
          {value.toml && !draft.dirty && (
            <Button variant="ghost" disabled={busy} onClick={discard}>
              Clear file
            </Button>
          )}
        </div>
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
      {reviewed && (
        <SettingsSection
          id="migration-review"
          title="Review import"
          description="Only the selected entries below are added or replaced. Credential values are hidden."
        >
          <div
            aria-label="Import summary"
            className="flex flex-wrap gap-3 text-sm"
          >
            <span>{additions} to add</span>
            <span>{replacements} to replace</span>
            <span className="text-muted-foreground">
              {reviewed.review.sections.reduce(
                (n, section) => n + section.unchanged,
                0,
              )}{' '}
              unchanged
            </span>
          </div>
          <div className="my-4 space-y-2 text-xs text-muted-foreground">
            {reviewed.review.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
          {reviewed.skipped.length > 0 && (
            <div className="my-4 space-y-3 rounded-md border border-amber-500/40 p-3 text-sm">
              <h3 className="font-medium">Some references will be skipped</h3>
              <ul className="max-h-64 list-inside list-disc space-y-1 overflow-auto break-words">
                {reviewed.skipped.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  data-field="skipped"
                  type="checkbox"
                  checked={value.acceptSkipped}
                  disabled={busy}
                  onChange={(event) =>
                    draft.patch({ acceptSkipped: event.target.checked })
                  }
                />
                <span>
                  Import with these skips; affected routines stay disabled.
                </span>
              </label>
            </div>
          )}
          <label className="block space-y-1 text-sm">
            Filter affected entries
            <Input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setLimit(80);
              }}
              placeholder="Name, ID or category"
            />
          </label>
          <ul
            className="mt-3 divide-y divide-border"
            aria-label="Migration changes"
          >
            {visible.slice(0, limit).map((row) => {
              const entity = sections.find(
                (section) => section.key === row.section.key,
              )?.entity;
              return (
                <li
                  key={`${row.section.key}/${row.id}`}
                  className="flex items-start gap-3 py-3 text-sm"
                >
                  <span className="w-16 shrink-0 text-xs font-medium">
                    {row.action === 'add' ? 'Add' : 'Replace'}
                  </span>
                  <div className="min-w-0 flex-1 break-words">
                    <div className="font-medium">
                      {entity && row.action !== 'add' ? (
                        <Link
                          className="settings-link"
                          to={configItemHref(entity, row.id)}
                        >
                          {row.name}
                        </Link>
                      ) : (
                        row.name
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.section.label}
                      {advanced
                        ? ` · ${row.id} · ${row.fields.join(', ')}`
                        : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          {!changes.length && (
            <p className="mt-3 text-sm text-muted-foreground">
              No selected entries would change.
            </p>
          )}
          {visible.length > limit && (
            <Button variant="outline" onClick={() => setLimit((n) => n + 80)}>
              Show more ({visible.length - limit} remaining)
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {visible.length} affected entries
            {filter ? ' matching this filter' : ''}. Changes to the saved setup
            or device resolution require a new review.
          </p>
        </SettingsSection>
      )}
      {draft.dirty &&
        host &&
        createPortal(
          <div className="settings-savebar" aria-label="Legacy import actions">
            {draft.errors.map((error, index) => (
              <p role="alert" className="settings-save-errors" key={index}>
                {error.message}
              </p>
            ))}
            <div className="settings-save-actions">
              <div className="min-w-0 flex-1 text-xs">
                <strong>
                  {draft.saving
                    ? 'Importing…'
                    : reviewing
                      ? 'Reviewing…'
                      : 'Import not applied'}
                </strong>
                <p className="truncate text-muted-foreground">
                  {value.filename || 'Choose a file'}
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
                data-field="review"
                disabled={
                  busy ||
                  !value.toml.trim() ||
                  !Object.values(value.selection).some(Boolean) ||
                  !!(
                    reviewed &&
                    (!changes.length ||
                      (reviewed.skipped.length && !value.acceptSkipped))
                  )
                }
                onClick={() => {
                  if (!reviewed) void reviewFile();
                  else setConfirm(true);
                }}
              >
                {reviewed ? 'Import selected entries' : 'Review again'}
              </Button>
            </div>
          </div>,
          host,
        )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Import selected entries?</DialogTitle>
            <DialogDescription>
              This adds {additions} entries and replaces {replacements}. Other
              saved entries are kept. Connections may restart and pending
              routine timers are canceled.
              {reviewed?.skipped.length
                ? ' Acknowledged references are skipped and affected routines remain disabled.'
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant={replacements ? 'destructive' : 'default'}
              onClick={() => {
                setConfirm(false);
                void draft.save();
              }}
            >
              Confirm import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
