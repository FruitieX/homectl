import { useState } from 'react';
import { toast } from 'sonner';
import { ConfigApiError } from '@/hooks/useConfig';
import {
  useCalibrationEditor,
  type CalibrationEdit,
  type CalibrationEditorView,
} from '@/hooks/useCalibrationEditor';

/**
 * Immediate calibration writes (assign, remove, rename, delete) for list and
 * summary views. Each write is checked against the loaded revision; a
 * conflict reloads the catalog and asks the person to try again.
 */
export function useCalibrationActions() {
  const editor = useCalibrationEditor();
  const [busy, setBusy] = useState(false);
  const run = async (
    edits: (view: CalibrationEditorView) => CalibrationEdit[],
    message: string,
    undo?: (view: CalibrationEditorView) => CalibrationEdit[],
  ) => {
    let view = editor.data;
    if (!view || busy) return false;
    const before = view;
    setBusy(true);
    try {
      for (const edit of edits(view))
        view = await editor.save(edit, view.revision_token);
      toast.success(
        message,
        undo
          ? {
              action: {
                label: 'Undo',
                onClick: () => {
                  void (async () => {
                    try {
                      let current = view!;
                      for (const edit of undo(before))
                        current = await editor.save(
                          edit,
                          current.revision_token,
                        );
                      toast.success('Change undone');
                    } catch (error) {
                      toast.error(errorText(error));
                    }
                  })();
                },
              },
            }
          : undefined,
      );
      return true;
    } catch (error) {
      if (error instanceof ConfigApiError && error.status === 409)
        void editor.refetch();
      toast.error(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { editor, busy, run };
}

function errorText(error: unknown) {
  if (error instanceof ConfigApiError && error.status === 409)
    return 'Calibration changed elsewhere. The latest version is loaded; try again.';
  return error instanceof Error ? error.message : 'Could not save calibration';
}

/** Writes that restore each light's previous profile assignment. */
export function restoreAssignments(
  view: CalibrationEditorView,
  deviceKeys: string[],
): CalibrationEdit[] {
  const byProfile = new Map<string | null, string[]>();
  for (const key of deviceKeys) {
    const id =
      view.assignments.find((row) => row.device_key === key)?.profile_id ??
      null;
    byProfile.set(id, [...(byProfile.get(id) ?? []), key]);
  }
  return [...byProfile].map(([profile_id, device_keys]) => ({
    profile_id,
    device_keys,
  }));
}
