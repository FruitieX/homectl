import { useRef, useState } from 'react';
import { useAppConfig } from '@/hooks/appConfig';
import { ConfigApiError } from '@/hooks/useConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import {
  useCalibrationEditor,
  type CalibrationEditorView,
  type CalibrationEdit,
} from '@/hooks/useCalibrationEditor';
import { entityDraftStore } from '@/lib/entityDraft';
import { configItemHref } from '@/lib/configItemHref';
import type { FieldError } from '@/lib/configSection';

export function useCalibrationDraft<T extends object>({
  kind,
  deviceKey,
  label,
  initial,
  form,
  prepare,
  beforeSave,
  validate,
  onSaved,
  href,
}: {
  kind: 'color' | 'brightness' | 'assignment';
  deviceKey: string;
  label: string;
  initial: CalibrationEditorView;
  form: () => T;
  prepare: (form: T, basis: CalibrationEditorView) => CalibrationEdit;
  beforeSave: () => Promise<void>;
  validate?: (form: T) => FieldError[];
  onSaved?: () => void;
  href?: string;
}) {
  const { apiEndpoint } = useAppConfig();
  const api = useCalibrationEditor();
  const key = `${apiEndpoint}/calibration/${kind}/${deviceKey}`;
  const seed = useRef<{ form: T; basis: CalibrationEditorView } | null>(null);
  if (!seed.current) seed.current = { form: form(), basis: initial };
  const [conflict, setConflict] = useState<CalibrationEditorView | null>(null);
  const draft = useEntityDraft({
    key,
    item:
      entityDraftStore.get<{ form: T; basis: CalibrationEditorView }>(key)
        ?.baseline ?? seed.current,
    label: `${label} · ${kind} calibration`,
    href:
      href ??
      `${configItemHref('device', deviceKey)}${kind === 'assignment' ? '' : '?calibration=' + kind}#calibration`,
    validate: (value) => validate?.(value.form) ?? [],
    save: async (value) => {
      await beforeSave();
      try {
        const basis = await api.save(
          prepare(value.form, value.basis),
          value.basis.revision_token,
        );
        setConflict(null);
        onSaved?.();
        return { ...value, basis };
      } catch (error) {
        if (
          error instanceof ConfigApiError &&
          error.status === 409 &&
          error.current
        ) {
          setConflict(error.current as CalibrationEditorView);
          // The catalog is an API baseline, not an editable form. Review it
          // explicitly rather than feeding it to generic field-level rebasing.
          throw new Error(
            'Calibration changed elsewhere. Review the saved calibration before retrying. Your edits are kept.',
          );
        }
        throw error;
      }
    },
  });
  const value = draft.value!;
  const field = <K extends keyof T>(
    name: K,
  ): [T[K], (next: T[K] | ((current: T[K]) => T[K])) => void] => [
    value.form[name],
    (next) =>
      draft.change((current) => ({
        ...current,
        form: {
          ...current.form,
          [name]:
            typeof next === 'function'
              ? (next as (current: T[K]) => T[K])(current.form[name])
              : next,
        },
      })),
  ];
  return {
    ...draft,
    field,
    value,
    conflictCatalog: conflict,
    reviewLatest: () => {
      if (conflict) draft.patch({ basis: conflict });
      setConflict(null);
    },
    discard: () => {
      setConflict(null);
      draft.discard();
    },
  };
}
