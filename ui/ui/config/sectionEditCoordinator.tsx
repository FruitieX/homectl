import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';

/**
 * What a section reports about itself on every render, so the coordinator can
 * decide whether another section may start editing without waiting for state
 * to settle.
 */
export type SectionEditState = {
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<boolean>;
  cancel: () => void;
  /** Human name of the section, used in the dialog copy. */
  title: string;
};

type Pending = { id: string; begin: () => void };

type Coordinator = {
  report: (id: string, state: SectionEditState) => void;
  requestBegin: (id: string, begin: () => void) => void;
};

const SectionEditContext = createContext<Coordinator | null>(null);

/**
 * One section editor per detail page. A page can open as many read sections as
 * it likes; starting a second edit while the first has unsaved changes asks what
 * to do instead of silently dropping either draft.
 */
export function SectionEditProvider({ children }: { children: ReactNode }) {
  const states = useRef(new Map<string, SectionEditState>());
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback((id: string, state: SectionEditState) => {
    states.current.set(id, state);
  }, []);

  const activeEditingId = useCallback(() => {
    for (const [id, state] of states.current) {
      if (state.editing) return id;
    }
    return null;
  }, []);

  const requestBegin = useCallback(
    (id: string, begin: () => void) => {
      const otherId = activeEditingId();
      if (!otherId || otherId === id) {
        begin();
        return;
      }
      const other = states.current.get(otherId);
      if (!other || !other.dirty) {
        other?.cancel();
        begin();
        return;
      }
      setError(null);
      setPending({ id, begin });
    },
    [activeEditingId],
  );

  const otherTitle = useMemo(() => {
    const otherId = pending ? activeEditingId() : null;
    const state = otherId ? states.current.get(otherId) : null;
    return state?.title ?? 'Another section';
  }, [activeEditingId, pending]);

  const resolve = useCallback(
    async (mode: 'save' | 'discard') => {
      const otherId = activeEditingId();
      const other = otherId ? states.current.get(otherId) : null;
      if (!other) {
        setPending(null);
        return;
      }
      if (mode === 'discard') {
        other.cancel();
        const next = pending;
        setPending(null);
        setError(null);
        next?.begin();
        return;
      }
      setBusy(true);
      const saved = await other.save();
      setBusy(false);
      // A successful save clears the draft, which the section reports on its
      // next render; if it is still editing, the save failed and its own error
      // summary is the right place to look.
      if (!saved) {
        setError(
          'Could not save that section. Fix the fields there, or discard its changes.',
        );
        return;
      }
      const next = pending;
      setPending(null);
      setError(null);
      next?.begin();
    },
    [activeEditingId, pending],
  );

  const value = useMemo(
    () => ({ report, requestBegin }),
    [report, requestBegin],
  );

  return (
    <SectionEditContext.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your changes first?</DialogTitle>
            <DialogDescription>
              {otherTitle} has unsaved changes. Save them, discard them, or stay
              where you are.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPending(null)}
            >
              Stay
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void resolve('discard')}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void resolve('save')}
            >
              {busy ? 'Saving…' : 'Save and continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionEditContext.Provider>
  );
}

/** Null when no provider is present: sections then manage their own editing. */
export function useSectionEditCoordinator(): Coordinator | null {
  return useContext(SectionEditContext);
}
