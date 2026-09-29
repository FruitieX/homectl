import { useEffect, useSyncExternalStore } from 'react';
import { entityDraftStore, type EntityDraft } from '@/lib/entityDraft';
import type { FieldError } from '@/lib/configSection';
import { ConfigApiError } from '@/hooks/useConfig';

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
  return {
    key,
    entry,
    value,
    dirty: entry?.dirty ?? false,
    saving: entry?.saving ?? false,
    errors: entry?.errors ?? [],
    conflict: entry?.conflict ?? false,
    change: (next: T | ((current: T) => T)) =>
      entityDraftStore.change(key, next),
    patch: (patch: Partial<T>) =>
      entityDraftStore.change<T>(key, (current) => ({ ...current, ...patch })),
    discard: () => entityDraftStore.discard(key),
    forget: () => entityDraftStore.forget(key),
    save: async () => {
      const current = entityDraftStore.get<T>(key);
      if (!current) return;
      const errors = validate?.(current.value) ?? [];
      if (errors.length) {
        entityDraftStore.errors(key, errors);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(
              `[data-field="${CSS.escape(errors[0].field)}"]`,
            )
            ?.focus(),
        );
        return;
      }
      const submission = entityDraftStore.start<T>(key);
      if (!submission) return;
      try {
        const saved = await save(submission.value, submission.baseline);
        entityDraftStore.saved(
          key,
          submission.generation,
          saved ?? submission.value,
        );
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
    },
  };
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
