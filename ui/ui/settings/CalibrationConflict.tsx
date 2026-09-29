import { useState } from 'react';
import type { CalibrationEditorView } from '@/hooks/useCalibrationEditor';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/primitives/dialog';

export function CalibrationConflict({
  before,
  current,
  onReview,
}: {
  before: CalibrationEditorView;
  current: CalibrationEditorView | null;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!current) return null;
  const changed = [
    ...new Set([...before.profiles, ...current.profiles].map((row) => row.id)),
  ].filter(
    (id) =>
      JSON.stringify(before.profiles.find((row) => row.id === id)) !==
      JSON.stringify(current.profiles.find((row) => row.id === id)),
  );
  const assignmentsChanged =
    JSON.stringify(before.assignments) !== JSON.stringify(current.assignments);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Review saved calibration
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Calibration changed elsewhere</DialogTitle>
            <DialogDescription>
              Review the saved changes. Continuing keeps your calibration edits
              and uses the latest saved values for the other channel. Save is
              still required.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50dvh] space-y-3 overflow-auto text-sm">
            {changed.map((id) => (
              <details key={id} className="rounded-md border border-border p-3">
                <summary>
                  {current.profiles.find((row) => row.id === id)?.name ??
                    before.profiles.find((row) => row.id === id)?.name}{' '}
                  · profile changed
                </summary>
                <p className="mt-2 font-medium">Before</p>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    before.profiles.find((row) => row.id === id) ?? null,
                    null,
                    2,
                  )}
                </pre>
                <p className="mt-2 font-medium">Saved now</p>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    current.profiles.find((row) => row.id === id) ?? null,
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
            {assignmentsChanged && (
              <details className="rounded-md border border-border p-3">
                <summary>Profile assignments changed</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    { before: before.assignments, saved: current.assignments },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            {JSON.stringify(before.legacy) !==
              JSON.stringify(current.legacy) && (
              <p>
                Existing per-device calibration changed. The latest saved
                calibration will supply the other channel.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep reviewing
            </Button>
            <Button
              onClick={() => {
                onReview();
                setOpen(false);
              }}
            >
              Keep my edits with these saved values
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
