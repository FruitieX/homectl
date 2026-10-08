import { applyCreatedScene } from '@/lib/routineSceneReturn';
import { Input } from '@/ui/primitives/input';
import {
  outcome as activityOutcome,
  summary as activitySummary,
} from '@/lib/routineActivity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Download, Zap, ListFilter, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import type { Program } from '@/bindings/Program';
import {
  readApiResponse,
  useRoutines,
  useScenes,
  useHelpers,
  useGroups,
  useSources,
  useRoutineHistory,
  type Routine,
  type RoutineDefinitionV2Body,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import {
  useDevicesState,
  useHelperStatuses,
  useRoutineStatuses,
  useTimers,
} from '@/hooks/websocket';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { entityDraftStore } from '@/lib/entityDraft';
import { suggestId } from '@/lib/groupGraph';
import {
  validateRoutineDraft,
  stringifyConfig,
  duplicateRoutineNode,
} from '@/lib/routineDraft';
import { configItemHref } from '@/lib/configItemHref';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { IdentityFields } from '@/ui/settings/IdentityFields';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import {
  RoutineAuthoringContext,
  UnknownFlowValue,
} from '@/ui/settings/FlowBlock';
import { TriggerBuilder } from '@/ui/TriggerBuilder';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { ProgramBuilder } from '@/ui/ProgramBuilder';
import { RoutineExecutionPolicyEditor } from '@/ui/RoutineExecutionPolicyEditor';
import { RoutineWhatIfPreview } from '@/ui/RoutineWhatIfPreview';
import {
  RoutineRuntimePanel,
  routineStatusSummary,
} from '@/ui/routine-runtime';
import { Disclosure } from '@/ui/settings/Disclosure';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';

function newRoutine(): Routine {
  return {
    id: '',
    name: '',
    enabled: true,
    semantics_version: 2,
    rules: [],
    actions: [],
    definition_v2: { triggers: [], program: { kind: 'native', steps: [] } },
  };
}
export function RoutineEditor({ id }: { id?: string }) {
  const api = useRoutines(),
    scenes = useScenes(),
    helpers = useHelpers(),
    groupCatalog = useGroups(),
    sources = useSources();
  const [retryingCatalogs, setRetryingCatalogs] = useState(false);
  const { apiEndpoint } = useAppConfig();
  const catalog = useDevicesApi(),
    liveDevices = useDevicesState(),
    groups = useGroupsState();
  const liveHelpers = useHelperStatuses(),
    statuses = useRoutineStatuses(),
    timers = useTimers();
  const history = useRoutineHistory();
  const failedCatalogs = [
    { name: 'devices', ...catalog },
    { name: 'rooms and groups', ...groupCatalog },
    { name: 'scenes', ...scenes },
    { name: 'helpers', ...helpers },
    { name: 'computed sources', ...sources },
  ].filter((entry) => entry.error);
  const { advanced } = useSettingsPreferences();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showPreview, setShowPreview] = useState(false);
  const [conversion, setConversion] = useState<{
    status: string;
    definition?: RoutineDefinitionV2Body;
    notes?: string[];
    reasons?: string[];
    input: Routine;
  }>();
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const creating = id === undefined;
  const saved = api.data.find((row) => row.id === id);
  const copyFrom = api.data.find(
    (row) => row.id === params.get('copyFrom') && row.semantics_version === 2,
  );
  const initial = useMemo(
    () =>
      copyFrom
        ? {
            ...copyFrom,
            id: suggestId(
              `Copy of ${copyFrom.name}`,
              api.data.map((row) => row.id),
            ),
            name: `Copy of ${copyFrom.name}`,
            revision: undefined,
            definition_v2: copyFrom.definition_v2
              ? duplicateRoutineNode(copyFrom.definition_v2)
              : copyFrom.definition_v2,
          }
        : newRoutine(),
    [copyFrom, api.data],
  );
  const href = creating
    ? '/config/routines/new'
    : configItemHref('routine', id!);
  const key = `${apiEndpoint}/routines/${id ?? '$new'}`;
  const draft = useEntityDraft({
    key,
    item: creating ? initial : saved,
    href,
    label: saved?.name ?? 'New routine',
    validate(value) {
      const errors = validateRoutineDraft(value);
      if (value.semantics_version !== 2)
        errors.push({
          field: 'definition_v2',
          message: 'Convert this legacy routine before editing it.',
        });
      if (creating && api.data.some((row) => row.id === value.id))
        errors.push({
          field: 'id',
          message: 'This routine ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      const result = creating
        ? await api.create(value)
        : await api.update(value.id, value, expected);
      if (creating && result) {
        entityDraftStore.forget(key);
        navigate(configItemHref('routine', result.id), { replace: true });
      }
      return result;
    },
  });
  const routine = draft.value;
  const hasRoutine = routine !== undefined;
  const definition = routine?.definition_v2 ?? {};
  const version = routine?.semantics_version ?? 1;
  const devices = useMemo(
    () => ({ ...catalog.devicesState, ...liveDevices }),
    [catalog.devicesState, liveDevices],
  );
  const helperState = liveHelpers ?? helpers.data;
  const status = id ? statuses?.[id] : undefined;
  const editable = version === 2;
  const requestedNode = params.get('node') ?? params.get('target');
  const [missingNode, setMissingNode] = useState(false);
  const [unselectedScene, setUnselectedScene] = useState<string>();
  const handledSceneReturn = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!requestedNode || !hasRoutine) {
      setMissingNode(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(requestedNode)}"]`,
      );
      setMissingNode(!node);
      node?.focus({ preventScroll: true });
      node?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedNode, hasRoutine, editable]);
  useAssistantPageContext(
    saved ? { kind: 'routine', id: saved.id, label: saved.name } : null,
  );
  useEffect(() => {
    const scene = params.get('scene'),
      node = params.get('sceneNode');
    const current = entityDraftStore.get<Routine>(key)?.value;
    const returnKey = JSON.stringify([key, scene, node]);
    if (!scene || !node) handledSceneReturn.current = undefined;
    if (handledSceneReturn.current === returnKey) return;
    if (scene && node && current) {
      handledSceneReturn.current = returnKey;
      const result = applyCreatedScene(current.definition_v2, node, scene);
      if (result.applied) {
        entityDraftStore.change<Routine>(key, (value) => ({
          ...value,
          definition_v2: result.definition,
        }));
        setUnselectedScene(undefined);
        toast.success('Created scene selected in this routine draft');
      } else setUnselectedScene(scene);
      const next = new URLSearchParams(params);
      next.delete('scene');
      next.delete('sceneNode');
      if (result.applied) next.set('node', node);
      setParams(next, { replace: true });
    }
  }, [key, params, setParams, hasRoutine]);
  useEffect(() => {
    const section = params.get('section');
    if (section && hasRoutine)
      requestAnimationFrame(() =>
        document.getElementById(section)?.scrollIntoView({ block: 'start' }),
      );
  }, [params, hasRoutine]);
  const patchDefinition = (patch: Partial<RoutineDefinitionV2Body>) =>
    draft.change((current) => ({
      ...current,
      definition_v2: { ...current.definition_v2, ...patch },
    }));
  const download = () => {
    if (!routine) return;
    const url = URL.createObjectURL(
      new Blob([stringifyConfig(routine)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `routine-${routine.id || 'draft'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  async function remove() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description:
          'Other routines that invoke this routine will need a replacement. Unsaved changes will be discarded.',
        confirmLabel: 'Delete routine',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/routines');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  async function convert() {
    if (!routine) return;
    setConverting(true);
    setConversionError('');
    try {
      const response = await readApiResponse<{
        status: string;
        definition?: RoutineDefinitionV2Body;
        notes?: string[];
        reasons?: string[];
      }>(
        await fetch(apiEndpoint + '/api/v1/config/routines/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stringifyConfig({ routine, timezone }),
          signal: AbortSignal.timeout(15000),
        }),
        'Could not preview conversion',
      );
      if (response.data)
        setConversion({ ...response.data, input: structuredClone(routine) });
    } catch (error) {
      setConversionError((error as Error).message);
    } finally {
      setConverting(false);
    }
  }
  const recent = history.data
    .filter((row) => row.routine_id === id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/routines"
      backLabel="Routines"
      title={creating ? 'New routine' : (saved?.name ?? 'Routine')}
      status={
        creating
          ? 'Choose what starts it, any conditions, and what happens next.'
          : `${saved?.enabled ? 'Enabled' : 'Disabled'} · ${version === 1 ? 'Legacy routine · Convert to edit' : 'Changes take effect when you save.'}`
      }
      loading={api.loading}
      error={api.error}
      onRetry={() => void api.refetch()}
      notFound={!creating && !saved && !draft.dirty}
      primaryAction={
        version === 2 ? (
          <Button
            variant="outline"
            onClick={() => {
              setShowPreview(true);
              requestAnimationFrame(() =>
                document
                  .getElementById('preview')
                  ?.scrollIntoView({ block: 'start' }),
              );
            }}
          >
            <Eye className="size-4" />
            Preview draft
          </Button>
        ) : undefined
      }
      menu={[
        { label: 'Download definition', onSelect: download },
        ...(!creating
          ? [
              {
                label: 'Delete routine',
                onSelect: () => void remove(),
                destructive: true,
              },
            ]
          : []),
      ]}
    >
      {unselectedScene && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          The scene was created, but the original action is no longer available.
          Choose the scene in another action.{' '}
          <Link
            className="settings-link"
            to={configItemHref('scene', unselectedScene)}
          >
            Open created scene
          </Link>
        </p>
      )}
      {missingNode && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          The referenced step or trigger is no longer present in this
          definition. Recorded activity remains available in the activity page.
        </p>
      )}
      {routine && failedCatalogs.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p>
              Could not refresh reference lists:{' '}
              {failedCatalogs.map((entry) => entry.name).join(', ')}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Saved references and your draft are kept. Some choices may be
              unavailable until the lists recover.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={retryingCatalogs}
            onClick={() => {
              setRetryingCatalogs(true);
              void Promise.allSettled(
                failedCatalogs.map((entry) => entry.refetch()),
              ).finally(() => setRetryingCatalogs(false));
            }}
          >
            {retryingCatalogs ? 'Retrying…' : 'Retry reference lists'}
          </Button>
        </div>
      )}
      {routine && (
        <RoutineAuthoringContext.Provider
          value={{ draftKey: key, returnHref: href }}
        >
          {version !== 1 && version !== 2 && (
            <UnknownFlowValue value={routine} />
          )}
          {!editable && (
            <SettingsSection id="details" title="Details">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Name</dt>
                  <dd>{routine.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ID</dt>
                  <dd className="break-all font-mono text-xs">{routine.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd>{routine.enabled ? 'Enabled' : 'Disabled'}</dd>
                </div>
              </dl>
              {version === 1 && (
                <p className="text-sm text-muted-foreground">
                  This legacy routine is read-only. Convert it to review and
                  edit its flow before saving.
                </p>
              )}
            </SettingsSection>
          )}
          {editable && (
            <div className="min-w-0 space-y-4">
              <SettingsSection id="details" title="Details">
                <IdentityFields
                  draft={draft}
                  creating={creating}
                  existingIds={api.data.map((row) => row.id)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={routine.enabled}
                    onChange={(event) =>
                      draft.patch({ enabled: event.target.checked })
                    }
                  />
                  {creating ? 'Enable after creating' : 'Enabled'}
                </label>
                {creating && (
                  <p className="text-xs text-muted-foreground">
                    {routine.enabled
                      ? 'Creating makes this routine ready to run when its triggers match.'
                      : 'Create it disabled, then enable it when ready.'}
                  </p>
                )}
              </SettingsSection>
              {version === 2 ? (
                <div
                  className="routine-flow"
                  aria-label="Routine flow"
                  data-field="definition_v2"
                  tabIndex={-1}
                >
                  <p className="flow-board-caption">
                    Any starting event → check conditions → run actions in order
                  </p>
                  <div className="flow-inputs">
                    <section className="flow-lane flow-when" id="when">
                      <header>
                        <span className="flow-number">1</span>
                        <div>
                          <h2>
                            <Zap className="size-4" />
                            When
                          </h2>
                          <p>Any of these starts the routine</p>
                        </div>
                      </header>
                      <TriggerBuilder
                        triggers={definition.triggers ?? []}
                        onChange={(triggers) => patchDefinition({ triggers })}
                        devices={devices}
                        groups={groups}
                        scenes={scenes.data}
                        helpers={helperState}
                        runtimeStatus={status}
                      />
                    </section>
                    <section className="flow-lane flow-if" id="only-if">
                      <header>
                        <span className="flow-number">2</span>
                        <div>
                          <h2>
                            <ListFilter className="size-4" />
                            Only if
                          </h2>
                          <p>Checked each time it starts</p>
                        </div>
                      </header>
                      <div className="flow-block">
                        <ConditionEditor
                          condition={
                            (definition.condition ?? {
                              kind: 'literal',
                              value: true,
                            }) as ConditionExpr
                          }
                          onChange={(condition) =>
                            patchDefinition({ condition })
                          }
                          devices={devices}
                          groups={groups}
                          scenes={scenes.data}
                          helpers={helperState}
                        />
                      </div>
                    </section>
                  </div>
                  <section className="flow-lane flow-then" id="then">
                    <header>
                      <span className="flow-number">3</span>
                      <div>
                        <h2>
                          <Play className="size-4" />
                          Then
                        </h2>
                        <p>Run these actions in order</p>
                      </div>
                    </header>
                    <ProgramBuilder
                      program={definition.program as Program | undefined}
                      onChange={(program) => patchDefinition({ program })}
                      devices={devices}
                      groups={groups}
                      scenes={scenes.data}
                      routines={api.data}
                      helpers={helperState}
                    />
                  </section>
                </div>
              ) : null}
              {version === 2 && (
                <Disclosure
                  label="Execution limits"
                  hint="Overlapping runs, action cap and minimum spacing"
                  defaultOpen={definition.execution != null}
                  forceOpen={draft.errors.some((error) =>
                    error.field.startsWith('execution/'),
                  )}
                >
                  <SettingsSection
                    id="execution"
                    title="Execution"
                    description="How overlapping runs and action limits are handled."
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      <RoutineExecutionPolicyEditor
                        draftKey={key}
                        policy={
                          definition.execution as ExecutionPolicy | undefined
                        }
                        onChange={(execution) => patchDefinition({ execution })}
                      />
                    </div>
                  </SettingsSection>
                </Disclosure>
              )}
            </div>
          )}
          {version === 1 && (
            <SettingsSection
              id="conversion"
              title="Convert to the flow editor"
              description="Review the server's conversion proposal before changing this draft."
            >
              <label className="grid max-w-xs gap-2 text-xs">
                Legacy schedule timezone
                <Input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
              <Button
                variant="outline"
                className="w-fit"
                disabled={converting}
                onClick={() => void convert()}
              >
                {converting ? 'Checking conversion…' : 'Review conversion'}
              </Button>
              {conversionError && (
                <p role="alert" className="text-xs text-destructive">
                  {conversionError}
                </p>
              )}
              {conversion && (
                <>
                  <p className="text-sm font-medium">
                    {conversion.status === 'converted'
                      ? 'Conversion available'
                      : 'This routine needs manual conversion'}
                  </p>
                  {[
                    ...(conversion.notes ?? []),
                    ...(conversion.reasons ?? []),
                  ].map((note, index) => (
                    <p className="text-xs text-muted-foreground" key={index}>
                      {note}
                    </p>
                  ))}
                  {conversion.definition && (
                    <>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                        {JSON.stringify(conversion.definition, null, 2)}
                      </pre>
                      <Button
                        className="w-fit"
                        disabled={
                          stringifyConfig(conversion.input) !==
                          stringifyConfig(routine)
                        }
                        onClick={() =>
                          draft.patch({
                            semantics_version: 2,
                            definition_v2: conversion.definition,
                          })
                        }
                      >
                        Use converted draft
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Review the resulting flow, then Save changes. Discard
                        restores the original routine.
                      </p>
                      {stringifyConfig(conversion.input) !==
                        stringifyConfig(routine) && (
                        <p className="text-xs text-amber-700">
                          The draft changed. Review conversion again.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </SettingsSection>
          )}
          {version === 2 && showPreview && (
            <SettingsSection
              id="preview"
              title="Draft preview"
              description="Assume a starting event and inspect the resulting plan."
            >
              <RoutineWhatIfPreview definition={definition} devices={devices} />
            </SettingsSection>
          )}
          {!creating && (
            <SettingsSection
              id="activity"
              title="Recent activity"
              description="Activity belongs to the saved routine."
              actions={
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to={`/config/routine-history?routine=${encodeURIComponent(id!)}`}
                  >
                    All activity
                  </Link>
                </Button>
              }
            >
              {status?.v2 && (
                <p className="text-sm">{routineStatusSummary(status.v2)}</p>
              )}
              {history.error ? (
                <p className="text-xs text-destructive">{history.error}</p>
              ) : !recent.length ? (
                <p className="text-xs text-muted-foreground">
                  {history.loading
                    ? 'Loading activity…'
                    : status?.v2?.last_run
                      ? 'Earlier runs are no longer in the activity log.'
                      : 'No recorded activity yet.'}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap justify-between gap-2 py-2 text-xs"
                    >
                      <span>
                        {activityOutcome(entry)} · {activitySummary(entry)}
                      </span>
                      <time
                        dateTime={entry.timestamp}
                        className="text-muted-foreground"
                      >
                        {new Date(entry.timestamp).toLocaleString()}
                      </time>
                    </div>
                  ))}
                </div>
              )}
              {advanced && saved && (
                <RoutineRuntimePanel
                  embedded
                  routine={saved}
                  status={status}
                  timers={timers ?? []}
                  devices={devices}
                  deviceDisplayNameMap={{}}
                />
              )}
            </SettingsSection>
          )}
          {(advanced || !editable) && (
            <details className="rounded-md border border-border p-3 text-xs">
              <summary className="cursor-pointer">Stored definition</summary>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(routine, null, 2)}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={download}
              >
                <Download className="size-4" />
                Download draft
              </Button>
            </details>
          )}
          {editable && (
            <EntitySaveBar
              draft={draft}
              createLabel={creating ? 'Create routine' : undefined}
            />
          )}
        </RoutineAuthoringContext.Provider>
      )}
    </DetailPageShell>
  );
}
