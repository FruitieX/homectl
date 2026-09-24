import type { ConditionEvaluation } from '@/bindings/ConditionEvaluation';
import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { NativeAction } from '@/bindings/NativeAction';
import type { PlannedRunStatus } from '@/bindings/PlannedRunStatus';
import type { Program } from '@/bindings/Program';
import type { RoutineDefinitionV2Body } from '@/hooks/useConfig';
import type { RoutineV2RuntimeStatus } from '@/bindings/RoutineV2RuntimeStatus';
import type { TargetSpec } from '@/bindings/TargetSpec';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import {
  describeConditionNarrative,
  describeTriggerPhrase,
  describeUnknownReasonSentence,
} from '@/lib/routineNarrative';
import { describeCondition } from '@/ui/ConditionBuilder';
import { Badge } from '@/ui/primitives/badge';
import {
  StatusBadge,
  formatUnknownReason,
  triggerBadge,
  triggerLabel,
  triggerStateSentence,
} from '@/ui/routine-runtime';

/**
 * Read-only renderers for one v2 routine: the trigger rows, the condition tree
 * with its live evaluation and trace, and the ordered action list with the
 * dispositions from the most recent accepted run. The routine detail page uses
 * these for its read views; editors live in the section's edit state only.
 */

type NameList = { id: string; name: string }[];

export function deviceRefKey(device: {
  integration_id: string;
  device_id: string;
}): string {
  return `${device.integration_id}/${device.device_id}`;
}

export function describeTargetSpec(
  targets: TargetSpec | undefined,
  devices: DevicesState,
  groups: FlattenedGroupsConfig,
  deviceDisplayNameMap: Record<string, string>,
): string {
  if (!targets) return 'devices';
  const parts: string[] = [];
  for (const groupId of targets.groups ?? []) {
    parts.push(groups[groupId]?.name ?? groupId);
  }
  for (const ref of targets.devices ?? []) {
    const key = deviceRefKey(ref);
    const device = devices[key];
    parts.push(
      getDeviceDisplayLabelFromKey(
        key,
        device?.name ?? key,
        deviceDisplayNameMap,
      ),
    );
  }
  if (parts.length <= 2) return parts.join(', ') || 'devices';
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
}

function nameFor(items: NameList, id: string | undefined): string {
  if (!id) return '?';
  return items.find((item) => item.id === id)?.name ?? id;
}

/** One sentence for one native action, phrased as the effect it has. */
export function describeNativeAction(
  step: NativeAction,
  devices: DevicesState,
  groups: FlattenedGroupsConfig,
  scenes: NameList,
  routines: NameList,
  deviceDisplayNameMap: Record<string, string>,
): string {
  switch (step.action) {
    case 'activate_scene': {
      if (step.select) {
        return step.select.kind === 'helper_enum'
          ? `Activate a scene chosen by helper ${step.select.helper}`
          : `Activate the scene for ${describeTargetSpec(step.select.group_id ? { groups: [step.select.group_id] } : undefined, devices, groups, deviceDisplayNameMap)}`;
      }
      return step.scene_id
        ? `Activate “${nameFor(scenes, step.scene_id)}”`
        : 'Activate a scene';
    }
    case 'cycle_scenes':
      return `Cycle ${step.scenes
        .map((scene) => `“${nameFor(scenes, scene.scene_id)}”`)
        .join(' → ')}${step.nowrap ? ' (stop at last)' : ''}`;
    case 'set_power': {
      const key = deviceRefKey(step.device);
      const device = devices[key];
      const label = getDeviceDisplayLabelFromKey(
        key,
        device?.name ?? key,
        deviceDisplayNameMap,
      );
      return step.power ? `Turn on ${label}` : `Turn off ${label}`;
    }
    case 'dim':
      return `Dim ${describeTargetSpec(step.targets, devices, groups, deviceDisplayNameMap)} by ${step.step}`;
    case 'randomize_color':
      return `Randomize color for ${describeTargetSpec(step.targets, devices, groups, deviceDisplayNameMap)}`;
    case 'schedule_timer':
      return `Start timer “${step.timer || '?'}”`;
    case 'replace_timer':
      return `Restart timer “${step.timer || '?'}”`;
    case 'cancel_timer':
      return `Cancel timer “${step.timer || '?'}”`;
    case 'set_helper':
      return `Set helper ${step.helper || '?'} to ${JSON.stringify(step.value)}`;
    case 'invoke_routine':
      return `Run routine “${nameFor(routines, step.routine_id)}”`;
    case 'choose':
      return `Choose between ${step.branches.length} branch${step.branches.length === 1 ? '' : 'es'}`;
  }
}

/**
 * Trigger rows. Closed by default; opening a row explains the runtime state —
 * armed with a next fire time, ineligible, or carrying an evaluation error.
 */
export function WhenReadList({
  definition,
  status,
  devices,
  deviceDisplayNameMap,
  groups,
  onEdit,
}: {
  definition: RoutineDefinitionV2Body;
  status?: RoutineV2RuntimeStatus;
  devices: DevicesState;
  deviceDisplayNameMap: Record<string, string>;
  groups?: FlattenedGroupsConfig;
  onEdit?: () => void;
}) {
  const triggers: TriggerSpec[] = definition.triggers ?? [];
  if (triggers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No triggers yet: this routine never fires on its own.
      </p>
    );
  }
  const context = { devices, groups, deviceNames: deviceDisplayNameMap };
  return (
    <div className="space-y-2">
      {triggers.map((spec) => {
        const runtime = status?.triggers.find(
          (candidate) => candidate.trigger_id === spec.id,
        );
        const badge = runtime ? triggerBadge(runtime) : null;
        const phrase = describeTriggerPhrase(spec, context);
        return (
          <details
            key={spec.id}
            className="rounded-xl border border-border/70 bg-background/60"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2.5">
              <span className="min-w-0 flex-1 text-sm font-medium">
                {phrase.charAt(0).toUpperCase() + phrase.slice(1)}
              </span>
              {badge ? (
                <StatusBadge label={badge.label} tone={badge.tone} />
              ) : null}
            </summary>
            <div className="space-y-1.5 border-t border-border/70 px-2.5 py-2 text-xs text-muted-foreground">
              <p>{triggerStateSentence(runtime)}</p>
              {runtime ? (
                <p>
                  Matched for the current frame: {runtime.fired ? 'yes' : 'no'}{' '}
                  · its condition is {runtime.truth}
                </p>
              ) : null}
              <p className="font-mono text-[11px] leading-relaxed">
                {describeTriggerKindDetail(spec)}
              </p>
              {onEdit ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={onEdit}
                >
                  Edit triggers
                </button>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** The technical half of a trigger, kept for the expanded row only. */
function describeTriggerKindDetail(spec: TriggerSpec): string {
  const parts: string[] = [`kind: ${spec.kind}`];
  const mode = (spec as { mode?: string }).mode;
  if (mode) {
    parts.push(`mode: ${mode}`);
  }
  if (spec.kind === 'schedule' && spec.schedule) {
    if (spec.schedule.cron) {
      parts.push(`cron: ${spec.schedule.cron}`);
    }
    if (spec.schedule.every_ms !== undefined) {
      parts.push(`every: ${String(spec.schedule.every_ms)} ms`);
    }
    if (spec.schedule.timezone) {
      parts.push(`timezone: ${spec.schedule.timezone}`);
    }
  }
  if (spec.kind === 'timer_fired' && spec.timer) {
    parts.push(`timer: ${spec.timer}`);
  }
  return parts.join(' · ');
}

function ConditionTree({
  condition,
  resolveDevice,
}: {
  condition: unknown;
  resolveDevice: (ref: { integration_id: string; device_id: string }) => string;
}) {
  const expr =
    condition && typeof condition === 'object'
      ? (condition as {
          kind?: string;
          value?: unknown;
          conditions?: unknown[];
          condition?: unknown;
        })
      : null;
  if (expr?.kind === 'literal') {
    return (
      <p className="text-sm">
        {expr.value === true
          ? 'Always'
          : expr.value === false
            ? 'Never'
            : `Literal ${JSON.stringify(expr.value)}`}
      </p>
    );
  }
  if (expr?.kind === 'all' || expr?.kind === 'any') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {expr.kind === 'all' ? 'All of' : 'Any of'}
        </p>
        <ul className="space-y-1 border-l border-border pl-3">
          {(expr.conditions ?? []).map((child, index) => (
            <li key={index}>
              <ConditionTree condition={child} resolveDevice={resolveDevice} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (expr?.kind === 'not') {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Not</p>
        <div className="border-l border-border pl-3">
          <ConditionTree
            condition={expr.condition}
            resolveDevice={resolveDevice}
          />
        </div>
      </div>
    );
  }
  return (
    <p className="text-sm">{describeCondition(condition, resolveDevice)}</p>
  );
}

function TraceNode({
  node,
  depth = 0,
}: {
  node: ConditionTraceNode;
  depth?: number;
}) {
  const tone =
    node.truth === 'true'
      ? 'text-emerald-700 dark:text-emerald-300'
      : node.truth === 'false'
        ? 'text-destructive'
        : 'text-amber-700 dark:text-amber-300';
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="rounded bg-muted/50 px-1 text-[11px]">
          {node.path}
        </code>
        <span className={`text-xs font-medium ${tone}`}>{node.truth}</span>
        {node.group ? (
          <span className="text-xs text-muted-foreground">
            {node.group.true_count} of {node.group.configured_count} members
            matched
          </span>
        ) : null}
      </div>
      {node.error ? (
        <p className="text-xs text-destructive">{node.error}</p>
      ) : null}
      {node.unknown_reason ? (
        <p className="text-xs text-muted-foreground">
          Unknown: {formatUnknownReason(node.unknown_reason)}
        </p>
      ) : null}
      {node.children && node.children.length > 0 && depth < 8 ? (
        <ul className="space-y-1 border-l border-border pl-3">
          {node.children.map((child, index) => (
            <TraceNode key={index} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The stored condition plus its live evaluation. When the routine is enabled
 * the current result and a "why this result" trace render below the tree, and
 * an evaluation error is reported as an error rather than as a decision.
 */
export function ConditionReadView({
  condition,
  evaluation,
  devices,
  deviceDisplayNameMap,
  groups,
  showTrace = false,
  onEdit,
}: {
  condition: unknown;
  evaluation?: ConditionEvaluation;
  devices: DevicesState;
  deviceDisplayNameMap: Record<string, string>;
  groups?: FlattenedGroupsConfig;
  showTrace?: boolean;
  onEdit?: () => void;
}) {
  const resolveDevice = (ref: {
    integration_id: string;
    device_id: string;
  }) => {
    const key = deviceRefKey(ref);
    const device = devices[key];
    return getDeviceDisplayLabelFromKey(
      key,
      device?.name ?? key,
      deviceDisplayNameMap,
    );
  };
  const error = evaluation?.error;
  const narrative = describeConditionNarrative(condition as never, {
    devices,
    groups,
    deviceNames: deviceDisplayNameMap,
  });
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed">
        {narrative.text.charAt(0).toUpperCase() + narrative.text.slice(1)}.
        {narrative.evidence ? (
          <span className="text-muted-foreground">
            {' '}
            Right now: {narrative.evidence.split('currently ').pop()}.
          </span>
        ) : null}
      </p>
      {evaluation ? (
        <div className="space-y-1 rounded-xl border border-border/70 bg-muted/20 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Saved routine, right now
            </span>
            {error ? (
              <StatusBadge label="Could not evaluate" tone="error" />
            ) : evaluation.truth === 'true' ? (
              <StatusBadge label="Met" tone="success" />
            ) : evaluation.truth === 'false' ? (
              <StatusBadge label="Not met" tone="error" />
            ) : (
              <StatusBadge label="Unknown" tone="warning" />
            )}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {evaluation.unknown_reason ? (
            <p className="text-xs text-muted-foreground">
              Waiting for data:{' '}
              {describeUnknownReasonSentence(evaluation.unknown_reason, {
                devices,
                groups,
                deviceNames: deviceDisplayNameMap,
              })}
            </p>
          ) : null}
          {showTrace && evaluation.trace ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-xs font-medium">
                Why this result
              </summary>
              <ul className="mt-2 space-y-1">
                <TraceNode node={evaluation.trace} />
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          Show the condition list
        </summary>
        <div className="mt-2">
          <ConditionTree condition={condition} resolveDevice={resolveDevice} />
        </div>
      </details>
      {onEdit ? (
        <button
          type="button"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          onClick={onEdit}
        >
          Edit this condition
        </button>
      ) : null}
    </div>
  );
}

function dispositionFor(
  lastRun: PlannedRunStatus | undefined,
  actionId: string,
) {
  return lastRun?.steps.find((step) => step.action_id === actionId);
}

/**
 * Ordered action list. When the routine has a most recent accepted run, each
 * row says whether that step was dispatched or suppressed and why; steps with
 * no recorded disposition stay unlabelled instead of implying delivery.
 */
export function ThenReadList({
  program,
  lastRun,
  devices,
  groups,
  scenes,
  routines,
  deviceDisplayNameMap,
  onEdit,
}: {
  program?: Program;
  lastRun?: PlannedRunStatus;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: NameList;
  routines: NameList;
  deviceDisplayNameMap: Record<string, string>;
  onEdit?: () => void;
}) {
  if (!program || (program.kind !== 'native' && program.kind !== 'script')) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to do yet: this routine has no program.
      </p>
    );
  }
  if (program.kind === 'script') {
    return (
      <div className="space-y-2">
        <StatusBadge label="Script program" tone="neutral" />
        <p className="text-sm text-muted-foreground">
          This routine runs a script instead of a step list. Open Advanced to
          read or edit it.
        </p>
        <pre className="max-h-48 overflow-auto rounded-xl bg-muted/40 p-2.5 text-xs">
          {program.spec?.source_body ?? ''}
        </pre>
      </div>
    );
  }
  const steps = program.steps ?? [];
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No steps in this program.</p>
    );
  }
  const dropped = lastRun ? Number(lastRun.dropped) : 0;
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {steps.map((step, index) => {
          const disposition = dispositionFor(lastRun, step.id);
          return (
            <li key={step.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                {describeNativeAction(
                  step,
                  devices,
                  groups,
                  scenes,
                  routines,
                  deviceDisplayNameMap,
                )}
                {disposition ? (
                  <span className="ml-2 align-middle">
                    <StatusBadge
                      label={
                        disposition.disposition === 'dispatched'
                          ? 'Dispatched'
                          : 'Suppressed'
                      }
                      tone={
                        disposition.disposition === 'dispatched'
                          ? 'success'
                          : 'warning'
                      }
                      title={disposition.reason}
                    />
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {onEdit ? (
        <button
          type="button"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          onClick={onEdit}
        >
          Edit steps
        </button>
      ) : null}
      {lastRun ? (
        <p className="text-xs text-muted-foreground">
          Labels are from the most recent accepted run
          {dropped > 0
            ? `; ${dropped} step${dropped === 1 ? '' : 's'} were dropped by the execution queue`
            : ''}
          . A dispatched step means the server handed it to the integration, not
          that the device confirmed it.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No accepted run is recorded in this process yet, so no step is labeled
          as dispatched. Runs are listed under Activity.
        </p>
      )}
    </div>
  );
}
