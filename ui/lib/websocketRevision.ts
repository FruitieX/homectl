/**
 * Revision tracking for websocket state patches.
 *
 * The server tags every `State`/`Patch` message with a monotonic revision.
 * Patches are only safe to apply when they directly follow the revision the
 * client last saw; a gap means at least one update was missed, so the client
 * must ask for a full resync instead of applying a partial patch.
 */
export type PatchDecision = 'apply' | 'ignore' | 'resync';

export function decidePatchAction(
  lastRevision: number | null,
  revision: number,
): PatchDecision {
  if (lastRevision === null) {
    return 'resync';
  }
  if (revision === lastRevision + 1) {
    return 'apply';
  }
  if (revision <= lastRevision) {
    // Duplicate or stale patch: its content is already covered by the state
    // the client has (or by a full state that arrived after it was sent).
    return 'ignore';
  }
  return 'resync';
}
