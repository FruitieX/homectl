import type { ExecutionPolicy } from '@/bindings/ExecutionPolicy';

/**
 * One plain-language sentence for a routine's execution policy, used as the
 * Advanced section's summary and read view. The wording says what the server
 * does with overlapping runs and with more actions than the cap allows,
 * instead of repeating the field names.
 */
export function describeExecutionPolicy(
  policy: ExecutionPolicy | undefined,
): string {
  if (!policy) {
    return 'Defaults: a run that is still going is not started again, and every step the program contains is dispatched.';
  }
  const parts: string[] = [];
  switch (policy.mode) {
    case 'single':
      parts.push('A run that is still going is skipped, not queued.');
      break;
    case 'queued':
      parts.push('A run that arrives while another is going waits its turn.');
      break;
    case 'restart':
      parts.push('A run that arrives while another is going replaces it.');
      break;
  }
  const maxActions = Number(policy.max_actions);
  parts.push(
    Number.isFinite(maxActions) && maxActions > 0
      ? `At most ${maxActions} action${maxActions === 1 ? '' : 's'} are dispatched per run. A run that would dispatch more is rejected as a whole — nothing from it is sent.`
      : 'No cap on dispatched actions per run.',
  );
  const interval = policy.min_interval_ms;
  if (interval !== undefined && Number(interval) > 0) {
    const ms = Number(interval);
    const seconds = ms / 1000;
    parts.push(
      seconds >= 60
        ? `At most one run every ${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? '' : 's'}.`
        : `At most one run every ${Math.round(seconds)} second${Math.round(seconds) === 1 ? '' : 's'}.`,
    );
  }
  return parts.join(' ');
}
