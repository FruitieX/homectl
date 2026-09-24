import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useHelpers, useSetHelperValue } from '@/hooks/useConfig';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { StatusRegion } from '@/ui/config/StatusRegion';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { toast } from 'sonner';

import {
  HelperInitialValueField,
  HelperKindFields,
  HelperNameFields,
  HelperPersistenceFields,
} from './fields';
import { ValueControl, formatValue, kindLabel, validateDraft } from './page';

/** The current value, leading the page, with the write that changes it. */
function CurrentValuePanel({
  status,
  draft,
}: {
  status?: HelperRuntimeStatus;
  draft: HelperDefinition;
}) {
  const setHelperValue = useSetHelperValue();
  const [valueDraft, setValueDraft] = useState<JsonValue>(
    status?.value ?? draft.initial_value,
  );
  const [valueError, setValueError] = useState<string | null>(null);
  const [valueSaved, setValueSaved] = useState(false);

  useEffect(() => {
    if (status?.value !== undefined) {
      setValueDraft(status.value);
    }
  }, [status?.value]);

  const saveValue = async () => {
    setValueError(null);
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

  const kind = draft.kind;
  const outOfRange =
    kind.kind === 'enum' &&
    typeof status?.value === 'string' &&
    !kind.options.includes(status.value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold text-foreground">
          {formatValue(status?.value ?? draft.initial_value)}
        </span>
        <Badge variant="outline">{kindLabel(kind)}</Badge>
        <Badge
          variant="outline"
          title={
            draft.persistence === 'durable'
              ? 'Keeps its value across restarts'
              : 'Resets to its initial value when homectl restarts'
          }
        >
          {draft.persistence === 'durable'
            ? 'Survives restart'
            : 'Resets on restart'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {status
          ? `What routines read right now, at revision ${String(status.revision)}.`
          : 'No runtime status received yet; showing the initial value.'}
      </p>
      {outOfRange ? (
        <Alert>
          <AlertDescription>
            The options below no longer include the current value “
            {String(status?.value)}”, so writes of that value would be rejected.
          </AlertDescription>
        </Alert>
      ) : null}
      {/* An immediate command, not a section edit: writing the value does not
          change the definition and needs no Save. */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ValueControl
            kind={kind}
            value={valueDraft}
            onChange={(value) => {
              setValueSaved(false);
              setValueDraft(value);
            }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={setHelperValue.isPending}
          onClick={() => void saveValue()}
        >
          {setHelperValue.isPending ? 'Setting…' : 'Set current value'}
        </Button>
      </div>
      <StatusRegion message={valueSaved ? 'Current value written.' : null} />
      {valueError ? (
        <p role="alert" className="text-xs text-destructive">
          {valueError}
        </p>
      ) : null}
    </div>
  );
}

export default function HelperDetailPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { data: statuses, loading, error, update, remove } = useHelpers();
  const { activeSection, openSection } = useSectionParams();
  const headingRefs = useRef<Record<string, HTMLElement | null>>({});

  const status = useMemo(
    () => (statuses ?? []).find((entry) => entry.id === routeId),
    [statuses, routeId],
  );

  const draft: HelperDefinition | undefined = useMemo(() => {
    if (!status) return undefined;
    return {
      id: status.id,
      name: status.name,
      kind: status.kind,
      initial_value: status.initial_value,
      persistence: status.persistence,
      hidden: status.hidden,
    };
  }, [status]);

  useAssistantPageContext({
    kind: 'helper',
    id: status?.id,
    label: status?.name,
  });

  useEffect(() => {
    if (!activeSection) return;
    const node = headingRefs.current[activeSection];
    if (node) {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [activeSection]);

  const saveFields = useCallback(
    async (patch: Partial<HelperDefinition>) => {
      if (!draft) return;
      const next: HelperDefinition = { ...draft, ...patch };
      const invalid = validateDraft(next);
      if (invalid) {
        throw new Error(invalid);
      }
      await update(next.id, next);
    },
    [draft, update],
  );

  const nameEditor = useSectionEditor<HelperDefinition>({
    item: draft,
    fields: ['id', 'name'],
    save: (values) => saveFields(values),
  });
  const kindEditor = useSectionEditor<HelperDefinition>({
    item: draft,
    fields: ['kind', 'initial_value'],
    save: (values) => saveFields(values),
  });
  const initialEditor = useSectionEditor<HelperDefinition>({
    item: draft,
    fields: ['initial_value'],
    save: (values) => saveFields(values),
  });
  const persistenceEditor = useSectionEditor<HelperDefinition>({
    item: draft,
    fields: ['persistence', 'hidden'],
    save: (values) => saveFields(values),
  });

  const crumbs = [
    { label: 'Settings', to: '/config' },
    { label: 'Helpers', to: '/config/helpers' },
    { label: routeId ?? 'Helper' },
  ];

  if (loading) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/helpers"
        backLabel="Back to helpers"
        title={routeId ?? 'Helper'}
      >
        <Skeleton className="h-32 w-full rounded-2xl" />
      </DetailPageShell>
    );
  }

  if (!status || !draft) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/helpers"
        backLabel="Back to helpers"
        title={routeId ?? 'Helper'}
      >
        <EmptyState
          title="This helper is not in the current configuration"
          description={`${routeId ?? 'It'} may have been deleted or renamed. Open Helpers to pick another.`}
        />
      </DetailPageShell>
    );
  }

  const deleteHelper = () => {
    void (async () => {
      const confirmed = await confirmDestructive(
        `Delete helper "${draft.name}"?`,
        'Routines and scripts that read it lose their value source until you point them somewhere else.',
      );
      if (!confirmed) return;
      try {
        await remove(draft.id);
        toast.success(`Deleted ${draft.name}`);
        void navigate('/config/helpers', { replace: true });
      } catch (nextError) {
        toast.error(
          nextError instanceof Error ? nextError.message : 'Failed to delete',
        );
      }
    })();
  };

  return (
    <DetailPageShell
      crumbs={crumbs}
      backTo="/config/helpers"
      backLabel="Back to helpers"
      title={draft.name || draft.id}
      status={
        <span className="block text-muted-foreground">
          {draft.persistence === 'durable'
            ? 'Durable: its value is stored and survives a restart.'
            : 'Session: its value resets to the initial value when homectl restarts.'}
        </span>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <CurrentValuePanel status={status} draft={draft} />

        <Section<HelperDefinition>
          id="name"
          title="Name and visibility"
          summary={draft.name || draft.id}
          open={activeSection === 'name'}
          onOpenChange={(open) => openSection(open ? 'name' : null)}
          headingRef={(node) => {
            headingRefs.current.name = node;
          }}
          api={nameEditor}
          readView={
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Name
                </dt>
                <dd className="text-sm text-foreground">{draft.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Id
                </dt>
                <dd className="truncate text-sm text-foreground">{draft.id}</dd>
              </div>
            </dl>
          }
          renderEditor={(api) => (
            <HelperNameFields
              draft={{ ...draft, ...(api.draft ?? {}) }}
              setDraft={(next) => api.patch(next)}
              isNew={false}
            />
          )}
        />

        <Section<HelperDefinition>
          id="type"
          title="Type rules"
          summary={kindLabel(draft.kind)}
          open={activeSection === 'type'}
          onOpenChange={(open) => openSection(open ? 'type' : null)}
          headingRef={(node) => {
            headingRefs.current.type = node;
          }}
          api={kindEditor}
          readView={
            <p className="text-sm text-muted-foreground">
              {kindLabel(draft.kind)}
              {draft.kind.kind === 'enum'
                ? ` · options: ${draft.kind.options.join(', ')}`
                : ''}
              {draft.kind.kind === 'number'
                ? ` · ${draft.kind.min ?? '−∞'} to ${draft.kind.max ?? '∞'}`
                : ''}
            </p>
          }
          renderEditor={(api) => (
            <HelperKindFields
              draft={{ ...draft, ...(api.draft ?? {}) }}
              setDraft={(next) => api.patch(next)}
            />
          )}
        />

        <Section<HelperDefinition>
          id="initial"
          title="Initial value"
          summary={formatValue(draft.initial_value)}
          open={activeSection === 'initial'}
          onOpenChange={(open) => openSection(open ? 'initial' : null)}
          headingRef={(node) => {
            headingRefs.current.initial = node;
          }}
          api={initialEditor}
          readView={
            <p className="text-sm text-muted-foreground">
              {formatValue(draft.initial_value)} — used at initialization and
              after a restart.
            </p>
          }
          renderEditor={(api) => (
            <HelperInitialValueField
              draft={{ ...draft, ...(api.draft ?? {}) }}
              setDraft={(next) => api.patch(next)}
            />
          )}
        />

        <Section<HelperDefinition>
          id="persistence"
          title="Persistence"
          summary={
            draft.persistence === 'durable'
              ? 'Durable — survives restart'
              : 'Session — resets on restart'
          }
          open={activeSection === 'persistence'}
          onOpenChange={(open) => openSection(open ? 'persistence' : null)}
          headingRef={(node) => {
            headingRefs.current.persistence = node;
          }}
          api={persistenceEditor}
          readView={
            <p className="text-sm text-muted-foreground">
              {draft.persistence === 'durable'
                ? 'Stored in the database and survives restarts.'
                : 'Resets to the initial value when homectl restarts.'}
              {draft.hidden ? ' Hidden from widget pickers.' : ''}
            </p>
          }
          renderEditor={(api) => (
            <HelperPersistenceFields
              draft={{ ...draft, ...(api.draft ?? {}) }}
              setDraft={(next) => api.patch(next)}
            />
          )}
        />

        <Section<HelperDefinition>
          id="danger"
          title="Delete this helper"
          summary="Reads that depend on it lose their value source"
          open={activeSection === 'danger'}
          onOpenChange={(open) => openSection(open ? 'danger' : null)}
          headingRef={(node) => {
            headingRefs.current.danger = node;
          }}
          api={nameEditor}
          editable={false}
          danger
          readView={
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Routines and scripts that read it lose their value source until
                you point them somewhere else.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={deleteHelper}
              >
                Delete this helper
              </Button>
            </div>
          }
          renderEditor={() => null}
        />
      </div>
    </DetailPageShell>
  );
}
