import { useEffect } from 'react';

/**
 * Warns on tab close/reload while an editor has unsaved changes. Overlay
 * close attempts are guarded separately by ResponsiveOverlay's `guard` prop.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
