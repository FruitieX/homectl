import type { RoutineHistoryEntry } from '../hooks/useConfig';
import type { UnknownReason } from '../bindings/UnknownReason';
import type { RuleRuntimeStatus } from '../bindings/RuleRuntimeStatus';
const formatShortTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString(undefined, { timeStyle: 'short' });

export function describeUnknownReason(reason: UnknownReason) {
  switch (reason.kind) {
    case 'missing_entity':
      return `Missing entity: ${reason.entity}`;
    case 'missing_field':
      return `Missing field: ${reason.field}`;
    case 'offline':
      return `Device offline: ${reason.device}`;
    case 'stale':
      return `Stale observation: ${reason.device}`;
    case 'empty_selection':
      return `Group has no members: ${reason.group}`;
    case 'not_initialized':
      return `Not initialized: ${reason.entity}`;
    case 'unknown_source_value':
      return `Source has no value: ${reason.source}`;
  }
}

function flattenRuleStatuses(rules: RuleRuntimeStatus[]) {
  const flattened: RuleRuntimeStatus[] = [];
  const visitRule = (rule: RuleRuntimeStatus) => {
    flattened.push(rule);
    rule.children?.forEach(visitRule);
  };

  rules.forEach(visitRule);
  return flattened;
}

function countRuleErrors(entry: RoutineHistoryEntry) {
  return flattenRuleStatuses(entry.status?.rules ?? []).filter(
    (rule) => rule.error,
  ).length;
}

function countV2Errors(entry: RoutineHistoryEntry) {
  const v2 = entry.v2;
  if (!v2) {
    return 0;
  }
  return (
    (v2.condition.error ? 1 : 0) +
    v2.triggers.filter((trigger) => trigger.error).length
  );
}

export function countEntryErrors(entry: RoutineHistoryEntry) {
  return entry.v2 ? countV2Errors(entry) : countRuleErrors(entry);
}

/** Blocked history must never present a previous run as this attempt's work. */
export function recordedRun(entry: RoutineHistoryEntry) {
  return entry.trigger_kind === 'v2_blocked' ? undefined : entry.v2?.last_run;
}

/**
 * Plain-language "why it ran or did not run" summary for one history entry,
 * built from the recorded trigger, condition, and plan outcome.
 */
export function explainEntry(entry: RoutineHistoryEntry): string {
  const v2 = entry.v2;
  if (!v2) {
    if (entry.trigger_kind === 'force_trigger') {
      return `Manually triggered: ${entry.action_count} stored v1 action${entry.action_count === 1 ? '' : 's'} replayed.`;
    }
    // v1 only ever recorded runs, so nothing here can be read as evidence
    // that a past evaluation did or did not match.
    return entry.status?.will_trigger
      ? `Rules matched${entry.event_source_device_key ? ` from ${entry.event_source_device_key}` : ''}; ${entry.action_count} action${entry.action_count === 1 ? '' : 's'} dispatched.`
      : 'A v1 routine ran. Non-runs are not recorded for v1 routines, so past evaluations cannot be reconstructed here.';
  }

  if (entry.trigger_kind === 'v2_blocked') {
    const reason = entry.blocked_reason ?? 'the condition blocked the run';
    const count = entry.occurrence_count ?? 1;
    const latest = formatShortTime(entry.timestamp);
    const since = entry.first_timestamp
      ? `, first at ${formatShortTime(entry.first_timestamp)}`
      : '';
    const howOften =
      count > 1
        ? `Blocked ${count} times; latest at ${latest}${since}.`
        : `Blocked once at ${latest}.`;
    return `An event matched, but the routine did not run: ${reason}. ${howOften}`;
  }

  if (v2.condition.error) {
    return `Not run: the condition errored (${v2.condition.error}).`;
  }
  if (v2.condition.truth === 'unknown') {
    return `Not run: ${v2.condition.unknown_reason ? describeUnknownReason(v2.condition.unknown_reason) : 'part of the condition could not be evaluated'}.`;
  }
  if (v2.condition.truth === 'false') {
    return `Triggered, but the condition was false, so nothing ran.`;
  }

  if (!v2.last_run) {
    return 'An evaluation was recorded, but no run outcome is attached to this entry.';
  }

  const steps = v2.last_run?.steps ?? [];
  const suppressed = steps.filter((step) => step.disposition === 'suppressed');
  const dispatched = steps.filter(
    (step) => step.disposition === 'dispatched',
  ).length;

  if (v2.last_run && !v2.last_run.accepted) {
    const reason = suppressed.find((step) => step.reason)?.reason;
    return `A run was rejected by the execution policy: ${reason ?? 'the plan was rejected before dispatch'}.`;
  }

  const triggerText =
    v2.matched_trigger_ids.length > 0
      ? v2.matched_trigger_ids.join(', ')
      : 'a trigger';
  let summary = `Ran because ${triggerText} matched and the condition was true.`;
  if (dispatched > 0) {
    summary += ` ${dispatched} step${dispatched === 1 ? '' : 's'} dispatched; the device's own report confirms delivery, dispatch alone does not.`;
  }
  if (!steps.length && Number(v2.last_run.dropped) === 0)
    summary += ' No actions were planned.';
  if (suppressed.length > 0) {
    summary += ` ${suppressed.length} step${suppressed.length === 1 ? '' : 's'} suppressed (${suppressed[0].reason ?? 'no reason recorded'}).`;
  }
  if (v2.last_run && v2.last_run.dropped > 0n) {
    summary += ` ${v2.last_run.dropped.toString()} dropped by the bounded queue.`;
  }
  return summary;
}

export function outcome(entry: RoutineHistoryEntry) {
  if (entry.trigger_kind === 'v2_blocked') return 'Blocked';
  if (countEntryErrors(entry)) return 'Error';
  if (entry.v2?.last_run && !entry.v2.last_run.accepted) return 'Rejected';
  if (entry.v2?.condition.truth === 'unknown') return 'Unknown';
  if (entry.v2?.condition.truth === 'false') return 'Blocked';
  if (entry.v2 && !entry.v2.last_run) return 'No run recorded';
  if (
    entry.v2?.last_run?.steps.some(
      (step) => step.disposition === 'suppressed',
    ) ||
    Number(entry.v2?.last_run?.dropped ?? 0) > 0
  )
    return entry.v2?.last_run?.steps.some(
      (step) => step.disposition === 'dispatched',
    )
      ? 'Some steps skipped'
      : 'All steps skipped';
  if (entry.v2?.last_run?.steps.length === 0) return 'No actions';
  return 'Dispatched';
}

export function summary(entry: RoutineHistoryEntry) {
  if (entry.trigger_kind === 'v2_blocked')
    return `${entry.blocked_reason ?? 'A condition prevented the run'}${(entry.occurrence_count ?? 1) > 1 ? ` · ${entry.occurrence_count} attempts` : ''}`;
  if (entry.v2?.condition.error) return entry.v2.condition.error;
  if (entry.v2?.condition.unknown_reason)
    return describeUnknownReason(entry.v2.condition.unknown_reason);
  if (entry.v2 && !entry.v2.last_run) return 'No run outcome was recorded';
  if (
    entry.v2?.last_run?.accepted &&
    entry.v2.last_run.steps.length === 0 &&
    Number(entry.v2.last_run.dropped) === 0
  )
    return 'No actions were planned';
  const reason = entry.v2?.last_run?.steps.find((step) => step.reason)?.reason;
  return (
    reason ??
    `${entry.action_count} action${entry.action_count === 1 ? '' : 's'} dispatched`
  );
}
