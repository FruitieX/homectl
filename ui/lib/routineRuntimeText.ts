import type { TriggerRuntimeStatus } from '@/bindings/TriggerRuntimeStatus';
import type { UnknownReason } from '@/bindings/UnknownReason';

/**
 * The pure sentences a routine's status is described with. They live outside the
 * React component file so they can be unit tested, and so every surface says
 * the same thing about the same state.
 */

export function formatDuration(ms: number): string {
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

/** '3 min ago' style stamp for a recorded event. */
export function formatRelativeTime(thenMs: number, nowMs: number): string {
  const delta = nowMs - thenMs;
  if (delta < 0) {
    return `in ${formatDuration(-delta)}`;
  }
  return `${formatDuration(delta)} ago`;
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

/**
 * One sentence about where a trigger stands. Three states are kept apart:
 * disabled, enabled-but-no-report-yet, and a report that says something.
 */
export function triggerStateSentence(
  trigger: TriggerRuntimeStatus | undefined,
  now: number = Date.now(),
  context: { enabled?: boolean; triggerLabel?: string } = {},
): string {
  if (!trigger) {
    if (context.enabled === false) {
      return 'Not evaluated: the routine is disabled.';
    }
    // Enabled but no report yet: name the evidence that is missing instead of
    // telling the reader to enable a routine that is already enabled.
    return context.triggerLabel
      ? `No trigger evaluation received yet; waiting for a report from ${context.triggerLabel}.`
      : 'No trigger evaluation received yet; waiting for the first report.';
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
