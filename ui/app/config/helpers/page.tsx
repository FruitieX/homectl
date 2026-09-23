import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperKind } from '@/bindings/HelperKind';
import type { HelperPersistence } from '@/bindings/HelperPersistence';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useHelpers, useSetHelperValue } from '@/hooks/useConfig';
import { useCreateDeepLink, useSearchParamState } from '@/hooks/useDeepLink';
import { useHelperStatuses } from '@/hooks/websocket';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormGrid,
  ConfigFormSection,
  ConfigHelpPanel,
  ConfigToggleRow,
} from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { useCallback, useMemo, useState } from 'react';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { ConfigPageHeader } from '../page-header';
import { selectClassName } from '@/ui/form-styles';

const KIND_OPTIONS: Array<{ value: HelperKind['kind']; label: string }> = [
  { value: 'boolean', label: 'Boolean' },
  { value: 'enum', label: 'Enum (fixed options)' },
  { value: 'number', label: 'Number (bounded)' },
  { value: 'string', label: 'String' },
];

function kindLabel(kind: HelperKind) {
  switch (kind.kind) {
    case 'boolean':
      return 'Boolean';
    case 'enum':
      return `Enum (${kind.options.length})`;
    case 'number':
      return 'Number';
    case 'string':
      return 'String';
  }
}

function defaultKind(kind: HelperKind['kind']): HelperKind {
  switch (kind) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'enum':
      return { kind: 'enum', options: ['on', 'off'] };
    case 'number':
      return { kind: 'number' };
    case 'string':
      return { kind: 'string' };
  }
}

function defaultValueForKind(kind: HelperKind): JsonValue {
  switch (kind.kind) {
    case 'boolean':
      return false;
    case 'enum':
      return kind.options[0] ?? '';
    case 'number':
      return kind.min ?? 0;
    case 'string':
      return '';
  }
}

function formatValue(value: JsonValue) {
  if (typeof value === 'string') {
    return value === '' ? '(empty)' : value;
  }
  return JSON.stringify(value);
}

function newHelperDraft(): HelperDefinition {
  const kind: HelperKind = { kind: 'boolean' };
  return {
    id: '',
    name: '',
    kind,
    initial_value: defaultValueForKind(kind),
    persistence: 'durable',
  };
}

function validateDraft(draft: HelperDefinition): string | null {
  if (!draft.id.trim()) {
    return 'Helper id must not be empty.';
  }
  if (!draft.name.trim()) {
    return 'Helper name must not be empty.';
  }
  if (draft.kind.kind === 'enum') {
    if (draft.kind.options.length === 0) {
      return 'Enum helpers need at least one option.';
    }
    if (draft.kind.options.some((option) => !option.trim())) {
      return 'Enum options must not be empty.';
    }
    if (new Set(draft.kind.options).size !== draft.kind.options.length) {
      return 'Enum options must be unique.';
    }
  }
  if (
    draft.kind.kind === 'number' &&
    draft.kind.min !== undefined &&
    draft.kind.max !== undefined &&
    draft.kind.min > draft.kind.max
  ) {
    return 'Number minimum exceeds its maximum.';
  }
  return null;
}

function ValueControl({
  kind,
  value,
  onChange,
}: {
  kind: HelperKind;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  switch (kind.kind) {
    case 'boolean':
      return (
        <select
          className={selectClassName}
          value={value === true ? 'true' : 'false'}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="true">On / true</option>
          <option value="false">Off / false</option>
        </select>
      );
    case 'enum':
      return (
        <SearchablePicker
          options={kind.options.map((option) => ({
            value: option,
            label: option,
          }))}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          clearable={false}
        />
      );
    case 'number':
      return (
        <Input
          max={kind.max}
          min={kind.min}
          step="any"
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
        />
      );
    case 'string':
      return (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function HelperEditor({
  draft,
  setDraft,
  isNew,
  status,
  saving,
  error,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
  isNew: boolean;
  status?: HelperRuntimeStatus;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const setHelperValue = useSetHelperValue();
  const [valueDraft, setValueDraft] = useState<JsonValue>(
    status?.value ?? draft.initial_value,
  );
  const [valueError, setValueError] = useState<string | null>(null);
  const [valueSaved, setValueSaved] = useState(false);
  const kind = draft.kind;

  const changeKind = (kind: HelperKind['kind']) => {
    const next = defaultKind(kind);
    setDraft({
      ...draft,
      kind: next,
      initial_value: defaultValueForKind(next),
    });
  };

  const updateEnumOptions = (options: string[]) => {
    const nextKind: HelperKind = { kind: 'enum', options };
    const initialStillValid =
      typeof draft.initial_value === 'string' &&
      options.includes(draft.initial_value);
    setDraft({
      ...draft,
      kind: nextKind,
      initial_value: initialStillValid
        ? draft.initial_value
        : (options[0] ?? ''),
    });
  };

  const saveValue = async () => {
    setValueError(null);
    setValueSaved(false);
    try {
      await setHelperValue.mutateAsync({ id: draft.id, value: valueDraft });
      setValueSaved(true);
    } catch (setFailure) {
      setValueError(
        setFailure instanceof Error
          ? setFailure.message
          : 'Failed to set helper value',
      );
    }
  };

  return (
    <>
      <ConfigFormSection
        title="Identity"
        description="The id is the stable reference routines and scripts use; it is fixed once the helper exists."
      >
        <ConfigFormGrid>
          <ConfigField label="Id">
            <Input
              disabled={!isNew}
              placeholder="staircase_mode"
              type="text"
              value={draft.id}
              onChange={(event) =>
                setDraft({ ...draft, id: event.target.value })
              }
            />
          </ConfigField>
          <ConfigField label="Name">
            <Input
              placeholder="Staircase mode"
              type="text"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </ConfigField>
        </ConfigFormGrid>
      </ConfigFormSection>

      <ConfigFormSection
        title="Kind"
        description="The declared type constrains every write; the server rejects values outside it."
      >
        <ConfigField label="Type">
          <select
            className={selectClassName}
            value={kind.kind}
            onChange={(event) =>
              changeKind(event.target.value as HelperKind['kind'])
            }
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </ConfigField>

        {kind.kind === 'enum' ? (
          <ConfigField
            label="Options"
            description="Ordered options; the first is the default value."
          >
            <div className="space-y-2">
              {kind.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={option}
                    onChange={(event) => {
                      const options = [...kind.options];
                      options[index] = event.target.value;
                      updateEnumOptions(options);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={kind.options.length <= 1}
                    onClick={() =>
                      updateEnumOptions(
                        kind.options.filter(
                          (_candidate, candidate) => candidate !== index,
                        ),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateEnumOptions([...kind.options, ''])}
              >
                Add option
              </Button>
            </div>
          </ConfigField>
        ) : null}

        {kind.kind === 'number' ? (
          <ConfigFormGrid>
            <ConfigField label="Minimum" description="Optional lower bound.">
              <Input
                step="any"
                type="number"
                value={kind.min ?? ''}
                onChange={(event) => {
                  const parsed =
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value);
                  setDraft({
                    ...draft,
                    kind: {
                      kind: 'number',
                      min: Number.isFinite(parsed) ? parsed : undefined,
                      max: kind.max,
                    },
                  });
                }}
              />
            </ConfigField>
            <ConfigField label="Maximum" description="Optional upper bound.">
              <Input
                step="any"
                type="number"
                value={kind.max ?? ''}
                onChange={(event) => {
                  const parsed =
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value);
                  setDraft({
                    ...draft,
                    kind: {
                      kind: 'number',
                      min: kind.min,
                      max: Number.isFinite(parsed) ? parsed : undefined,
                    },
                  });
                }}
              />
            </ConfigField>
          </ConfigFormGrid>
        ) : null}
      </ConfigFormSection>

      <ConfigFormSection
        title="Value"
        description="The initial value is used before any durable value exists; the current value is what routines read."
      >
        <ConfigField label="Initial value">
          <ValueControl
            kind={draft.kind}
            value={draft.initial_value}
            onChange={(initial_value) => setDraft({ ...draft, initial_value })}
          />
        </ConfigField>
        {!isNew ? (
          <ConfigField
            label={`Current value${
              status ? ` (revision ${String(status.revision)})` : ''
            }`}
            description="Writes go through the same validation as routine writes."
          >
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ValueControl
                  kind={draft.kind}
                  value={valueDraft}
                  onChange={(value) => {
                    setValueSaved(false);
                    setValueDraft(value);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={setHelperValue.isPending}
                onClick={() => void saveValue()}
              >
                {setHelperValue.isPending ? 'Setting…' : 'Set value'}
              </Button>
            </div>
            {valueSaved ? (
              <p className="text-xs text-muted-foreground">Value written.</p>
            ) : null}
            {valueError ? (
              <p className="text-xs text-destructive">{valueError}</p>
            ) : null}
          </ConfigField>
        ) : null}
      </ConfigFormSection>

      <ConfigFormSection
        title="Behavior"
        description="Durable values survive restarts; session values reset to the initial value."
      >
        <ConfigField label="Persistence">
          <select
            className={selectClassName}
            value={draft.persistence}
            onChange={(event) =>
              setDraft({
                ...draft,
                persistence: event.target.value as HelperPersistence,
              })
            }
          >
            <option value="durable">Durable (stored in the database)</option>
            <option value="session">Session (reset on restart)</option>
          </select>
        </ConfigField>
        <ConfigToggleRow
          label="Hidden"
          description="Hidden helpers stay usable but are omitted from widget pickers."
        >
          <input
            type="checkbox"
            checked={draft.hidden ?? false}
            onChange={(event) =>
              setDraft({ ...draft, hidden: event.target.checked || undefined })
            }
          />
        </ConfigToggleRow>
      </ConfigFormSection>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ConfigFormActions>
        {onDelete ? (
          <Button
            className="sm:mr-auto"
            type="button"
            variant="destructive"
            onClick={onDelete}
          >
            Delete
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={saving} type="button" onClick={onSave}>
          {saving ? 'Saving…' : 'Save helper'}
        </Button>
      </ConfigFormActions>
    </>
  );
}

export default function HelpersConfigPage() {
  const { data, loading, error, refetch, update, remove } = useHelpers();
  const liveStatuses = useHelperStatuses();

  const [search, setSearch] = useSearchParamState();
  const [editing, setEditing] = useState<{
    draft: HelperDefinition;
    isNew: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openCreate = useCallback(() => {
    setEditing({ draft: newHelperDraft(), isNew: true });
    setSaveError(null);
  }, []);
  useCreateDeepLink(openCreate);

  useAssistantPageContext(
    editing
      ? {
          kind: 'helper',
          id: editing.draft.id.trim() ? editing.draft.id : undefined,
          label: editing.draft.name || editing.draft.id || 'New helper',
        }
      : { kind: 'helper' },
  );

  const statuses = useMemo(() => {
    const source = liveStatuses ?? data;
    const byId = new Map(source.map((status) => [status.id, status]));
    for (const definition of data) {
      if (!byId.has(definition.id)) {
        byId.set(definition.id, definition);
      }
    }
    return [...byId.values()];
  }, [data, liveStatuses]);

  const visible = statuses.filter((status) =>
    matchesConfigSearch(
      search,
      status.id,
      status.name,
      kindLabel(status.kind),
      status.persistence,
      formatValue(status.value),
    ),
  );

  const openEdit = (status: HelperRuntimeStatus) => {
    setEditing({
      draft: {
        id: status.id,
        name: status.name,
        kind: status.kind,
        initial_value: status.initial_value,
        persistence: status.persistence,
        hidden: status.hidden,
      },
      isNew: false,
    });
    setSaveError(null);
  };

  const save = async () => {
    if (!editing) {
      return;
    }
    const invalid = validateDraft(editing.draft);
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await update(editing.draft.id, editing.draft);
      setEditing(null);
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error ? saveFailure.message : 'Failed to save',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteHelper = async () => {
    if (!editing || editing.isNew) {
      return;
    }
    if (
      !(await confirmDestructive(
        `Delete helper "${editing.draft.name || editing.draft.id}"?`,
        'Routines and scripts that read or write this helper will fail to compile.',
      ))
    ) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await remove(editing.draft.id);
      setEditing(null);
    } catch (deleteFailure) {
      setSaveError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : 'Failed to delete',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConfigPageHeader
        title="Helpers"
        description="Keep a value, such as a mode or target temperature, for automations to use."
        actions={
          <Button type="button" onClick={openCreate}>
            New helper
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-3">
            <p>Could not load helpers: {error}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!error && (
        <ConfigListSearchBar
          filteredCount={visible.length}
          placeholder="Search helpers"
          totalCount={statuses.length}
          value={search}
          onChange={setSearch}
        />
      )}

      {!error && statuses.length === 0 ? (
        <EmptyState
          title="No helpers yet"
          description="Create a value that automations can read or change, such as Home/Away mode."
          action={<Button onClick={openCreate}>Create a helper</Button>}
        />
      ) : null}

      {!error && statuses.length > 0 && visible.length === 0 ? (
        <EmptyState
          title="No matching helpers"
          description="Try another name or value."
          action={
            <Button variant="outline" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-4">
        {visible.map((status) => (
          <ExpandableConfigCard
            key={status.id}
            open={editing?.draft.id === status.id && !editing.isNew}
            onOpen={() => openEdit(status)}
            onClose={() => setEditing(null)}
            summary={
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{status.name}</span>
                <code className="text-xs text-muted-foreground">
                  {status.id}
                </code>
                <Badge variant="secondary">{kindLabel(status.kind)}</Badge>
                <Badge variant="outline">
                  {status.persistence === 'durable' ? 'Durable' : 'Session'}
                </Badge>
                {status.hidden ? <Badge variant="outline">Hidden</Badge> : null}
                <span className="ml-auto font-mono text-sm">
                  {formatValue(status.value)}
                </span>
              </div>
            }
            dialogTitle={status.name}
            dialogSubtitle={status.id}
          >
            <HelperEditor
              key={status.id}
              draft={editing?.draft ?? newHelperDraft()}
              setDraft={(draft) =>
                setEditing((current) =>
                  current ? { ...current, draft } : null,
                )
              }
              isNew={false}
              status={status}
              saving={saving}
              error={saveError}
              onSave={() => void save()}
              onCancel={() => setEditing(null)}
              onDelete={() => void deleteHelper()}
            />
          </ExpandableConfigCard>
        ))}
      </div>

      <ResponsiveOverlay
        open={editing?.isNew ?? false}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        title="New helper"
        description="Create a typed value; the id is fixed once saved."
        className="max-w-2xl"
      >
        <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
          <HelperEditor
            draft={editing?.draft ?? newHelperDraft()}
            setDraft={(draft) =>
              setEditing((current) => (current ? { ...current, draft } : null))
            }
            isNew
            saving={saving}
            error={saveError}
            onSave={() => void save()}
            onCancel={() => setEditing(null)}
          />
        </div>
      </ResponsiveOverlay>
    </div>
  );
}
