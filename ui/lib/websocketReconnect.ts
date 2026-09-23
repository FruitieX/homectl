export type SocketReadiness =
  | 'none'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed';

export type ResumeAction = 'reconnect' | 'wait' | 'probe';

/**
 * How long a foregrounded app waits for the resync reply before treating a
 * socket that the browser still reports as open as dead.
 */
export const RESUME_PROBE_TIMEOUT_MS = 2_000;

export const RECONNECT_BASE_DELAY_MS = 1_000;

/**
 * Ceiling for the reconnect backoff. Live controls are the point of this UI,
 * so a dropped socket has to recover within seconds rather than tens of
 * seconds once the network is back.
 */
export const RECONNECT_MAX_DELAY_MS = 10_000;

/** Delay before the nth consecutive reconnect attempt. */
export function reconnectDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.floor(attempts));
  return Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** exponent,
    RECONNECT_MAX_DELAY_MS,
  );
}

/** What to do when the app is foregrounded or the network comes back. */
export function decideResumeAction(readiness: SocketReadiness): ResumeAction {
  switch (readiness) {
    case 'connecting':
      return 'wait';
    case 'open':
      return 'probe';
    default:
      return 'reconnect';
  }
}

/** Maps `WebSocket.readyState` onto the readiness used above. */
export function socketReadiness(readyState: number): SocketReadiness {
  switch (readyState) {
    case 0:
      return 'connecting';
    case 1:
      return 'open';
    case 2:
      return 'closing';
    case 3:
      return 'closed';
    default:
      return 'none';
  }
}
