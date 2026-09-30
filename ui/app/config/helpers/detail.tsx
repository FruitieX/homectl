import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import {
  useHelpers,
  useHelperDefinitions,
  useSetHelperValue,
  useRoutines,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { entityDraftStore } from '@/lib/entityDraft';
import { routineReferences } from '@/lib/configUsage';
import { configItemHref } from '@/lib/configItemHref';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  HelperInitialValueField,
  HelperKindFields,
  HelperNameFields,
  HelperPersistenceFields,
} from './fields';
import {
  ValueControl,
  formatValue,
  helperDefinition,
  invalidHelperValue,
  newHelperDraft,
  validateDraft,
} from './shared';

function CurrentValue({ status }: { status: HelperRuntimeStatus }) {
  const command = useSetHelperValue(),
    { advanced } = useSettingsPreferences();
  const [value, setValue] = useState<JsonValue>(status.value),
    [dirty, setDirty] = useState(false),
    [failed, setFailed] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!dirty) setValue(status.value);
  }, [status.value, dirty]);
  const invalid = invalidHelperValue(status.kind, value);
  async function apply() {
    if (invalid) return;
    setMessage('');
    setFailed(false);
    try {
      await command.mutateAsync({ id: status.id, value });
      setDirty(false);
      setMessage('Current value updated.');
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : 'Could not change the value.',
      );
    }
  }
  return (
    <SettingsSection
      id="current"
      title="Current value"
      description="Routines read this value now. Setting it is an immediate command and can trigger routines."
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <strong className="break-all text-xl">
          {formatValue(status.value)}
        </strong>
        {advanced && (
          <span className="text-xs text-muted-foreground">
            Revision {String(status.revision)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <ValueControl
            kind={status.kind}
            ariaLabel="Current helper value"
            disabled={command.isPending}
            value={value}
            onChange={(next) => {
              setValue(next);
              setDirty(true);
              setMessage('');
              setFailed(false);
            }}
          />
        </div>
        <Button
          variant="outline"
          disabled={command.isPending || !!invalid}
          onClick={() => void apply()}
        >
          {command.isPending ? 'Setting…' : 'Set current value'}
        </Button>
      </div>
      {invalid && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {invalid}
        </p>
      )}
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={`mt-2 text-xs ${failed ? 'text-destructive' : ''}`}
        >
          {message}
        </p>
      )}
    </SettingsSection>
  );
}

export default function HelperDetailPage() {
  const { id } = useParams(),
    creating = id === 'new',
    navigate = useNavigate();
  const api = useHelpers(),
    definitions = useHelperDefinitions(),
    routines = useRoutines();
  const { apiEndpoint } = useAppConfig(),
    { advanced } = useSettingsPreferences();
  const status = api.data.find((row) => row.id === id);
  const saved = useMemo(
    () => (status ? helperDefinition(status) : undefined),
    [status],
  );
  const empty = useMemo(() => newHelperDraft(), []);
  const key = `${apiEndpoint}/helpers/${creating ? '$new' : id}`;
  const draft = useEntityDraft({
    key,
    item: creating ? empty : saved,
    label: saved?.name ?? 'New helper',
    href: creating ? '/config/helpers/new' : configItemHref('helper', id!),
    validate(value) {
      const message = validateDraft(value),
        errors = message
          ? [
              {
                field: !value.id.trim()
                  ? 'id'
                  : !value.name.trim()
                    ? 'name'
                    : 'kind',
                message,
              },
            ]
          : [];
      const invalid = invalidHelperValue(value.kind, value.initial_value);
      if (invalid)
        errors.push({
          field: 'initial_value',
          message: `Initial value: ${invalid}`,
        });
      if (creating && api.data.some((row) => row.id === value.id))
        errors.push({
          field: 'id',
          message: 'This helper ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      if (
        status &&
        invalidHelperValue(value.kind, status.value) &&
        !(await confirmDialog({
          title: 'Reset the current value?',
          description: `The current value “${formatValue(status.value)}” does not fit the new type or options. Saving resets it to the initial value “${formatValue(value.initial_value)}”.`,
          confirmLabel: 'Save and reset value',
        }))
      )
        throw new Error('Save cancelled. Your draft is still here.');
      const result = await definitions.update(
        value.id,
        { ...value, ...(creating ? { create_only: true } : {}) },
        creating ? undefined : expected,
      );
      if (result && creating) {
        draft.forget();
        navigate(configItemHref('helper', result.id), { replace: true });
      }
      return result ? helperDefinition(result) : value;
    },
  });
  const value = draft.value;
  useAssistantPageContext(
    saved
      ? { kind: 'helper', id: saved.id, label: saved.name }
      : { kind: 'helper' },
  );
  async function remove() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description:
          'Routines that reference this helper will lose their value source.',
        confirmLabel: 'Delete helper',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/helpers');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  const related = routines.data.filter((row) =>
    routineReferences(row.definition_v2).helpers.has(id ?? ''),
  );
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/helpers"
      backLabel="Helpers"
      title={creating ? 'New helper' : (saved?.name ?? 'Helper')}
      status={
        creating
          ? 'Define a value for your routines.'
          : advanced
            ? saved?.id
            : undefined
      }
      loading={api.loading}
      error={api.error}
      onRetry={() => void api.refetch()}
      notFound={!creating && !saved && !draft.dirty}
      menu={
        !creating
          ? [
              {
                label: 'Delete helper',
                onSelect: () => void remove(),
                destructive: true,
              },
            ]
          : undefined
      }
    >
      {value && (
        <>
          {!creating && status && (
            <CurrentValue key={status.id} status={status} />
          )}
          <SettingsSection id="details" title="Details">
            <HelperNameFields
              draft={value}
              setDraft={draft.change}
              isNew={creating}
            />
          </SettingsSection>
          <SettingsSection
            id="type"
            title="Type & initial value"
            description="Definition changes apply when you save. The current-value command above uses the saved definition."
          >
            <div className="space-y-4">
              <HelperKindFields
                draft={value}
                setDraft={draft.change}
                onKindChange={(kind) => {
                  const next = entityDraftStore.switchVariant<{
                    kind: HelperDefinition['kind'];
                    initial_value: JsonValue;
                  }>(
                    key,
                    'helper-kind',
                    value.kind.kind,
                    { kind: value.kind, initial_value: value.initial_value },
                    kind.kind.kind,
                    kind,
                  );
                  draft.patch(next);
                }}
              />
              <HelperInitialValueField draft={value} setDraft={draft.change} />
            </div>
          </SettingsSection>
          <SettingsSection id="persistence" title="Restart & visibility">
            <HelperPersistenceFields draft={value} setDraft={draft.change} />
          </SettingsSection>
          {!creating && (
            <SettingsSection
              id="usage"
              title="Used by"
              description="Native routine references. Scripts may also read this helper."
            >
              {routines.error ? (
                <p role="alert">
                  Could not load routine references.{' '}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void routines.refetch()}
                  >
                    Retry
                  </Button>
                </p>
              ) : routines.loading ? (
                <p className="text-xs">Loading references…</p>
              ) : related.length ? (
                <div className="flex flex-wrap gap-3">
                  {related.map((row) => (
                    <Link
                      className="text-sm text-primary underline"
                      key={row.id}
                      to={configItemHref('routine', row.id)}
                    >
                      {row.name}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No native routine references.
                </p>
              )}
            </SettingsSection>
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create helper' : undefined}
          />
        </>
      )}
    </DetailPageShell>
  );
}
