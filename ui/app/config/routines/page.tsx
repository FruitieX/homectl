import {
  useDeviceDisplayNames,
  useHelpers,
  useRoutines,
  useScenes,
  Routine,
  RoutineDefinitionV2Body,
} from '@/hooks/useConfig';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { NativeAction } from '@/bindings/NativeAction';
import type { Program } from '@/bindings/Program';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { TimerRuntimeStatus } from '@/bindings/TimerRuntimeStatus';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import { matchesConfigSearch } from '@/lib/configSearch';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCreateDeepLink, useSearchParamState } from '@/hooks/useDeepLink';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import {
  useDevicesState,
  useRoutineStatuses,
  useTimers,
} from '@/hooks/websocket';
import { ConfigTabs } from '@/ui/ConfigTabs';
import { Button as UiButton } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import { EmptyState } from '@/ui/primitives/empty-state';
import { ConfigPageHeader } from '../page-header';
import { RuleBuilder, Rule } from '@/ui/RuleBuilder';
import { ActionBuilder, Action, validateActions } from '@/ui/ActionBuilder';
import { TriggerBuilder } from '@/ui/TriggerBuilder';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { ProgramBuilder } from '@/ui/ProgramBuilder';
import { RoutineExecutionPolicyEditor } from '@/ui/RoutineExecutionPolicyEditor';
import { RoutineRuntimePanel } from '@/ui/routine-runtime';
import { V2RoutineSummary } from '@/ui/v2-routine-summary';
import { RoutineWhatIfPreview } from '@/ui/RoutineWhatIfPreview';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigToggleRow,
} from '@/ui/config-form';
import { RoutineActionList, RoutineRuleList } from '@/ui/routine-summary';
import { toast } from 'sonner';

import { Advanced } from '@/ui/primitives/advanced';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import type { AssistantDraft } from '@/hooks/useAssistant';
import { AssistantDraftPanel } from './assistant-draft-panel';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';
import { checkboxClassName } from '@/ui/form-styles';

const statusBadgeClassName = {
  success:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
  warning:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

const getRoutineSearchValues = (routine: Routine) => [
  routine.id,
  routine.name,
  routine.enabled ? 'enabled' : 'disabled',
  routine.rules,
  routine.actions,
];

export default function RoutinesPage() {
  const {
    data: routines,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
  } = useRoutines();
  const { data: scenes, loading: scenesLoading } = useScenes();
  const { data: helpers } = useHelpers();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useSearchParamState();
  const [showCreate, setShowCreate] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useCreateDeepLink(useCallback(() => setShowCreate(true), []));

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const bulkSetEnabled = useCallback(
    async (enabled: boolean) => {
      const ids = [...selectedIds];
      for (const id of ids) {
        await update(id, { enabled });
      }
      setSelectedIds(new Set());
    },
    [selectedIds, update],
  );

  const bulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (
      !(await confirmDestructive(
        ids.length === 1
          ? 'Delete 1 routine?'
          : `Delete ${ids.length} routines?`,
        'Their triggers, conditions, and programs are removed. v1 fallback rules are deleted with them.',
      ))
    ) {
      return;
    }
    for (const id of ids) {
      await remove(id);
    }
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [remove, selectedIds]);
  const { devicesState: apiDevices } = useDevicesApi();
  const liveDevices = useDevicesState();
  // Merge live websocket device state over the REST snapshot so editors (for
  // example the raw JSON rule preview) see up-to-date `device.raw` payloads as
  // integrations push updates.
  const devices = useMemo<DevicesState>(() => {
    const merged: DevicesState = { ...apiDevices };
    for (const [key, device] of Object.entries(liveDevices ?? {})) {
      if (device) {
        merged[key] = device;
      }
    }
    return merged;
  }, [apiDevices, liveDevices]);
  const routineStatuses = useRoutineStatuses();
  const timers = useTimers() ?? [];
  const groups = useGroupsState();
  const deviceDisplayNameMap = deviceDisplayNames.reduce<
    Record<string, string>
  >((names, row) => {
    names[row.device_key] = row.display_name;
    return names;
  }, {});

  const sceneList = scenes.map((s) => ({ id: s.id, name: s.name }));
  const routineList = routines.map((r) => ({ id: r.id, name: r.name }));
  const visibleRoutines = routines.filter((routine) =>
    matchesConfigSearch(search, ...getRoutineSearchValues(routine)),
  );
  const openRoutine = routines.find((routine) => routine.id === openId) ?? null;
  useAssistantPageContext(
    openRoutine
      ? { kind: 'routine', id: openRoutine.id, label: openRoutine.name }
      : { kind: 'routine' },
  );

  if (loading || scenesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>Could not load routines: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Routines"
        description="Automate what happens when a sensor, schedule, or other trigger changes."
        actions={
          <>
            <UiButton
              variant="outline"
              onClick={() => {
                setSelectMode((current) => !current);
                setSelectedIds(new Set());
              }}
            >
              {selectMode ? 'Done selecting' : 'Select'}
            </UiButton>
            <Button onClick={() => setShowCreate(true)}>Add Routine</Button>
          </>
        }
      />

      <ConfigTabs
        tabs={[
          { label: 'Routines', to: '/config/routines', active: true },
          { label: 'Activity', to: '/config/routine-history' },
        ]}
      />

      <ConfigListSearchBar
        filteredCount={visibleRoutines.length}
        onChange={setSearch}
        placeholder="Search routines"
        totalCount={routines.length}
        value={search}
      />

      {visibleRoutines.length === 0 ? (
        <EmptyState
          title={
            routines.length === 0 ? 'No routines yet' : 'No matching routines'
          }
          description={
            routines.length === 0
              ? 'Routines react to device reports, helpers, and schedules. Start from a template or a blank trigger.'
              : 'Try a different search term or clear the search to see all routines.'
          }
          action={
            routines.length === 0 ? (
              <Button onClick={() => setShowCreate(true)}>
                Add your first routine
              </Button>
            ) : (
              <UiButton variant="outline" onClick={() => setSearch('')}>
                Clear search
              </UiButton>
            )
          }
        />
      ) : (
        <div className="grid gap-4">
          {visibleRoutines.map((routine) => (
            <div
              key={routine.id}
              className={
                openId && openId !== routine.id
                  ? 'hidden items-start gap-2 md:flex'
                  : 'flex items-start gap-2'
              }
            >
              {selectMode ? (
                <Checkbox
                  checked={selectedIds.has(routine.id)}
                  onCheckedChange={() => toggleSelected(routine.id)}
                  aria-label={`Select ${routine.name}`}
                  className="mt-4"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <RoutineCard
                  routine={routine}
                  isOpen={openId === routine.id}
                  devices={devices}
                  groups={groups}
                  scenes={sceneList}
                  routines={routineList}
                  helpers={helpers}
                  runtimeStatus={routineStatuses?.[routine.id]}
                  timers={timers}
                  deviceDisplayNameMap={deviceDisplayNameMap}
                  onOpen={() => setOpenId(routine.id)}
                  onClose={() => {
                    setOpenId((current) =>
                      current === routine.id ? null : current,
                    );
                  }}
                  onSave={async (updated) => {
                    await update(routine.id, updated);
                    setOpenId(null);
                  }}
                  onDelete={async () => {
                    if (
                      await confirmDestructive(
                        `Delete routine "${routine.name}"?`,
                        'Its triggers, conditions, and program are removed. The v1 fallback rules are deleted with it.',
                      )
                    ) {
                      await remove(routine.id);
                      setOpenId((current) =>
                        current === routine.id ? null : current,
                      );
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectMode && selectedIds.size > 0 ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-popover/95 p-2 shadow-lg backdrop-blur">
          <span className="px-2 text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <UiButton
            size="sm"
            variant="outline"
            onClick={() => void bulkSetEnabled(true)}
          >
            Enable
          </UiButton>
          <UiButton
            size="sm"
            variant="outline"
            onClick={() => void bulkSetEnabled(false)}
          >
            Disable
          </UiButton>
          <UiButton
            size="sm"
            variant="destructive"
            onClick={() => void bulkDelete()}
          >
            Delete
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </UiButton>
        </div>
      ) : null}

      {showCreate && (
        <CreateRoutineModal
          devices={devices}
          groups={groups}
          scenes={sceneList}
          routines={routines}
          helpers={helpers}
          onClose={() => setShowCreate(false)}
          onCreate={async (routine) => {
            await create(routine);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function RoutineCard({
  routine,
  isOpen,
  devices,
  groups,
  scenes,
  routines,
  helpers,
  runtimeStatus,
  timers,
  deviceDisplayNameMap,
  onOpen,
  onClose,
  onSave,
  onDelete,
}: {
  routine: Routine;
  isOpen: boolean;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  helpers: HelperRuntimeStatus[];
  runtimeStatus?: RoutineRuntimeStatus;
  timers: TimerRuntimeStatus[];
  deviceDisplayNameMap: Record<string, string>;
  onOpen: () => void;
  onClose: () => void;
  onSave: (routine: Partial<Routine>) => Promise<void>;
  onDelete: () => void;
}) {
  const isV2 =
    routine.semantics_version === 2 || Boolean(routine.definition_v2);
  const [id, setId] = useState(routine.id);
  const [name, setName] = useState(routine.name);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [rules, setRules] = useState<Rule[]>(routine.rules as Rule[]);
  const [actions, setActions] = useState<Action[]>(routine.actions as Action[]);
  const [editTab, setEditTab] = useState<'overview' | 'basics' | 'json'>(
    'overview',
  );
  const [rulesJson, setRulesJson] = useState(
    JSON.stringify(routine.rules, null, 2),
  );
  const [actionsJson, setActionsJson] = useState(
    JSON.stringify(routine.actions, null, 2),
  );
  const [definition, setDefinition] = useState<RoutineDefinitionV2Body>(
    routine.definition_v2 ?? {},
  );
  const [definitionJson, setDefinitionJson] = useState(
    JSON.stringify(routine.definition_v2 ?? {}, null, 2),
  );
  const wasOpenRef = useRef(false);
  const whenRef = useRef<HTMLDetailsElement>(null);
  const ifRef = useRef<HTMLDetailsElement>(null);
  const thenRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) {
      return;
    }

    setId(routine.id);
    setName(routine.name);
    setEnabled(routine.enabled);
    setRules(routine.rules as Rule[]);
    setActions(routine.actions as Action[]);
    setRulesJson(JSON.stringify(routine.rules, null, 2));
    setActionsJson(JSON.stringify(routine.actions, null, 2));
    setDefinition(routine.definition_v2 ?? {});
    setDefinitionJson(JSON.stringify(routine.definition_v2 ?? {}, null, 2));
    setEditTab('overview');
  }, [isOpen, routine]);

  const routineStatusBadge = (() => {
    if (!routine.enabled) {
      return null;
    }

    if (!runtimeStatus) {
      return { label: 'No live state', className: statusBadgeClassName.muted };
    }

    if (runtimeStatus.will_trigger) {
      return { label: 'Triggering', className: statusBadgeClassName.success };
    }

    if (runtimeStatus.all_conditions_match) {
      return {
        label: 'Conditions met',
        className: statusBadgeClassName.warning,
      };
    }

    return { label: 'Waiting', className: statusBadgeClassName.muted };
  })();
  const matchingRuleCount = runtimeStatus?.rules.filter(
    (status) => status.condition_match,
  ).length;
  const v2Status = runtimeStatus?.v2;
  const draftProgram = definition.program as Program | undefined;
  const draftChanged =
    isV2 &&
    JSON.stringify(definition) !== JSON.stringify(routine.definition_v2 ?? {});
  const triggerCount =
    v2Status?.triggers.length ?? routine.definition_v2?.triggers?.length ?? 0;
  const armedTriggerCount =
    v2Status?.triggers.filter((trigger) => trigger.armed).length ?? 0;

  const changeTab = (value: string) => {
    if (value === 'json') {
      if (isV2) {
        setDefinitionJson(JSON.stringify(definition, null, 2));
      } else {
        setRulesJson(JSON.stringify(rules, null, 2));
        setActionsJson(JSON.stringify(actions, null, 2));
      }
      setEditTab('json');
      return;
    }

    if (editTab === 'json') {
      try {
        if (isV2) {
          setDefinition(JSON.parse(definitionJson));
        } else {
          setRules(JSON.parse(rulesJson));
          setActions(JSON.parse(actionsJson));
        }
      } catch {
        toast.error('Invalid JSON - fix before leaving the JSON tab');
        return;
      }
    }

    if (value === 'overview' || value === 'basics') {
      setEditTab(value);
    }
  };

  const summary = (
    <div className="space-y-3 pr-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight">
            {routine.name}
          </h2>
          <div className="text-sm text-muted-foreground">{routine.id}</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          <Badge
            className={
              routine.enabled
                ? statusBadgeClassName.success
                : statusBadgeClassName.error
            }
          >
            {routine.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {isV2 ? (
            <Badge variant="outline">v2</Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-600 dark:text-amber-400"
            >
              Legacy v1
            </Badge>
          )}
          {routineStatusBadge ? (
            <Badge className={routineStatusBadge.className}>
              {routineStatusBadge.label}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="text-sm">
        {isV2 ? (
          <>
            <span className="font-medium">{triggerCount}</span> triggers ·{' '}
            <span className="font-medium">{armedTriggerCount}</span> armed
            {routine.enabled && v2Status ? (
              <>
                {' '}
                · condition{' '}
                <span className="font-medium">
                  {v2Status.condition.truth === 'true'
                    ? 'met'
                    : v2Status.condition.truth === 'false'
                      ? 'not met'
                      : 'unknown'}
                </span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-medium">{routine.rules.length}</span> rules ·{' '}
            <span className="font-medium">{routine.actions.length}</span>{' '}
            actions
            {routine.enabled && matchingRuleCount !== undefined ? (
              <>
                {' '}
                · <span className="font-medium">{matchingRuleCount}</span>{' '}
                matching now
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  const editContent = (
    <div className="flex min-h-full flex-col">
      <Tabs value={editTab} onValueChange={changeTab}>
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger value="overview">Build & preview</TabsTrigger>
          <TabsTrigger value="basics">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {draftChanged
              ? 'You are editing an unsaved draft. Preview it below; live status reflects the saved routine.'
              : !routine.enabled
                ? 'Disabled: this routine does not evaluate or trigger.'
                : isV2
                  ? !v2Status
                    ? 'Waiting for runtime status.'
                    : v2Status.condition.error
                      ? 'The condition could not be evaluated. See the trigger details below.'
                      : v2Status.will_trigger
                        ? 'The condition and a triggering event matched. This status does not confirm physical device delivery.'
                        : v2Status.condition.truth === 'true'
                          ? 'The condition is met; waiting for a matching trigger event.'
                          : v2Status.condition.truth === 'false'
                            ? 'The condition is not met; the routine will not trigger yet.'
                            : 'The condition is unknown right now. See the trigger details below.'
                  : !runtimeStatus
                    ? 'Waiting for runtime status.'
                    : runtimeStatus.rules.some((rule) => rule.error)
                      ? 'A rule could not be evaluated. See its error below.'
                      : runtimeStatus.will_trigger
                        ? 'The conditions and triggering event matched. This status does not confirm physical device delivery.'
                        : runtimeStatus.all_conditions_match
                          ? 'The conditions match; waiting for a matching trigger event.'
                          : `${matchingRuleCount ?? 0} of ${runtimeStatus.rules.length} conditions match. Unmatched rules are shown below.`}
          </p>
          {isV2 ? (
            <V2RoutineSummary
              routine={{ ...routine, definition_v2: definition }}
              status={draftChanged ? undefined : runtimeStatus}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              deviceDisplayNameMap={deviceDisplayNameMap}
              onEdit={(section) => {
                const target =
                  section === 'when'
                    ? whenRef.current
                    : section === 'if'
                      ? ifRef.current
                      : thenRef.current;
                if (target) {
                  target.open = true;
                  // `start` scrolls the page as well, which drags the visual
                  // viewport out from under a phone keyboard; `nearest` only
                  // moves the container when the card is actually out of view.
                  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
              }}
            />
          ) : null}
          {isV2 ? (
            <RoutineWhatIfPreview definition={definition} devices={devices} />
          ) : null}
          {draftChanged && (
            <p className="text-xs text-muted-foreground">
              This draft differs from the saved routine. Live status below
              reflects the saved version.
            </p>
          )}
          {isV2 && (
            <details className="rounded-2xl border border-border bg-muted/20 p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Live trigger and timer details
              </summary>
              <div className="mt-4">
                <RoutineRuntimePanel
                  routine={routine}
                  status={runtimeStatus}
                  timers={timers}
                  devices={devices}
                  deviceDisplayNameMap={deviceDisplayNameMap}
                />
              </div>
            </details>
          )}
          {isV2 ? (
            <div className="space-y-3">
              <details
                ref={whenRef}
                className="rounded-2xl border border-border bg-background/70 p-4"
              >
                <summary className="cursor-pointer font-semibold">
                  When · {definition.triggers?.length ?? 0} triggers
                </summary>
                <div className="mt-4">
                  <TriggerBuilder
                    triggers={definition.triggers ?? []}
                    onChange={(triggers: TriggerSpec[]) =>
                      setDefinition((current) => ({ ...current, triggers }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                    runtimeStatus={draftChanged ? undefined : runtimeStatus}
                  />
                </div>
              </details>
              <details
                ref={ifRef}
                className="rounded-2xl border border-border bg-background/70 p-4"
              >
                <summary className="cursor-pointer font-semibold">
                  If ·{' '}
                  {!draftChanged && v2Status?.condition.truth === 'true'
                    ? 'met now'
                    : !draftChanged && v2Status?.condition.truth === 'false'
                      ? 'not met now'
                      : 'check conditions'}
                </summary>
                <div className="mt-4">
                  <ConditionEditor
                    condition={
                      (definition.condition as ConditionExpr | undefined) ?? {
                        kind: 'literal',
                        value: true,
                      }
                    }
                    onChange={(condition) =>
                      setDefinition((current) => ({ ...current, condition }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                  />
                </div>
              </details>
              <details
                ref={thenRef}
                className="rounded-2xl border border-border bg-background/70 p-4"
              >
                <summary className="cursor-pointer font-semibold">
                  Then ·{' '}
                  {draftProgram?.kind === 'native'
                    ? `${draftProgram.steps.length} steps`
                    : draftProgram?.kind === 'script'
                      ? 'script'
                      : 'not configured'}
                </summary>
                <div className="mt-4 space-y-4">
                  <ProgramBuilder
                    program={definition.program as Program | undefined}
                    onChange={(program) =>
                      setDefinition((current) => ({ ...current, program }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    routines={routines}
                    helpers={helpers}
                  />
                  <Advanced
                    label="Execution policy"
                    description="Control overlapping runs, action budget, and rate limits."
                  >
                    <RoutineExecutionPolicyEditor
                      policy={
                        definition.execution as ExecutionPolicy | undefined
                      }
                      onChange={(execution) =>
                        setDefinition((current) => ({ ...current, execution }))
                      }
                    />
                  </Advanced>
                </div>
              </details>
            </div>
          ) : (
            <div className="space-y-3">
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  When and if · {rules.length} rules
                </summary>
                <div className="mt-4">
                  <RuleBuilder
                    rules={rules}
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    onChange={setRules}
                  />
                </div>
              </details>
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  Then · {actions.length} actions
                </summary>
                <div className="mt-4">
                  <ActionBuilder
                    actions={actions}
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    routines={routines}
                    onChange={setActions}
                  />
                </div>
              </details>
            </div>
          )}
          <Advanced
            label="Advanced editor"
            description="Edit the raw definition when the visual editor does not cover a specific case."
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => changeTab('json')}
            >
              Open JSON editor
            </Button>
          </Advanced>
          <div className="flex justify-end">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/config/routine-history?q=${encodeURIComponent(routine.id)}`}
              >
                See recent activity for this routine
              </Link>
            </Button>
          </div>
          {!isV2 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <RoutineRuleList
                rules={routine.rules as Rule[]}
                status={runtimeStatus}
                devices={devices}
                groups={groups}
                scenes={scenes}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
              <RoutineActionList
                actions={routine.actions as Action[]}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="basics" className="mt-4">
          <ConfigFormSection
            title="Routine identity"
            description="The id is used by routine actions and logs; keep it stable after creation."
          >
            <ConfigField label="Routine ID" className="w-full max-w-md">
              <Input
                type="text"
                className="font-mono"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </ConfigField>

            <ConfigField label="Name">
              <Input
                type="text"
                className="w-full text-lg font-bold"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </ConfigField>

            <ConfigToggleRow
              label="Enabled"
              description="Disabled routines remain saved but do not evaluate or trigger."
            >
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </ConfigToggleRow>
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="json" className="mt-4">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mb-3"
            onClick={() => changeTab('overview')}
          >
            Back to overview
          </Button>
          <ConfigFormSection
            title="Advanced JSON"
            description={
              isV2
                ? 'Edit the raw native definition when the visual editor does not expose an edge case (conditions, script programs, choose branches, advanced predicates).'
                : 'Edit the raw routine payload when a visual editor does not expose an edge case.'
            }
          >
            {isV2 ? (
              <ConfigField label="Definition (JSON)">
                <Textarea
                  className="h-96 font-mono text-xs"
                  value={definitionJson}
                  onChange={(e) => setDefinitionJson(e.target.value)}
                  placeholder='{"triggers": [...], "program": {...}}'
                />
              </ConfigField>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <ConfigField label="Rules (JSON)">
                  <Textarea
                    className="h-64 font-mono text-xs"
                    value={rulesJson}
                    onChange={(e) => setRulesJson(e.target.value)}
                    placeholder='[{"Sensor": {"device_ref": {...}, "state": {...}}}]'
                  />
                </ConfigField>

                <ConfigField label="Actions (JSON)">
                  <Textarea
                    className="h-64 font-mono text-xs"
                    value={actionsJson}
                    onChange={(e) => setActionsJson(e.target.value)}
                    placeholder='[{"ActivateScene": {"scene_id": "..."}]'
                  />
                </ConfigField>
              </div>
            )}
          </ConfigFormSection>
        </TabsContent>
      </Tabs>

      <ConfigFormActions>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!id.trim() || !name.trim()}
          onClick={async () => {
            const saveFromJson = editTab === 'json';

            if (isV2) {
              let finalDefinition: RoutineDefinitionV2Body;
              try {
                finalDefinition = saveFromJson
                  ? JSON.parse(definitionJson)
                  : definition;
              } catch {
                toast.error('Invalid JSON in the native definition');
                return;
              }

              try {
                await onSave({
                  id,
                  name,
                  enabled,
                  semantics_version: 2,
                  definition_v2: finalDefinition,
                  rules: routine.rules,
                  actions: routine.actions,
                });
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : 'Failed to save routine',
                );
              }
              return;
            }

            let finalRules: Rule[] | unknown[];
            let finalActions: Action[] | unknown[];

            try {
              finalRules = saveFromJson ? JSON.parse(rulesJson) : rules;
              finalActions = saveFromJson ? JSON.parse(actionsJson) : actions;
            } catch {
              toast.error('Invalid JSON in rules or actions');
              return;
            }

            if (Array.isArray(finalActions)) {
              const rolloutValidationError = validateActions(
                finalActions as Action[],
              );
              if (rolloutValidationError) {
                toast.error(rolloutValidationError);
                return;
              }
            }

            try {
              await onSave({
                id,
                name,
                enabled,
                rules: finalRules,
                actions: finalActions,
              });
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : 'Failed to save routine',
              );
            }
          }}
        >
          Save
        </Button>
      </ConfigFormActions>
    </div>
  );

  return (
    <ExpandableConfigCard
      open={isOpen}
      onOpen={onOpen}
      onClose={onClose}
      summary={summary}
      dialogTitle={routine.name}
      dialogSubtitle={routine.id}
    >
      {editContent}
    </ExpandableConfigCard>
  );
}

type V2DraftKind = 'blank' | 'sensor' | 'motion' | 'occupancy' | 'schedule';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function v2Draft(kind: V2DraftKind): RoutineDefinitionV2Body {
  const trigger: TriggerSpec =
    kind === 'sensor'
      ? {
          kind: 'state_change',
          id: 'state_change_1',
          device: { integration_id: '', device_id: '' },
          mode: 'transition',
        }
      : kind === 'motion'
        ? {
            kind: 'report',
            id: 'report_1',
            device: { integration_id: '', device_id: '' },
          }
        : kind === 'occupancy'
          ? {
              kind: 'state_change',
              id: 'state_change_1',
              device: { integration_id: '', device_id: '' },
              mode: 'level',
            }
          : kind === 'schedule'
            ? {
                kind: 'schedule',
                id: 'schedule_1',
                schedule: {
                  cron: '0 0 8 * * *',
                  timezone: 'Europe/Helsinki',
                  backlog: 'skip',
                },
              }
            : { kind: 'manual', id: 'manual_1' };

  const condition: ConditionExpr =
    kind === 'motion' || kind === 'occupancy'
      ? {
          kind: 'comparison',
          source: {
            kind: 'device',
            device: { integration_id: '', device_id: '' },
            path: '/value',
          },
          operator: 'eq',
          value: true,
        }
      : { kind: 'literal', value: true };

  return {
    triggers: [trigger],
    condition,
    program: {
      kind: 'native',
      steps: [
        {
          action: 'activate_scene',
          id: 'activate_scene_1',
          scene_id: '',
          targets: {},
        } as unknown as NativeAction,
      ],
    },
  };
}

function walkNativeSteps(steps: NativeAction[]): NativeAction[] {
  const all: NativeAction[] = [];
  for (const step of steps) {
    all.push(step);
    if (step.action === 'choose') {
      for (const branch of step.branches) {
        all.push(...walkNativeSteps(branch.steps));
      }
    }
  }
  return all;
}

function hasEmptyConditionGroup(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') {
    return false;
  }
  const expr = condition as ConditionExpr;
  switch (expr.kind) {
    case 'all':
    case 'any':
      return (
        expr.conditions.length === 0 ||
        expr.conditions.some((child) => hasEmptyConditionGroup(child))
      );
    case 'not':
      return hasEmptyConditionGroup(expr.condition);
    default:
      return false;
  }
}

function validateV2Draft(definition: RoutineDefinitionV2Body): string | null {
  if ((definition.triggers ?? []).length === 0) {
    return 'Add at least one trigger.';
  }

  const program = definition.program as Program | undefined;
  if (!program) {
    return 'Add a native or script program.';
  }
  if (program.kind === 'native') {
    if (program.steps.length === 0) {
      return 'Add at least one program step.';
    }
    const steps = walkNativeSteps(program.steps);
    const missingScene = steps.some(
      (step) =>
        step.action === 'activate_scene' && !step.select && !step.scene_id,
    );
    if (missingScene) {
      return 'Choose a scene for each scene activation.';
    }
    const missingCycleScene = steps.some(
      (step) =>
        step.action === 'cycle_scenes' &&
        (step.scenes.length === 0 ||
          step.scenes.some((entry) => !entry.scene_id)),
    );
    if (missingCycleScene) {
      return 'Add at least one scene to each scene cycle.';
    }
  } else if (!program.spec.source_body.trim()) {
    return 'Add a script body.';
  }

  if (hasEmptyConditionGroup(definition.condition)) {
    return 'Add at least one child to each all/any condition.';
  }

  const execution = definition.execution as ExecutionPolicy | undefined;
  if (execution) {
    if (
      !Number.isInteger(execution.max_actions) ||
      execution.max_actions < 1 ||
      execution.max_actions > 64
    ) {
      return 'Max actions must be between 1 and 64.';
    }
    const minIntervalMs =
      execution.min_interval_ms === undefined
        ? undefined
        : Number(execution.min_interval_ms);
    if (
      minIntervalMs !== undefined &&
      (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0)
    ) {
      return 'Minimum spacing must be a positive duration.';
    }
  }

  return null;
}

function CreateRoutineModal({
  onClose,
  onCreate,
  devices,
  groups,
  scenes,
  routines,
  helpers,
}: {
  onClose: () => void;
  onCreate: (routine: Partial<Routine>) => Promise<void>;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: Routine[];
  helpers: HelperRuntimeStatus[];
}) {
  const [semantics, setSemantics] = useState<1 | 2>(2);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [definition, setDefinition] = useState<RoutineDefinitionV2Body>(() =>
    v2Draft('blank'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [startFrom, setStartFrom] = useState('blank');

  const applyAssistantDraft = (draft: AssistantDraft) => {
    setDefinition(draft.definition);
    setPreview(false);
    setError(null);
    if (!name.trim() && draft.name) {
      setName(draft.name);
      if (!id.trim()) {
        const slug = slugify(draft.name);
        if (slug) {
          setId(slug);
        }
      }
    }
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Routine"
      description="Create a new automation routine."
      presentation="page"
      className="max-w-4xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <ConfigFormSection
          title="Routine identity"
          description={
            semantics === 2
              ? 'Pick a starting point, then edit triggers, condition, and program before saving.'
              : 'Choose a starting point, edit its rules and actions, then review before saving.'
          }
        >
          <ConfigField
            label="Routine type"
            description="Native v2 routines use triggers, a condition, and a program. Legacy v1 routines use rules and actions."
          >
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={semantics}
              onChange={(event) => {
                const next = Number(event.target.value) as 1 | 2;
                setSemantics(next);
                setPreview(false);
                setStartFrom('blank');
                if (next === 2) {
                  setDefinition(v2Draft('blank'));
                } else {
                  setRules([]);
                  setActions([]);
                }
              }}
            >
              <option value={2}>Native v2 (recommended)</option>
              <option value={1}>Legacy v1 (rules and actions)</option>
            </select>
          </ConfigField>
          <ConfigField label="Start from">
            <SearchablePicker
              value={startFrom}
              options={
                semantics === 2
                  ? [
                      {
                        value: 'blank',
                        label: 'Blank routine (manual trigger)',
                      },
                      {
                        value: 'sensor',
                        label: 'Device change activates a scene',
                      },
                      {
                        value: 'motion',
                        label: 'Motion report activates a scene',
                      },
                      { value: 'occupancy', label: 'Occupancy holds a scene' },
                      {
                        value: 'schedule',
                        label: 'Schedule activates a scene',
                      },
                      ...routines
                        .filter(
                          (routine) =>
                            routine.semantics_version === 2 ||
                            Boolean(routine.definition_v2),
                        )
                        .map((routine) => ({
                          value: `copy:${routine.id}`,
                          label: routine.name,
                          detail: `Copy routine · ${routine.id}`,
                        })),
                    ]
                  : [
                      { value: 'blank', label: 'Blank routine' },
                      { value: 'sensor', label: 'Sensor activates a scene' },
                      ...routines
                        .filter(
                          (routine) =>
                            routine.semantics_version !== 2 &&
                            !routine.definition_v2,
                        )
                        .map((routine) => ({
                          value: `copy:${routine.id}`,
                          label: routine.name,
                          detail: `Copy routine · ${routine.id}`,
                        })),
                    ]
              }
              onChange={(value) => {
                setPreview(false);
                setStartFrom(value);
                if (semantics === 2) {
                  if (
                    value === 'blank' ||
                    value === 'sensor' ||
                    value === 'motion' ||
                    value === 'occupancy' ||
                    value === 'schedule'
                  ) {
                    setDefinition(v2Draft(value));
                    return;
                  }
                  const source = routines.find(
                    (routine) => routine.id === value.slice(5),
                  );
                  if (source?.definition_v2) {
                    setDefinition(structuredClone(source.definition_v2));
                  }
                  return;
                }
                if (value === 'blank') {
                  setRules([]);
                  setActions([]);
                  return;
                }
                if (value === 'sensor') {
                  setRules([{ state: { value: true }, trigger_mode: 'pulse' }]);
                  setActions([{ action: 'ActivateScene', scene_id: '' }]);
                  return;
                }
                const source = routines.find(
                  (routine) => routine.id === value.slice(5),
                );
                if (source) {
                  setRules(structuredClone(source.rules) as Rule[]);
                  setActions(structuredClone(source.actions) as Action[]);
                }
              }}
            />
          </ConfigField>
          <ConfigField label="Routine ID">
            <Input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="motion-lights"
            />
          </ConfigField>

          <ConfigField label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Motion Activated Lights"
            />
          </ConfigField>

          <ConfigToggleRow label="Enabled">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </ConfigToggleRow>
        </ConfigFormSection>

        {semantics === 2 ? (
          <div className="mt-4 space-y-4">
            <AssistantDraftPanel onDraft={applyAssistantDraft} />
            <RoutineWhatIfPreview definition={definition} devices={devices} />
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          {semantics === 2 ? (
            <div className="space-y-3">
              <details
                open
                className="rounded-2xl border border-border bg-background/70 p-4"
              >
                <summary className="cursor-pointer font-semibold">
                  When · {definition.triggers?.length ?? 0} triggers
                </summary>
                <div className="mt-4">
                  <TriggerBuilder
                    triggers={definition.triggers ?? []}
                    onChange={(triggers: TriggerSpec[]) =>
                      setDefinition((current) => ({ ...current, triggers }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                  />
                </div>
              </details>
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  If · condition
                </summary>
                <div className="mt-4">
                  <ConditionEditor
                    condition={
                      (definition.condition as ConditionExpr | undefined) ?? {
                        kind: 'literal',
                        value: true,
                      }
                    }
                    onChange={(condition) =>
                      setDefinition((current) => ({ ...current, condition }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                  />
                </div>
              </details>
              <details className="rounded-2xl border border-border bg-background/70 p-4">
                <summary className="cursor-pointer font-semibold">
                  Then · actions in order
                </summary>
                <div className="mt-4">
                  <ProgramBuilder
                    program={definition.program as Program | undefined}
                    onChange={(program) =>
                      setDefinition((current) => ({ ...current, program }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    routines={routines}
                    helpers={helpers}
                  />
                </div>
              </details>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'This routine will be enabled when saved.'
                  : 'This routine will be saved disabled.'}
              </p>
            </div>
          ) : preview ? (
            <>
              <RoutineRuleList
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                deviceDisplayNameMap={{}}
              />
              <RoutineActionList
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                deviceDisplayNameMap={{}}
              />
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'This routine will be enabled when saved.'
                  : 'This routine will be saved disabled.'}
              </p>
            </>
          ) : (
            <>
              <RuleBuilder
                rules={rules}
                devices={devices}
                groups={groups}
                scenes={scenes}
                onChange={setRules}
              />
              <ActionBuilder
                actions={actions}
                devices={devices}
                groups={groups}
                scenes={scenes}
                routines={routines}
                onChange={setActions}
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {semantics === 1 && (
            <Button variant="outline" onClick={() => setPreview(!preview)}>
              {preview ? 'Edit draft' : 'Preview'}
            </Button>
          )}
          <Button
            disabled={
              !id.trim() ||
              !name.trim() ||
              saving ||
              (semantics === 1 && !preview)
            }
            onClick={async () => {
              if (semantics === 2) {
                const validation = validateV2Draft(definition);
                if (validation) {
                  setError(validation);
                  return;
                }
                setSaving(true);
                setError(null);
                try {
                  await onCreate({
                    id: id.trim(),
                    name: name.trim(),
                    enabled,
                    semantics_version: 2,
                    definition_v2: definition,
                    rules: [],
                    actions: [],
                  });
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'Failed to create routine',
                  );
                } finally {
                  setSaving(false);
                }
                return;
              }

              const validation = validateActions(actions);
              if (validation) {
                setError(validation);
                return;
              }
              if (
                actions.some(
                  (action) =>
                    action.action === 'ActivateScene' &&
                    !action.scene_id.trim(),
                )
              ) {
                setError('Choose a scene for each scene activation.');
                return;
              }
              if (
                rules.some(
                  (rule) =>
                    'state' in rule &&
                    (!rule.integration_id || !rule.device_id),
                )
              ) {
                setError('Choose a device for each sensor rule.');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await onCreate({
                  id: id.trim(),
                  name: name.trim(),
                  enabled,
                  rules,
                  actions,
                });
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Failed to create routine',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
