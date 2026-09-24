/**
 * Creation drafts for the guided journeys.
 *
 * A draft is kept in sessionStorage so leaving the routine creator to build a
 * scene (and coming back) does not lose the work. Drafts are limited to what
 * the journeys themselves describe — scene and routine definitions — and a
 * payload whose keys look like credentials is refused rather than stored.
 * Drafts are versioned: a version bump makes old drafts unreadable instead of
 * being fed to a newer shape.
 */

export const CREATION_DRAFT_VERSION = 3;

export type CreationDraftKind = 'routine' | 'scene';

export type CreationDraft<T> = {
  version: number;
  kind: CreationDraftKind;
  savedAt: number;
  payload: T;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SECRET_KEY = /(secret|token|password|passwd|api[-_]?key|credential)/i;

export function creationDraftKey(kind: CreationDraftKind): string {
  return `homectl:creation-draft:${kind}:v${CREATION_DRAFT_VERSION}`;
}

/** True when any key in the payload looks like a credential. */
export function containsSecretLikeKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsSecretLikeKey(entry, depth + 1));
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      return true;
    }
    if (containsSecretLikeKey(entry, depth + 1)) {
      return true;
    }
  }
  return false;
}

export function saveCreationDraft<T>(
  kind: CreationDraftKind,
  payload: T,
  storage: StorageLike | undefined = globalThis.sessionStorage,
): boolean {
  if (!storage || containsSecretLikeKey(payload)) {
    return false;
  }
  const draft: CreationDraft<T> = {
    version: CREATION_DRAFT_VERSION,
    kind,
    savedAt: Date.now(),
    payload,
  };
  try {
    storage.setItem(creationDraftKey(kind), JSON.stringify(draft));
    return true;
  } catch {
    // Private mode or a full quota: drafting is a convenience, never required.
    return false;
  }
}

export function loadCreationDraft<T>(
  kind: CreationDraftKind,
  storage: StorageLike | undefined = globalThis.sessionStorage,
): { payload: T; savedAt: number } | null {
  if (!storage) {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(creationDraftKey(kind));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CreationDraft<T>;
    if (
      !parsed ||
      parsed.version !== CREATION_DRAFT_VERSION ||
      parsed.kind !== kind ||
      parsed.payload === undefined ||
      containsSecretLikeKey(parsed.payload)
    ) {
      return null;
    }
    return { payload: parsed.payload, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function clearCreationDraft(
  kind: CreationDraftKind,
  storage: StorageLike | undefined = globalThis.sessionStorage,
): void {
  try {
    storage?.removeItem(creationDraftKey(kind));
  } catch {
    // Nothing to do: the draft simply stays until the session ends.
  }
}

/** "just now" / "3 minutes ago" for the restore banner. */
export function describeDraftAge(
  savedAt: number,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - savedAt);
  if (elapsed < 60_000) {
    return 'just now';
  }
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
