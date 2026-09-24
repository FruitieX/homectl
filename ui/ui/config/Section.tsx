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
import { Button } from '@/ui/primitives/button';
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
  /** Read-only content shown when the section is not being edited. */
  readView: ReactNode;
  /** Fields shown in place of the read view while editing. */
  renderEditor: (api: SectionEditorApi<T>) => ReactNode;
  editLabel?: string;
  /** Set false for sections with nothing to persist. */
  editable?: boolean;
  /** When set, Edit is disabled and the reason is exposed. */
  editDisabledReason?: string | null;
  /** Field key -> human label, used by the error summary. */
  fieldLabels?: Record<string, string>;
  /** Focus this heading when the page opens the section from the URL. */
  headingRef?: Ref<HTMLHeadingElement>;
  danger?: boolean;
  className?: string;
};

/**
 * One section of a detail page: a heading that discloses a read view, and an
 * Edit action *inside* the expanded body (never nested in the disclosure
 * trigger). Editing replaces the read view in place; Save and Cancel are
 * explicit, validation errors get a summary that focuses the first bad field,
 * and a server-side change to the same fields is surfaced before it can be
 * overwritten.
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
  editLabel = 'Edit',
  editable = true,
  editDisabledReason = null,
  fieldLabels,
  headingRef,
  danger = false,
  className,
}: SectionProps<T>) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);

  // Opening the section starts its draft: there is no Edit step to find.
  useEffect(() => {
    if (!open || !editable || api.editing) return;
    api.begin();
  }, [open, editable, api]);

  // Return focus to the section heading after Save or Discard.
  useEffect(() => {
    if (!restoreFocus || api.editing) return;
    setRestoreFocus(false);
    editButtonRef.current?.focus();
  }, [api.editing, restoreFocus]);

  const focusField = useCallback((field: string) => {
    const node = sectionRef.current?.querySelector<HTMLElement>(
      `[data-field="${CSS.escape(field)}"]`,
    );
    node?.focus();
  }, []);

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
      <div className="flex flex-col gap-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className={`min-w-0 rounded-sm text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              danger ? 'text-destructive' : 'text-foreground'
            }`}
          >
            <button
              type="button"
              onClick={() => onOpenChange(!open)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="flex w-full items-center gap-2 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                  open && 'rotate-90',
                )}
              />
              <span className="min-w-0">{title}</span>
              {badge ? <span className="shrink-0">{badge}</span> : null}
            </button>
          </h2>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {summary ? (
          <p className="pl-[1.375rem] text-xs leading-5 text-muted-foreground">
            {summary}
          </p>
        ) : null}
      </div>

      {open ? (
        <div
          id={bodyId}
          role="group"
          aria-label={typeof title === 'string' ? title : undefined}
          className="space-y-4 border-t border-border/70 p-4 sm:p-5"
        >
          {editable ? (
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

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void api.save()}
                  disabled={api.saving || !api.dirty}
                  aria-busy={api.saving}
                >
                  {api.saving
                    ? 'Saving…'
                    : api.errors.length > 0
                      ? 'Retry save'
                      : 'Save'}
                </Button>
                {api.dirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={api.saving}
                    onClick={() => {
                      api.cancel();
                      setRestoreFocus(true);
                    }}
                  >
                    Discard changes
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No changes yet
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {readView}
              {editDisabledReason ? (
                <p
                  id={`${id}-edit-disabled`}
                  className="mt-2 text-xs text-muted-foreground"
                >
                  {editDisabledReason}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
