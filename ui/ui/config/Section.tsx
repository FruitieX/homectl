import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { Button } from '@/ui/primitives/button';
import { StatusRegion, useStatusAnnouncements } from '@/ui/config/StatusRegion';
import { useSectionEditCoordinator } from '@/ui/config/sectionEditCoordinator';
import type { SectionEditorApi } from '@/ui/config/useSectionEditor';

export type SectionProps<T extends object> = {
  /** Stable id: becomes the DOM ids and the `?section=` value. */
  id: string;
  title: ReactNode;
  /** One-line state summary; stays visible when the section is collapsed. */
  summary?: ReactNode;
  /** e.g. “Customized”, “Needs attention”. */
  badge?: ReactNode;
  /** Header-level extras such as “See activity”. */
  actions?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: SectionEditorApi<T>;
  /** Read-only content shown until the reader chooses Change. */
  readView: ReactNode;
  /** Fields shown in place of the read view while editing. */
  renderEditor: (api: SectionEditorApi<T>) => ReactNode;
  /** Label of the single action that starts editing this section. */
  changeLabel?: string;
  /** Set false for sections with nothing to persist. */
  editable?: boolean;
  /** When set, Change is disabled and the reason is exposed. */
  editDisabledReason?: string | null;
  /** Field key -> human label, used by the error summary. */
  fieldLabels?: Record<string, string>;
  /** Focus this heading when the page opens the section from the URL. */
  headingRef?: Ref<HTMLHeadingElement>;
  danger?: boolean;
  className?: string;
};

/**
 * One section of a detail page. Opening it shows the saved values and current
 * evidence first; a single **Change** action then replaces that read content
 * with the editor. Only the section being edited shows Save and Cancel, and a
 * page keeps at most one editor open at a time (see SectionEditProvider).
 */
export function Section<T extends object>({
  id,
  title,
  summary,
  badge,
  actions,
  open,
  onOpenChange,
  api,
  readView,
  renderEditor,
  changeLabel = 'Change',
  editable = true,
  editDisabledReason = null,
  fieldLabels,
  headingRef,
  danger = false,
  className,
}: SectionProps<T>) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const { status, announce } = useStatusAnnouncements();
  const coordinator = useSectionEditCoordinator();

  const titleText = typeof title === 'string' ? title : 'This section';

  // Tell the page-level coordinator what this section is doing, so another
  // section can ask before it takes over the single editor slot.
  useEffect(() => {
    coordinator?.report(id, {
      editing: api.editing,
      dirty: api.dirty,
      saving: api.saving,
      save: api.save,
      cancel: api.cancel,
      title: titleText,
    });
  });

  // Return focus to the Change action after Save or Cancel.
  useEffect(() => {
    if (!restoreFocus || api.editing) return;
    setRestoreFocus(false);
    changeButtonRef.current?.focus();
  }, [api.editing, restoreFocus]);

  const focusField = useCallback((field: string) => {
    const node = sectionRef.current?.querySelector<HTMLElement>(
      `[data-field="${CSS.escape(field)}"]`,
    );
    node?.focus();
  }, []);

  const startEditing = useCallback(() => {
    if (coordinator) {
      coordinator.requestBegin(id, api.begin);
    } else {
      api.begin();
    }
  }, [api, coordinator, id]);

  const finishEditing = useCallback(
    async (mode: 'save' | 'cancel') => {
      if (mode === 'cancel') {
        if (api.dirty) {
          const confirmed = await confirmDialog({
            title: `Discard changes to ${titleText}?`,
            description:
              'The fields you changed here go back to their saved values.',
            confirmLabel: 'Discard changes',
            cancelLabel: 'Keep editing',
          });
          if (!confirmed) return;
        }
        api.cancel();
        setRestoreFocus(true);
        announce('Changes discarded', 'info');
        return;
      }
      const wasDirty = api.dirty;
      const saved = await api.save();
      if (saved) {
        setRestoreFocus(true);
        announce(wasDirty ? 'Changes saved' : 'Saved', 'success');
      }
    },
    [announce, api, titleText],
  );

  const headingId = `${id}-heading`;
  const bodyId = `${id}-body`;
  const invalid = api.errors.filter((entry) => entry.field !== 'section');
  const saveError = api.errors.find((entry) => entry.field === 'section');

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className={cn(
        'rounded-2xl border border-border/70 bg-card shadow-sm',
        danger && 'border-destructive/40',
        className,
      )}
    >
      {/* The whole header is the control: title, badge, and the one-line
          summary are all inside one button, so tapping anywhere that looks like
          the section expands it. Actions stay outside it. */}
      <div className="flex items-stretch justify-between gap-2">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className={`min-w-0 flex-1 rounded-sm text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            danger ? 'text-destructive' : 'text-foreground'
          }`}
        >
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex min-h-11 w-full cursor-pointer flex-col justify-center gap-1 rounded-2xl p-4 text-left transition hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
          >
            <span className="flex w-full items-center gap-2">
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                  open && 'rotate-90',
                )}
              />
              <span className="min-w-0 break-words">{title}</span>
              {badge ? <span className="shrink-0">{badge}</span> : null}
            </span>
            {summary ? (
              <span className="block truncate pl-[1.375rem] text-xs leading-5 font-normal text-muted-foreground">
                {summary}
              </span>
            ) : null}
          </button>
        </h2>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2 pr-4 sm:pr-5">
            {actions}
          </div>
        ) : null}
      </div>

      {open ? (
        <div
          id={bodyId}
          role="group"
          aria-label={typeof title === 'string' ? title : undefined}
          className="min-w-0 space-y-4 border-t border-border/70 p-4 sm:p-5"
        >
          {api.editing ? (
            <>
              {api.conflict ? (
                <div
                  role="alert"
                  className="space-y-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100"
                >
                  <p className="font-medium">
                    This changed elsewhere—review the latest version
                  </p>
                  <p className="text-xs leading-5">
                    Someone or something else saved these fields while you were
                    editing. Your draft is still here.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => {
                        api.reload();
                        setRestoreFocus(true);
                      }}
                    >
                      Reload the latest version
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={api.keepDraft}
                    >
                      Keep my draft
                    </Button>
                  </div>
                </div>
              ) : null}

              {api.errors.length > 0 ? (
                <div
                  role="alert"
                  tabIndex={-1}
                  className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="font-medium text-destructive">
                    {saveError ? 'Could not save' : 'Check these fields'}
                  </p>
                  {saveError ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {saveError.message}. Your draft is kept—press Retry save
                      to try again.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {invalid.map((entry) => (
                        <li key={`${entry.field}-${entry.message}`}>
                          <button
                            type="button"
                            onClick={() => focusField(entry.field)}
                            className="text-left text-xs font-medium text-destructive underline underline-offset-2"
                          >
                            {fieldLabels?.[entry.field] ?? entry.field}:{' '}
                            {entry.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {renderEditor(api)}

              <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border/70 bg-background/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:pb-0 sm:backdrop-blur-none">
                <Button
                  type="button"
                  onClick={() => void finishEditing('save')}
                  disabled={api.saving}
                  aria-busy={api.saving}
                >
                  {api.saving
                    ? 'Saving…'
                    : api.errors.length > 0
                      ? 'Retry save'
                      : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={api.saving}
                  onClick={() => void finishEditing('cancel')}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {readView}
              {editable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    ref={changeButtonRef}
                    id={`${id}-change`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={startEditing}
                    disabled={editDisabledReason !== null}
                    aria-describedby={
                      editDisabledReason ? `${id}-change-disabled` : undefined
                    }
                  >
                    {changeLabel}
                  </Button>
                  {editDisabledReason ? (
                    <p
                      id={`${id}-change-disabled`}
                      className="text-xs text-muted-foreground"
                    >
                      {editDisabledReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <StatusRegion
                message={status?.message ?? null}
                tone={status?.tone ?? 'info'}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
