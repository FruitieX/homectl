import type { ConditionTraceNode } from '@/bindings/ConditionTraceNode';
import { describeScheduleNarrative } from '@/lib/routineNarrative';
import type { DeviceIdRef } from '@/bindings/DeviceIdRef';
import type { DevicesState } from '@/bindings/DevicesState';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { TimerRuntimeStatus } from '@/bindings/TimerRuntimeStatus';
import type { TriggerRuntimeStatus } from '@/bindings/TriggerRuntimeStatus';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { UnknownReason } from '@/bindings/UnknownReason';
import type { Routine } from '@/hooks/useConfig';
import {
  getDeviceDisplayLabel,
  getDeviceDisplayLabelFromKey,
} from '@/lib/deviceLabel';
import { Badge } from '@/ui/primitives/badge';
import { Card, CardContent } from '@/ui/primitives/card';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';

type Tone = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'ghost';

const toneClassName: Record<Tone, string> = {
  success:
    'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  info: 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300',
  warning:
    'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  error:
    'border-transparent bg-destructive/15 text-destructive dark:text-red-300',
  neutral: 'border-transparent bg-muted text-muted-foreground',
  ghost: 'border-transparent bg-muted/70 text-muted-foreground',
};

export function StatusBadge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: Tone;
  title?: string;
}) {
  return (
    <Badge className={toneClassName[tone]} title={title}>
      {label}
    </Badge>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return 'unknown';
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

export function formatDue(dueWallMs: number, nowMs: number): string {
  const delta = dueWallMs - nowMs;
  const relative =
    delta >= 0
      ? `in ${formatDuration(delta)}`
      : `${formatDuration(-delta)} overdue`;
  const clock = new Date(dueWallMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${relative} · ${clock}`;
}

export function formatUnknownReason(reason: UnknownReason): string {
  switch (reason.kind) {
    case 'missing_entity':
      return `missing entity ${reason.entity}`;
    case 'missing_field':
      return `missing field ${reason.field}`;
    case 'offline':
      return `device offline: ${reason.device}`;
    case 'stale':
      return `stale data: ${reason.device}`;
    case 'empty_selection':
      return `empty group: ${reason.group}`;
    case 'not_initialized':
      return `not initialized: ${reason.entity}`;
    case 'unknown_source_value':
      return `unknown source value: ${reason.source}`;
  }
}

function deviceRefLabel(
  ref: DeviceIdRef,
  devices: DevicesState,
  deviceDisplayNameMap: Record<string, string>,
): string {
  const key = `${ref.integration_id}/${ref.device_id}`;
  const device = devices[key];
  return device
    ? getDeviceDisplayLabel(device, deviceDisplayNameMap)
    : getDeviceDisplayLabelFromKey(key, key, deviceDisplayNameMap);
}

export function triggerLabel(
  spec: TriggerSpec | undefined,
  devices: DevicesState,
  deviceDisplayNameMap: Record<string, string>,
): string | undefined {
  if (!spec) {
    return undefined;
  }

  switch (spec.kind) {
    case 'schedule': {
      // The raw cron expression belongs in the row's technical detail, not in
      // the sentence a beginner reads.
      const schedule = describeScheduleNarrative(spec.schedule);
      return `On a schedule: ${schedule.text}`;
    }
    case 'predicate_for':
      return `Held for ${formatDuration(Number(spec.duration_ms))}`;
    case 'predicate_transition':
      return 'Predicate becomes true';
    case 'report':
      return `Report from ${deviceRefLabel(spec.device, devices, deviceDisplayNameMap)}`;
    case 'state_change':
      return `State ${spec.mode === 'transition' ? 'transition' : 'level'} on ${deviceRefLabel(spec.device, devices, deviceDisplayNameMap)}`;
    case 'timer_fired':
      return `Timer "${spec.timer}" fires`;
    case 'startup':
      return 'On startup';
    case 'manual':
      return 'Manual trigger';
  }
}

function truthBadge(node: ConditionTraceNode): { label: string; tone: Tone } {
  if (!node.evaluated) {
    return { label: 'not evaluated', tone: 'ghost' };
  }

  switch (node.truth) {
    case 'true':
      return { label: 'true', tone: 'success' };
    case 'false':
      return { label: 'false', tone: 'neutral' };
    case 'unknown':
      return { label: 'unknown', tone: 'warning' };
  }
}

/**
 * Server-side condition trace (P04/G07): every visited node with its truth,
 * group counts, and reasons. This is the evaluator's own explanation, not a
 * UI reimplementation.
 */
function ConditionTraceTree({ node }: { node: ConditionTraceNode }) {
  const badge = truthBadge(node);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={badge.label} tone={badge.tone} />
        <span className="font-mono text-xs text-muted-foreground">
          {node.path}
        </span>
        {node.group ? (
          <span className="text-xs text-muted-foreground">
            {node.group.quantifier} · {node.group.true_count}/
            {node.group.configured_count} true
            {node.group.unknown_count > 0
              ? ` · ${node.group.unknown_count} unknown`
              : ''}
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
      {node.group?.reasons?.length ? (
        <p className="text-xs text-muted-foreground">
          {node.group.reasons.map(formatUnknownReason).join(' · ')}
        </p>
      ) : null}
      {node.children?.map((child) => (
        <div key={child.path} className="border-l border-border pl-3">
          <ConditionTraceTree node={child} />
        </div>
      ))}
    </div>
  );
}

/**
 * One sentence for a trigger's live state, shared by the routine read view and
 * the trigger editor rows so both explain the same runtime facts the same way:
 * armed with a next fire time, otherwise why it is idle or unavailable.
 */
export function triggerStateSentence(
  trigger: TriggerRuntimeStatus | undefined,
  now: number = Date.now(),
): string {
  if (!trigger) {
    return 'No live state yet: enable the routine and wait for the next status update.';
  }
  if (trigger.error) {
    return `Cannot be evaluated: ${trigger.error}`;
  }
  if (
    trigger.armed &&
    trigger.due_wall_ms !== undefined &&
    (trigger.kind === 'schedule' || trigger.kind === 'timer_fired')
  ) {
    return trigger.kind === 'schedule'
      ? `Scheduled — next run ${formatDue(Number(trigger.due_wall_ms), now)}`
      : `Timer set — fires ${formatDue(Number(trigger.due_wall_ms), now)}`;
  }
  if (trigger.armed) {
    return trigger.kind === 'schedule'
      ? 'Scheduled — waiting for the next time'
      : 'Watching for the next event';
  }
  if (trigger.unknown_reason) {
    return `Unknown: ${formatUnknownReason(trigger.unknown_reason)}`;
  }
  return trigger.eligible
    ? 'Eligible, but no deadline is armed for it right now.'
    : 'Not eligible in the current evaluation frame.';
}

export function triggerBadge(trigger: TriggerRuntimeStatus): {
  label: string;
  tone: Tone;
} {
  if (trigger.error) {
    return { label: 'Error', tone: 'error' };
  }
  if (trigger.fired) {
    return { label: 'Fired', tone: 'success' };
  }
  if (trigger.armed) {
    return trigger.kind === 'schedule'
      ? { label: 'Scheduled', tone: 'info' }
      : { label: 'Watching', tone: 'info' };
  }
  // Event triggers (reports, schedules, timers, startup, manual) have no
  // meaningful truth value, so they must not read as "Unknown".
  switch (trigger.kind) {
    case 'report':
      return { label: 'Listening', tone: 'neutral' };
    case 'schedule':
      return { label: 'Scheduled', tone: 'info' };
    case 'timer_fired':
      return { label: 'Timer', tone: 'neutral' };
    case 'startup':
      return { label: 'On start', tone: 'neutral' };
    case 'manual':
      return { label: 'Manual', tone: 'neutral' };
  }
  if (trigger.truth === 'unknown') {
    return { label: 'Unknown', tone: 'warning' };
  }
  if (trigger.eligible) {
    return { label: 'Ready', tone: 'neutral' };
  }
  return { label: 'Waiting for data', tone: 'ghost' };
}

function PanelSection({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground/80">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant="outline">{count}</Badge>
        </div>
        <div className="mt-4 space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}

interface RoutineRuntimePanelProps {
  routine: Routine;
  status?: RoutineRuntimeStatus;
  timers: TimerRuntimeStatus[];
  devices: DevicesState;
  deviceDisplayNameMap: Record<string, string>;
}

/**
 * Live v2 trigger and named timer state for one routine. Native triggers
 * expose their armed wakeup deadline (next fire) and named timers show the
 * pending deadline; both tick with a 15s clock while visible.
 */
export function RoutineRuntimePanel({
  routine,
  status,
  timers,
  devices,
  deviceDisplayNameMap,
}: RoutineRuntimePanelProps) {
  const v2 = status?.v2;
  const routineTimers = timers.filter(
    (timer) => timer.routine_id === routine.id,
  );
  const [now, setNow] = useState(() => Date.now());
  const hasCountdown =
    Boolean(
      v2?.triggers.some((trigger) => trigger.armed && trigger.due_wall_ms),
    ) || routineTimers.length > 0;
  useInterval(() => setNow(Date.now()), hasCountdown ? 15000 : null);

  if (!v2 && routineTimers.length === 0) {
    return null;
  }

  const triggerSpecs = routine.definition_v2?.triggers ?? [];

  return (
    <div className="space-y-4">
      {v2 ? (
        <PanelSection
          title="Trigger status"
          description="What the saved routine is waiting for. Scheduled triggers show their next run."
          count={v2.triggers.length}
        >
          {v2.triggers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/70 px-4 py-6 text-center text-sm text-muted-foreground">
              This definition declares no triggers.
            </div>
          ) : (
            v2.triggers.map((trigger) => {
              const badge = triggerBadge(trigger);
              const spec = triggerSpecs.find(
                (candidate) => candidate.id === trigger.trigger_id,
              );
              const label = triggerLabel(spec, devices, deviceDisplayNameMap);

              return (
                <div
                  key={trigger.trigger_id}
                  className="rounded-2xl border border-border bg-background/70 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {trigger.kind.replaceAll('_', ' ')}
                        </Badge>
                        <span className="font-medium">
                          {label ?? trigger.trigger_id}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {trigger.trigger_id}
                      </p>
                    </div>
                    <StatusBadge label={badge.label} tone={badge.tone} />
                  </div>

                  {trigger.armed && trigger.due_wall_ms !== undefined ? (
                    <p className="mt-2 text-sm text-foreground/80">
                      Next fire {formatDue(Number(trigger.due_wall_ms), now)}
                    </p>
                  ) : null}

                  {trigger.error ? (
                    <p className="mt-2 text-sm text-destructive">
                      {trigger.error}
                    </p>
                  ) : null}

                  {trigger.unknown_reason ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Unknown: {formatUnknownReason(trigger.unknown_reason)}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}

          <p className="text-sm text-muted-foreground">
            Condition:{' '}
            {v2.condition.error
              ? v2.condition.error
              : v2.condition.truth === 'true'
                ? 'met'
                : v2.condition.truth === 'false'
                  ? 'not met'
                  : 'unknown'}
            {v2.last_run
              ? ` · Last run: ${
                  v2.last_run.accepted
                    ? `applied ${v2.last_run.steps.length} step${v2.last_run.steps.length === 1 ? '' : 's'}`
                    : 'suppressed'
                }${v2.last_run.dropped > 0 ? `, ${v2.last_run.dropped} dropped` : ''}`
              : ''}
          </p>

          <details className="rounded-2xl border border-border bg-background/70">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              Condition trace
            </summary>
            <div className="space-y-2 px-3 pb-3">
              <ConditionTraceTree node={v2.condition.trace} />
            </div>
          </details>

          {routine.definition_v2 ? (
            <details className="rounded-2xl border border-border bg-background/70">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                Native definition
              </summary>
              <pre className="overflow-x-auto px-3 pb-3 text-xs">
                {JSON.stringify(routine.definition_v2, null, 2)}
              </pre>
            </details>
          ) : null}
        </PanelSection>
      ) : null}

      {routineTimers.length > 0 ? (
        <PanelSection
          title="Named timers"
          description="Timer jobs owned by this routine. A restart drops session timers and restores durable ones whose deadline is still ahead."
          count={routineTimers.length}
        >
          {routineTimers.map((timer) => (
            <div
              key={`${timer.timer}:${timer.generation}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-background/70 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  Timer &quot;{timer.timer}&quot;
                </span>
                <Badge variant="outline">
                  {timer.persistence === 'durable' ? 'Durable' : 'Session'}
                </Badge>
              </div>
              <span className="text-sm text-foreground/80">
                {timer.status === 'pending'
                  ? `Due ${formatDue(timer.due_wall_ms, now)}`
                  : timer.status}
              </span>
            </div>
          ))}
        </PanelSection>
      ) : null}
    </div>
  );
}
