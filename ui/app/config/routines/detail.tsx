import { useMemo, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';
import type { Program } from '@/bindings/Program';
import type { RoutineDefinitionV2Body } from '@/hooks/useConfig';
import { useDevicesApi, useGroupsState } from '@/hooks/useDevicesApi';
import {
  useDeviceDisplayNames,
  useHelpers,
  useRoutines,
  useScenes,
  type Routine,
} from '@/hooks/useConfig';
import {
  useDevicesState,
  useRoutineStatuses,
  useRoutineStatusesReceivedAt,
  useTimers,
} from '@/hooks/websocket';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { describeExecutionPolicy } from '@/lib/routinePolicy';
import { formatFreshness } from '@/lib/configSection';
import { useDirtyNavigationGuard } from '@/ui/config/useDirtyNavigationGuard';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import {
  ActionBuilder,
  type Action,
  validateActions,
} from '@/ui/ActionBuilder';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { ProgramBuilder } from '@/ui/ProgramBuilder';
import { RuleBuilder, type Rule } from '@/ui/RuleBuilder';
import { TriggerBuilder } from '@/ui/TriggerBuilder';
import { RoutineExecutionPolicyEditor } from '@/ui/RoutineExecutionPolicyEditor';
import { RoutineRuntimePanel } from '@/ui/routine-runtime';
import { RoutineWhatIfPreview } from '@/ui/RoutineWhatIfPreview';
import {
  ConditionReadView,
  ThenReadList,
  WhenReadList,
} from '@/ui/v2-routine-summary';
import { RoutineActionList, RoutineRuleList } from '@/ui/routine-summary';
import { Advanced } from '@/ui/primitives/advanced';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { StatusRegion } from '@/ui/config/StatusRegion';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Switch } from '@/ui/primitives/switch';
import { Textarea } from '@/ui/primitives/textarea';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import type { FieldError } from '@/lib/configSection';

const triggerFields = ['definition_v2.triggers'] as const;
const conditionFields = ['definition_v2.condition'] as const;
const programFields = ['definition_v2.program'] as const;
const policyFields = ['definition_v2.execution'] as const;
const definitionFields = ['definition_v2'] as const;
const detailsFields = ['name', 'enabled'] as const;
const legacyRuleFields = ['rules'] as const;
const legacyActionFields = ['actions'] as const;
const legacyDefinitionFields = ['rules', 'actions'] as const;

const statusBadgeClassName = {
  success:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
  warning:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

export default function RoutineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const {
    data: routines,
    loading,
    error,
    refetch,
    update,
    remove,
  } = useRoutines();
  const { data: scenes } = useScenes();
  const { data: helpers } = useHelpers();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const { devicesState: apiDevices } = useDevicesApi();
  const liveDevices = useDevicesState();
  const routineStatuses = useRoutineStatuses();
  const statusReceivedAt = useRoutineStatusesReceivedAt();
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  // Keep "received N ago" honest while the page stays open.
  useInterval(
    () => setFreshnessNow(Date.now()),
    statusReceivedAt === null ? null : 30_000,
  );
  const timers = useTimers() ?? [];
  const groups = useGroupsState();
  const { activeSection, openSection } = useSectionParams();

  const devices = useMemo<DevicesState>(() => {
    const merged: DevicesState = { ...apiDevices };
    for (const [key, device] of Object.entries(liveDevices ?? {})) {
      if (device) {
        merged[key] = device;
      }
    }
    return merged;
  }, [apiDevices, liveDevices]);
  const deviceDisplayNameMap = useMemo(
    () =>
      deviceDisplayNames.reduce<Record<string, string>>((names, row) => {
        names[row.device_key] = row.display_name;
        return names;
      }, {}),
    [deviceDisplayNames],
  );

  const routine = routines.find((candidate) => candidate.id === id) ?? null;
  const isV2 =
    Boolean(routine) &&
    (routine!.semantics_version === 2 || Boolean(routine!.definition_v2));
  const status = routine ? routineStatuses?.[routine.id] : undefined;
  const v2Status = status?.v2;
  const loadedDefinition = routine?.definition_v2;
  const definition = useMemo(
    () => (loadedDefinition ?? {}) as RoutineDefinitionV2Body,
    [loadedDefinition],
  );
  const program = definition.program as Program | undefined;

  useAssistantPageContext(
    routine
      ? { kind: 'routine', id: routine.id, label: routine.name }
      : { kind: 'routine' },
  );

  const saveRoutine = useMemo(
    () => async (merged: Routine) => {
      if (!routine) return;
      await update(routine.id, merged);
    },
    [routine, update],
  );

  const validateTriggers = (draft: Partial<Routine>) => {
    const errors: FieldError[] = [];
    const next = (draft.definition_v2 ?? {}) as RoutineDefinitionV2Body;
    const triggers = next.triggers ?? [];
    const seen = new Set<string>();
    for (const trigger of triggers) {
      if (!trigger.id) {
        errors.push({
          field: 'triggers',
          message: 'Every trigger needs an id.',
        });
        break;
      }
      if (seen.has(trigger.id)) {
        errors.push({
          field: 'triggers',
          message: `Two triggers share the id “${trigger.id}”.`,
        });
        break;
      }
      seen.add(trigger.id);
    }
    return errors;
  };

  const when = useSectionEditor({
    item: routine,
    fields: triggerFields,
    validate: validateTriggers,
    save: (merged) => saveRoutine(merged),
    ignoreFields: [],
  });
  const onlyIf = useSectionEditor({
    item: routine,
    fields: conditionFields,
    save: (merged) => saveRoutine(merged),
  });
  const then = useSectionEditor({
    item: routine,
    fields: programFields,
    save: (merged) => saveRoutine(merged),
  });
  const advanced = useSectionEditor({
    item: routine,
    fields: policyFields,
    save: (merged) => saveRoutine(merged),
  });
  const technical = useSectionEditor({
    item: routine,
    fields: isV2 ? definitionFields : legacyDefinitionFields,
    save: (merged) => saveRoutine(merged),
  });
  const details = useSectionEditor({
    item: routine,
    fields: detailsFields,
    validate: (draft) =>
      typeof draft.name === 'string' && draft.name.trim().length > 0
        ? []
        : [{ field: 'name', message: 'Give the routine a name.' }],
    save: (merged) => saveRoutine(merged),
  });
  const legacyWhen = useSectionEditor({
    item: routine,
    fields: legacyRuleFields,
    save: (merged) => saveRoutine(merged),
  });
  const legacyThen = useSectionEditor({
    item: routine,
    fields: legacyActionFields,
    validate: (draft) => {
      const message = validateActions((draft.actions ?? []) as Action[]);
      return message ? [{ field: 'actions', message }] : [];
    },
    save: (merged) => saveRoutine(merged),
  });

  const dirty =
    when.dirty ||
    onlyIf.dirty ||
    then.dirty ||
    advanced.dirty ||
    technical.dirty ||
    details.dirty ||
    legacyWhen.dirty ||
    legacyThen.dirty;
  useDirtyNavigationGuard(dirty, {
    description: 'This routine has unsaved section changes.',
  });

  const draftDefinition: RoutineDefinitionV2Body = useMemo(() => {
    if (!when.draft && !onlyIf.draft && !then.draft && !advanced.draft) {
      return definition;
    }
    return {
      ...definition,
      ...((when.draft?.definition_v2 ?? {}) as RoutineDefinitionV2Body),
      ...((onlyIf.draft?.definition_v2 ?? {}) as RoutineDefinitionV2Body),
      ...((then.draft?.definition_v2 ?? {}) as RoutineDefinitionV2Body),
      ...((advanced.draft?.definition_v2 ?? {}) as RoutineDefinitionV2Body),
    };
  }, [advanced.draft, definition, onlyIf.draft, then.draft, when.draft]);
  const previewIsDraft = draftDefinition !== definition;

  if (loading) {
    return (
      <DetailPageShell
        crumbs={[
          { label: 'Settings', to: '/config' },
          { label: 'Routines', to: '/config/routines' },
          { label: id },
        ]}
        backTo="/config/routines"
        backLabel="Back to routines"
        title={id ?? 'Routine'}
        loading
      >
        {null}
      </DetailPageShell>
    );
  }

  if (!routine) {
    return (
      <DetailPageShell
        crumbs={[
          { label: 'Settings', to: '/config' },
          { label: 'Routines', to: '/config/routines' },
          { label: id },
        ]}
        backTo="/config/routines"
        backLabel="Back to routines"
        title={id ?? 'Routine'}
        error={error}
        notFound={!error}
        onRetry={() => void refetch()}
      >
        {null}
      </DetailPageShell>
    );
  }

  const triggers = definition.triggers ?? [];
  const armedCount = v2Status?.triggers.filter((t) => t.armed).length ?? 0;
  const truth = v2Status?.condition.truth;
  const liveStatusBadge = (() => {
    if (!routine.enabled) return null;
    if (!status) {
      return { label: 'No live state', className: statusBadgeClassName.muted };
    }
    if (status.will_trigger) {
      return { label: 'Triggering', className: statusBadgeClassName.success };
    }
    if (status.all_conditions_match) {
      return {
        label: 'Conditions met',
        className: statusBadgeClassName.warning,
      };
    }
    return { label: 'Waiting', className: statusBadgeClassName.muted };
  })();
  const statusSentence = (() => {
    if (!routine.enabled) {
      return 'Disabled: this routine does not evaluate or trigger.';
    }
    if (isV2) {
      if (!v2Status) return 'Waiting for runtime status.';
      if (v2Status.condition.error) {
        return 'The condition could not be evaluated; the error is reported under Only if.';
      }
      if (v2Status.will_trigger) {
        return 'The condition and a triggering event matched. This status does not confirm physical device delivery.';
      }
      if (v2Status.condition.truth === 'true') {
        return 'The condition is met; waiting for a matching trigger event.';
      }
      if (v2Status.condition.truth === 'false') {
        return 'The condition is not met; the routine will not trigger yet.';
      }
      return 'The condition is unknown right now; the reason is reported under Only if.';
    }
    if (!status) return 'Waiting for runtime status.';
    if (status.rules.some((rule) => rule.error)) {
      return 'A rule could not be evaluated; the error is reported under When.';
    }
    if (status.will_trigger) {
      return 'The conditions and triggering event matched. This status does not confirm physical device delivery.';
    }
    if (status.all_conditions_match) {
      return 'The conditions match; waiting for a matching trigger event.';
    }
    const matching = status.rules.filter((rule) => rule.condition_match).length;
    return `${matching} of ${status.rules.length} conditions match.`;
  })();

  const triggerCount = triggers.length;
  const stepCount = program?.kind === 'native' ? program.steps.length : 0;
  const lastRun = v2Status?.last_run;
  const lastRunLine = lastRun
    ? (() => {
        const dispatched = lastRun.steps.filter(
          (step) => step.disposition === 'dispatched',
        ).length;
        const suppressed = lastRun.steps.length - dispatched;
        const dropped = Number(lastRun.dropped);
        return `Latest recorded run #${Number(lastRun.run_id)}: ${lastRun.accepted ? 'accepted' : 'rejected'} · ${dispatched} dispatched, ${suppressed} suppressed${dropped > 0 ? `, ${dropped} dropped` : ''}.`;
      })()
    : null;
  const policySummary = definition.execution
    ? describeExecutionPolicy(definition.execution as ExecutionPolicy)
    : 'Defaults: one run at a time, no action cap.';

  const routineStatusForPreview = previewIsDraft ? undefined : status;

  return (
    <DetailPageShell
      crumbs={[
        { label: 'Settings', to: '/config' },
        { label: 'Routines', to: '/config/routines' },
        { label: routine.name },
      ]}
      backTo="/config/routines"
      backLabel="Back to routines"
      title={routine.name}
      status={
        <>
          <span className="flex flex-wrap items-center gap-1.5">
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
              <Badge variant="outline">Routine</Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-600 dark:text-amber-400"
              >
                Legacy routine
              </Badge>
            )}
            {liveStatusBadge ? (
              <Badge className={liveStatusBadge.className}>
                {liveStatusBadge.label}
              </Badge>
            ) : null}
          </span>
          <span className="block">
            {statusSentence}{' '}
            <Link
              className="underline underline-offset-2"
              to="/config/routine-history"
            >
              See activity
            </Link>
          </span>
          {lastRunLine ? (
            <span className="block text-muted-foreground">{lastRunLine}</span>
          ) : null}
          {routine.enabled && status ? (
            <span className="block text-muted-foreground">
              {statusReceivedAt === null
                ? 'Live status has no receipt time yet.'
                : `Live status received ${formatFreshness(statusReceivedAt, freshnessNow)}.`}
            </span>
          ) : null}
        </>
      }
    >
      {searchParams.get('created') === '1' ? (
        <Alert>
          <AlertDescription>
            <span className="block font-medium">Routine created.</span>
            {routine.enabled
              ? 'It is enabled and reacts the next time the start above matches.'
              : 'It is saved disabled, so it will not run until you enable it.'}{' '}
            The What-if preview below shows whether the body can be evaluated
            right now.
          </AlertDescription>
        </Alert>
      ) : null}
      {isV2 ? (
        <>
          <Section
            id="when"
            title="When"
            summary={`${triggerCount} ${triggerCount === 1 ? 'trigger' : 'triggers'}${
              armedCount > 0 ? ` · ${armedCount} armed` : ''
            }`}
            open={activeSection === 'when'}
            onOpenChange={(open) => openSection(open ? 'when' : null)}
            api={when}
            fieldLabels={{ triggers: 'Triggers' }}
            readView={
              <WhenReadList
                definition={definition}
                status={routine.enabled ? v2Status : undefined}
                devices={devices}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
            }
            renderEditor={(api) => {
              const draft = (api.draft?.definition_v2 ??
                {}) as RoutineDefinitionV2Body;
              return (
                <TriggerBuilder
                  triggers={draft.triggers ?? []}
                  onChange={(next) =>
                    api.patch({
                      definition_v2: { ...draft, triggers: next },
                    } as never)
                  }
                  devices={devices}
                  groups={groups}
                  scenes={scenes.map((scene) => ({
                    id: scene.id,
                    name: scene.name,
                  }))}
                  helpers={helpers}
                  runtimeStatus={routineStatusForPreview}
                  deviceDisplayNameMap={deviceDisplayNameMap}
                />
              );
            }}
          />

          <Section
            id="only-if"
            title="Only if"
            summary={
              routine.enabled && v2Status && !onlyIf.dirty
                ? truth === 'true'
                  ? 'Met right now'
                  : truth === 'false'
                    ? 'Not met right now'
                    : 'Unknown right now'
                : undefined
            }
            badge={v2Status?.condition.error ? 'Evaluation error' : undefined}
            open={activeSection === 'only-if'}
            onOpenChange={(open) => openSection(open ? 'only-if' : null)}
            api={onlyIf}
            fieldLabels={{ condition: 'Conditions' }}
            readView={
              <ConditionReadView
                condition={definition.condition}
                evaluation={
                  routine.enabled && !onlyIf.dirty && v2Status
                    ? v2Status.condition
                    : undefined
                }
                devices={devices}
                deviceDisplayNameMap={deviceDisplayNameMap}
                showTrace
              />
            }
            renderEditor={(api) => {
              const draft = (api.draft?.definition_v2 ??
                {}) as RoutineDefinitionV2Body;
              return (
                <ConditionEditor
                  condition={
                    (draft.condition as ConditionExpr | undefined) ?? {
                      kind: 'literal',
                      value: true,
                    }
                  }
                  onChange={(condition) =>
                    api.patch({
                      definition_v2: { ...draft, condition },
                    } as never)
                  }
                  devices={devices}
                  groups={groups}
                  scenes={scenes.map((scene) => ({
                    id: scene.id,
                    name: scene.name,
                  }))}
                  helpers={helpers}
                />
              );
            }}
          />

          <Section
            id="then"
            title="Then"
            summary={
              program?.kind === 'native'
                ? `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`
                : program?.kind === 'script'
                  ? 'Script'
                  : 'Not configured'
            }
            open={activeSection === 'then'}
            onOpenChange={(open) => openSection(open ? 'then' : null)}
            api={then}
            fieldLabels={{ program: 'Program' }}
            readView={
              <ThenReadList
                program={program}
                lastRun={
                  routine.enabled && !then.dirty
                    ? v2Status?.last_run
                    : undefined
                }
                devices={devices}
                groups={groups}
                scenes={scenes.map((scene) => ({
                  id: scene.id,
                  name: scene.name,
                }))}
                routines={routines.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                }))}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
            }
            renderEditor={(api) => {
              const draft = (api.draft?.definition_v2 ??
                {}) as RoutineDefinitionV2Body;
              return (
                <ProgramBuilder
                  program={draft.program as Program | undefined}
                  onChange={(next) =>
                    api.patch({
                      definition_v2: { ...draft, program: next },
                    } as never)
                  }
                  devices={devices}
                  groups={groups}
                  scenes={scenes.map((scene) => ({
                    id: scene.id,
                    name: scene.name,
                  }))}
                  routines={routines.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                  }))}
                  helpers={helpers}
                />
              );
            }}
          />

          <details className="rounded-2xl border border-border bg-muted/20 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              What would happen if…
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                {previewIsDraft
                  ? 'Draft preview: this uses the section you are editing, which is not saved yet.'
                  : 'This uses the saved routine. Set up a hypothetical event to see which triggers and conditions would match.'}
              </p>
              <RoutineWhatIfPreview
                definition={draftDefinition}
                devices={devices}
              />
              {!previewIsDraft && routine.enabled ? (
                <details className="rounded-xl border border-border bg-background/60 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Live trigger and timer details
                  </summary>
                  <div className="mt-3">
                    <RoutineRuntimePanel
                      routine={routine}
                      status={status}
                      timers={timers}
                      devices={devices}
                      deviceDisplayNameMap={deviceDisplayNameMap}
                    />
                  </div>
                </details>
              ) : null}
            </div>
          </details>

          <Section
            id="advanced"
            title="Advanced"
            summary={policySummary}
            open={activeSection === 'advanced'}
            onOpenChange={(open) => openSection(open ? 'advanced' : null)}
            api={advanced}
            fieldLabels={{ execution: 'Execution policy' }}
            readView={
              <p className="text-sm text-muted-foreground">{policySummary}</p>
            }
            renderEditor={(api) => {
              const draft = (api.draft?.definition_v2 ??
                {}) as RoutineDefinitionV2Body;
              return (
                <RoutineExecutionPolicyEditor
                  policy={draft.execution as ExecutionPolicy | undefined}
                  onChange={(execution) =>
                    api.patch({
                      definition_v2: { ...draft, execution },
                    } as never)
                  }
                />
              );
            }}
          />
        </>
      ) : (
        <>
          <Section
            id="when"
            title="When"
            summary={`${routine.rules.length} legacy ${
              routine.rules.length === 1 ? 'rule' : 'rules'
            }`}
            open={activeSection === 'when'}
            onOpenChange={(open) => openSection(open ? 'when' : null)}
            api={legacyWhen}
            fieldLabels={{ rules: 'Rules' }}
            readView={
              <RoutineRuleList
                rules={routine.rules as Rule[]}
                status={status}
                devices={devices}
                groups={groups}
                scenes={scenes.map((scene) => ({
                  id: scene.id,
                  name: scene.name,
                }))}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
            }
            renderEditor={(api) => (
              <RuleBuilder
                rules={(api.draft?.rules ?? []) as Rule[]}
                devices={devices}
                groups={groups}
                scenes={scenes.map((scene) => ({
                  id: scene.id,
                  name: scene.name,
                }))}
                onChange={(next) => api.patch({ rules: next } as never)}
              />
            )}
          />

          <Section
            id="then"
            title="Then"
            summary={`${routine.actions.length} legacy ${
              routine.actions.length === 1 ? 'action' : 'actions'
            }`}
            open={activeSection === 'then'}
            onOpenChange={(open) => openSection(open ? 'then' : null)}
            api={legacyThen}
            fieldLabels={{ actions: 'Actions' }}
            readView={
              <RoutineActionList
                actions={routine.actions as Action[]}
                devices={devices}
                groups={groups}
                scenes={scenes.map((scene) => ({
                  id: scene.id,
                  name: scene.name,
                }))}
                routines={routines.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                }))}
                deviceDisplayNameMap={deviceDisplayNameMap}
              />
            }
            renderEditor={(api) => (
              <ActionBuilder
                actions={(api.draft?.actions ?? []) as Action[]}
                devices={devices}
                groups={groups}
                scenes={scenes.map((scene) => ({
                  id: scene.id,
                  name: scene.name,
                }))}
                routines={routines.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                }))}
                onChange={(next) => api.patch({ actions: next } as never)}
              />
            )}
          />
        </>
      )}

      <Section
        id="technical-definition"
        title="Technical definition"
        summary={isV2 ? 'Stored v2 definition' : 'Stored v1 rules and actions'}
        open={activeSection === 'technical-definition'}
        onOpenChange={(open) =>
          openSection(open ? 'technical-definition' : null)
        }
        api={technical}
        editLabel="Edit JSON"
        fieldLabels={{
          definition_v2: 'Definition',
          rules: 'Rules',
          actions: 'Actions',
        }}
        readView={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {isV2
                ? 'This is what the server stores for this routine. Sections above edit the parts of it.'
                : 'This routine still uses the legacy model. The sections above edit its rules and actions; the stored definition is shown here for reference.'}
            </p>
            <pre className="max-h-64 overflow-auto rounded-xl bg-muted/40 p-2.5 text-xs">
              {JSON.stringify(
                isV2
                  ? (routine.definition_v2 ?? {})
                  : { rules: routine.rules, actions: routine.actions },
                null,
                2,
              )}
            </pre>
          </div>
        }
        renderEditor={(api) => (
          <JsonEditor
            value={
              isV2
                ? (api.draft?.definition_v2 ?? routine.definition_v2 ?? {})
                : {
                    rules: api.draft?.rules ?? routine.rules,
                    actions: api.draft?.actions ?? routine.actions,
                  }
            }
            onChange={(parsed) => {
              if (isV2) {
                api.patch({ definition_v2: parsed } as never);
              } else {
                api.patch(parsed as never);
              }
            }}
          />
        )}
      />

      <Section
        id="details"
        title="Details"
        summary={`${routine.enabled ? 'Enabled' : 'Disabled'} · id ${routine.id}`}
        open={activeSection === 'details'}
        onOpenChange={(open) => openSection(open ? 'details' : null)}
        api={details}
        fieldLabels={{ name: 'Name', enabled: 'Enabled' }}
        readView={
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-right">{routine.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Enabled</dt>
              <dd className="text-right">{routine.enabled ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Routine id</dt>
              <dd className="text-right font-mono text-xs">{routine.id}</dd>
            </div>
          </dl>
        }
        renderEditor={(api) => (
          <div className="space-y-4">
            <label className="block space-y-1.5" data-field="name">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={(api.draft?.name as string | undefined) ?? routine.name}
                onChange={(event) =>
                  api.patch({ name: event.target.value } as never)
                }
              />
              {api.fieldError('name') ? (
                <span className="text-xs text-destructive">
                  {api.fieldError('name')}
                </span>
              ) : null}
            </label>
            <label
              className="flex items-center justify-between gap-4 rounded-xl border border-border p-3"
              data-field="enabled"
            >
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Enabled</span>
                <span className="block text-xs text-muted-foreground">
                  Disabled routines do not evaluate triggers or run.
                </span>
              </span>
              <Switch
                checked={Boolean(
                  (api.draft?.enabled as boolean | undefined) ??
                  routine.enabled,
                )}
                onCheckedChange={(checked) =>
                  api.patch({ enabled: checked } as never)
                }
                aria-label="Enabled"
              />
            </label>
          </div>
        )}
      />

      <Section
        id="danger"
        title="Delete this routine"
        danger
        editable={false}
        open={activeSection === 'danger'}
        onOpenChange={(open) => openSection(open ? 'danger' : null)}
        api={details}
        readView={
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Deleting removes its triggers, conditions, and program
              {isV2 ? '.' : ', and its legacy rules and actions with them.'}
            </p>
            <Button
              variant="destructive"
              onClick={async () => {
                if (
                  await confirmDestructive(
                    `Delete routine “${routine.name}”?`,
                    'Its triggers, conditions, and program are removed. The legacy rules are deleted with it.',
                  )
                ) {
                  await remove(routine.id);
                }
              }}
            >
              Delete routine
            </Button>
            {remove === undefined ? null : <StatusRegion message={null} />}
          </div>
        }
        renderEditor={() => null}
      />
    </DetailPageShell>
  );
}

function JsonEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (parsed: unknown) => void;
}) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <Advanced
      label="Raw JSON"
      description="Edit the definition directly when the visual editors do not cover a case."
      defaultOpen
    >
      <Textarea
        className="min-h-64 font-mono text-xs"
        defaultValue={text}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            // Keep the last valid parse; the editor shows its own feedback via
            // the section's save validation.
          }
        }}
      />
    </Advanced>
  );
}
