import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deepCopy,
  deepEqual,
  type FieldError,
  mergeFields,
  pickFields,
  sectionChangedElsewhere,
} from '@/lib/configSection';

export type SectionEditorApi<T extends object> = {
  /** Non-null only while the section is being edited. */
  draft: Partial<T> | null;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  errors: FieldError[];
  /** The fields this section owns changed on the server since Edit was pressed. */
  conflict: boolean;
  begin: () => void;
  patch: (values: Partial<T>) => void;
  cancel: () => void;
  save: () => Promise<void>;
  /** Drop the draft and adopt the latest server values. */
  reload: () => void;
  /** Dismiss the conflict warning and keep editing the draft. */
  keepDraft: () => void;
  fieldError: (field: string) => string | undefined;
  firstInvalidField: string | null;
};

type Options<T extends object> = {
  /** The item as currently loaded (may be null while loading). */
  item: T | null | undefined;
  /** Fields this section owns; used for the draft, the merge, and conflicts. */
  fields: readonly string[];
  /** Return the errors for a draft; empty means valid. */
  validate?: (draft: Partial<T>) => FieldError[];
  /** Existing update mutation; receives the merged item. */
  save: (merged: T) => Promise<void>;
  /** Run after a successful save (focus, announcements). */
  onSaved?: () => void;
  /** Fields that also change while editing without counting as a conflict. */
  ignoreFields?: readonly string[];
};

/**
 * One-section editing: Edit copies only this section's saved fields, Cancel
 * discards them, Save validates, merges into the latest loaded item, and calls
 * the page's existing mutation. If those fields changed on the server since
 * Edit was pressed the draft is not silently overwritten — the caller shows
 * the "changed elsewhere" choice instead.
 */
export function useSectionEditor<T extends object>({
  item,
  fields,
  validate,
  save,
  onSaved,
  ignoreFields = [],
}: Options<T>): SectionEditorApi<T> {
  const [draft, setDraft] = useState<Partial<T> | null>(null);
  const [baseline, setBaseline] = useState<Record<string, unknown> | null>(
    null,
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);

  const fieldsKey = fields.join('\u0000');
  const fieldList = useMemo(() => fieldsKey.split('\u0000'), [fieldsKey]);

  const begin = useCallback(() => {
    if (!item) return;
    const snapshot = pickFields(item, fieldList);
    setDraft(deepCopy(snapshot) as Partial<T>);
    setBaseline(snapshot);
    setErrors([]);
    setConflict(false);
    setConflictDismissed(false);
  }, [fieldList, item]);

  const cancel = useCallback(() => {
    setDraft(null);
    setBaseline(null);
    setErrors([]);
    setConflict(false);
    setConflictDismissed(false);
  }, []);

  const patch = useCallback((values: Partial<T>) => {
    setDraft((current) =>
      current === null ? current : { ...current, ...values },
    );
  }, []);

  const reload = useCallback(() => {
    cancel();
  }, [cancel]);

  const keepDraft = useCallback(() => {
    setConflictDismissed(true);
  }, []);

  // Watch for server-side edits to this section's fields while a draft exists.
  useEffect(() => {
    if (!draft || !baseline || !item) return;
    const latest = pickFields(item, fieldList);
    const changed = sectionChangedElsewhere(baseline, latest, ignoreFields);
    setConflict(changed && !conflictDismissed);
  }, [baseline, conflictDismissed, draft, fieldList, ignoreFields, item]);

  const dirty =
    draft !== null && baseline !== null && !deepEqual(draft, baseline);

  const saveDraft = useCallback(async () => {
    if (!draft || !item) return;
    const found = validate ? validate(draft) : [];
    if (found.length > 0) {
      setErrors(found);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const merged = mergeFields(item, draft as Partial<T>);
      await save(merged);
      setDraft(null);
      setBaseline(null);
      setConflict(false);
      setConflictDismissed(false);
      onSaved?.();
    } catch (error) {
      // The network/server error is surfaced by the caller (which owns the
      // Retry affordance); keep the draft so nothing typed is lost.
      setErrors([
        {
          field: 'section',
          message: error instanceof Error ? error.message : 'Save failed',
        },
      ]);
    } finally {
      setSaving(false);
    }
  }, [draft, item, onSaved, save, validate]);

  const fieldError = useCallback(
    (field: string) => errors.find((entry) => entry.field === field)?.message,
    [errors],
  );

  const firstInvalid = errors.length > 0 ? errors[0].field : null;

  // A section that is being edited must not start editing again from a stale
  // item; keep the ref so `begin` is stable for focus restore callbacks.
  const hasDraft = useRef(false);
  hasDraft.current = draft !== null;

  return {
    draft,
    editing: draft !== null,
    dirty,
    saving,
    errors,
    conflict,
    begin,
    patch,
    cancel,
    save: saveDraft,
    reload,
    keepDraft,
    fieldError,
    firstInvalidField: firstInvalid,
  };
}
