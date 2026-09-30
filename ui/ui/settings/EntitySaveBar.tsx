import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import {
  entityDraftStore,
  changedDraftPaths,
  draftPathValue,
  parseDraftPath,
} from '@/lib/entityDraft';
import { describeConflictValue } from '@/lib/conflictPresentation';
import type { EntityDraftApi } from '@/hooks/useEntityDraft';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/primitives/dialog';

export function EntitySaveBar<T extends object>({
  draft,
  createLabel,
  sensitivePaths = [],
  inline = false,
  compact = false,
  disabled = false,
  saveDisabled = false,
}: {
  draft: EntityDraftApi<T>;
  createLabel?: string;
  sensitivePaths?: readonly string[];
  inline?: boolean;
  /** Editor document bar: always show Saved/Save while retaining conflict review. */
  compact?: boolean;
  disabled?: boolean;
  saveDisabled?: boolean;
}) {
  const [review, setReview] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById('settings-save-slot'));
  }, []);
  if (
    (!inline && !host) ||
    (!compact &&
      !draft.dirty &&
      !createLabel &&
      !draft.saving &&
      !draft.conflict &&
      !draft.errors.length)
  )
    return null;
  const entry = draft.entry;
  const content = (
    <div
      className="settings-savebar"
      aria-label="Save configuration"
      data-dirty={draft.dirty}
    >
      {draft.errors.length > 0 && (
        <div className="settings-save-errors" role="alert">
          {draft.errors.map((error, i) => (
            <p
              key={i}
              id={`draft-error-${encodeURIComponent(`${draft.key}/${error.field}`)}`}
            >
              {error.message}
            </p>
          ))}
        </div>
      )}
      {draft.conflict && (
        <p className="settings-save-errors" role="alert">
          This item changed elsewhere. Review the saved values before saving.
        </p>
      )}
      <div className="settings-save-actions">
        <div className="min-w-0 flex-1 text-xs">
          <strong>
            {draft.saving
              ? 'Saving…'
              : createLabel
                ? 'New configuration'
                : draft.dirty
                  ? 'Unsaved changes'
                  : 'Saved'}
          </strong>
          <p className="truncate text-muted-foreground">{entry?.label}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={
            draft.saving ||
            disabled ||
            (compact && !draft.dirty && !draft.conflict)
          }
          onClick={draft.discard}
        >
          Discard
        </Button>
        {draft.conflict ? (
          <Button
            type="button"
            disabled={draft.saving || disabled}
            onClick={() => {
              setKeep(entry ? changedDraftPaths(entry) : []);
              setReview(true);
            }}
          >
            Review changes
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              draft.saving ||
              disabled ||
              saveDisabled ||
              (compact && !draft.dirty && !createLabel)
            }
            onClick={() => void draft.save()}
          >
            {draft.saving && <LoaderCircle className="size-4 animate-spin" />}
            {createLabel ??
              (draft.errors.length
                ? 'Retry save'
                : compact
                  ? 'Save'
                  : 'Save changes')}
          </Button>
        )}
      </div>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
            <DialogDescription>
              Select the edits you want to keep. Other fields use the latest
              saved version. Your reviewed draft still needs Save.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50dvh] space-y-4 overflow-auto">
            {entry &&
              changedDraftPaths(entry).map((field) => (
                <label
                  key={field}
                  className="block rounded-md border border-border p-3 text-sm"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={keep.includes(field)}
                      onChange={(e) =>
                        setKeep((current) =>
                          e.target.checked
                            ? [...current, field]
                            : current.filter((key) => key !== field),
                        )
                      }
                    />
                    Keep my{' '}
                    {parseDraftPath(field)
                      .map((part) => part.replaceAll('_', ' '))
                      .join(' / ')}
                  </span>
                  <span className="mt-2 block whitespace-pre-wrap break-all text-xs text-muted-foreground">
                    Saved:{' '}
                    {describeConflictValue(
                      draftPathValue(entry.latest, field),
                      field,
                      sensitivePaths,
                    )}
                  </span>
                  <span className="mt-1 block break-words text-xs">
                    My draft:{' '}
                    {describeConflictValue(
                      draftPathValue(entry.value, field),
                      field,
                      sensitivePaths,
                    )}
                  </span>
                </label>
              ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setReview(false)}>
              Keep editing
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                draft.discard();
                setReview(false);
              }}
            >
              Use latest saved
            </Button>
            <Button
              onClick={() => {
                entityDraftStore.rebase(draft.key, keep);
                setReview(false);
              }}
            >
              Use reviewed choices
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
  return inline ? content : createPortal(content, host!);
}
