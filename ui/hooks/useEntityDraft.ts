import { useEffect, useSyncExternalStore } from 'react';
import { entityDraftStore, type EntityDraft } from '@/lib/entityDraft';
import type { FieldError } from '@/lib/configSection';
import { ConfigApiError } from '@/hooks/useConfig';
import { offerUndo } from '@/lib/undo';

/**
 * Only edits of an existing item can be undone by saving the previous version
 * again; a create has no earlier version (its template has no id, or a
 * different one). Returns the fields that keep the undo write current.
 */
function undoContext(
  baseline: object,
  saved: object,
): { revision_token?: string } | undefined {
  const before = baseline as { id?: unknown; revision_token?: unknown };
  const after = saved as { id?: unknown; revision_token?: unknown };
  const sameItem =
    (typeof before.id === 'string' || typeof before.id === 'number') &&
    before.id !== '' &&
    before.id !== 0 &&
    before.id === after.id;
  const revisioned =
    typeof before.revision_token === 'string' &&
    typeof after.revision_token === 'string';
  if (!sameItem && !revisioned) return undefined;
  return typeof after.revision_token === 'string'
    ? { revision_token: after.revision_token }
    : {};
}
export function useEntityDrafts() {
  useSyncExternalStore(
    entityDraftStore.subscribe,
    entityDraftStore.version,
    entityDraftStore.version,
  );
  return entityDraftStore.list();
}
export function useEntityDraft<T extends object>({
  key,
  item,
  label,
  href,
  save,
  validate,
}: {
  key: string;
  item: T | undefined;
  label: string;
  href: string;
  save: (value: T, expected: T) => Promise<T | undefined | void>;
  validate?: (value: T) => FieldError[];
}) {
  useSyncExternalStore(
    entityDraftStore.subscribe,
    entityDraftStore.version,
    entityDraftStore.version,
  );
  useEffect(() => {
    if (item) entityDraftStore.sync(key, item, { label, href });
  }, [key, item, label, href]);
  const entry = entityDraftStore.get<T>(key);
  const value = entry?.value ?? item;
  const inputErrors = Object.entries(entry?.inputs ?? {}).flatMap(
    ([field, input]) => (input.error ? [{ field, message: input.error }] : []),
  );
  const api = {
    key,
    entry,
    value,
    dirty: entry?.dirty ?? false,
    saving: entry?.saving ?? false,
    errors: [
      ...inputErrors,
      ...(entry?.errors ?? []).filter(
        (error) => !inputErrors.some((input) => input.field === error.field),
      ),
    ],
    conflict: entry?.conflict ?? false,
    change: (next: T | ((current: T) => T)) =>
      entityDraftStore.change(key, next),
    patch: (patch: Partial<T>) =>
      entityDraftStore.change<T>(key, (current) => ({ ...current, ...patch })),
    discard: () => entityDraftStore.discard(key),
    forget: () => entityDraftStore.forget(key),
    save: () => saveDraft(),
  };
  return api;
  async function saveDraft(undoing = false): Promise<void> {
    const current = entityDraftStore.get<T>(key);
    if (!current) return;
    const errors = [
      ...Object.entries(current.inputs ?? {}).flatMap(([field, input]) =>
        input.error ? [{ field, message: input.error }] : [],
      ),
      ...(validate?.(current.value) ?? []),
    ];
    if (errors.length) {
      entityDraftStore.errors(key, errors);
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>(
          `[data-field="${CSS.escape(errors[0].field)}"]`,
        );
        // A retained error can belong to a collapsed optional section after navigation.
        for (
          let parent = field?.parentElement;
          parent;
          parent = parent.parentElement
        )
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        field?.focus();
      });
      return;
    }
    const submission = entityDraftStore.start<T>(key);
    if (!submission) return;
    try {
      const saved = await save(submission.value, submission.baseline);
      const result = saved ?? submission.value;
      entityDraftStore.saved(key, submission.generation, result);
      const undo = undoContext(submission.baseline, result);
      if (undo) {
        const previous = submission.baseline;
        offerUndo(
          undoing ? `Restored ${label}` : `Saved ${label}`,
          async () => {
            const latest = entityDraftStore.get<T>(key);
            if (!latest || latest.dirty || latest.saving)
              throw Error(
                'Save or discard your newer edits before undoing this change.',
              );
            entityDraftStore.change<T>(key, { ...previous, ...undo });
            await saveDraft(true);
            const after = entityDraftStore.get<T>(key);
            if (after?.dirty)
              throw Error(
                after.errors[0]?.message ??
                  'Could not undo. The previous version is in the editor; review it and save.',
              );
          },
          undoing ? 'Change restored' : 'Change undone',
        );
      }
    } catch (error) {
      const latest =
        error instanceof ConfigApiError && error.status === 409
          ? (error.current as T | undefined)
          : undefined;
      entityDraftStore.failed(
        key,
        submission.generation,
        error instanceof Error
          ? error.name === 'TimeoutError'
            ? 'The save response timed out. The server may have applied it. Your draft is kept; check the saved item before retrying.'
            : error.message
          : 'Could not save changes. Your draft is still here.',
        latest,
      );
    }
  }
}
export type EntityDraftApi<T extends object> = ReturnType<
  typeof useEntityDraft<T>
>;
export function entityFieldProps(
  draft: { key: string; errors: FieldError[] },
  field: string,
) {
  const invalid = draft.errors.some((error) => error.field === field);
  return {
    'data-field': field,
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid
      ? `draft-error-${encodeURIComponent(`${draft.key}/${field}`)}`
      : undefined,
  };
}
export type { EntityDraft };
