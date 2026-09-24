import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

import { useUnsavedChanges } from '@/hooks/unsavedChanges';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';

export type DirtyGuardOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * Route-navigation blocking for dirty detail pages, on top of the existing tab
 * close guard. The prompt appears once per navigation attempt, only when
 * something actually changed, and Cancel keeps the user (and the draft) where
 * they are.
 */
export function useDirtyNavigationGuard(
  dirty: boolean,
  {
    title = 'Discard unsaved changes?',
    description = 'This section has changes that were not saved yet.',
    confirmLabel = 'Discard changes',
    cancelLabel = 'Keep editing',
  }: DirtyGuardOptions = {},
) {
  useUnsavedChanges(dirty);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      `${currentLocation.pathname}${currentLocation.search}` !==
        `${nextLocation.pathname}${nextLocation.search}`,
  );

  const prompting = useRef(false);
  const resolved = useRef(false);

  const state = blocker.state;
  const proceed = blocker.proceed;
  const reset = blocker.reset;

  useEffect(() => {
    if (state !== 'blocked' || prompting.current) return;
    prompting.current = true;
    void confirmDialog({
      title,
      description,
      confirmLabel,
      cancelLabel,
      destructive: true,
    }).then((confirmed) => {
      prompting.current = false;
      resolved.current = confirmed;
      if (confirmed) {
        proceed?.();
      } else {
        reset?.();
      }
    });
  }, [cancelLabel, confirmLabel, description, proceed, reset, state, title]);

  return { blocked: state === 'blocked', resolved: resolved.current };
}
