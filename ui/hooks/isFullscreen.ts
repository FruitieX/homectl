import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useEffect, useRef, useState } from 'react';

// The display's layout preference is separate from browser fullscreen state.
// Read synchronously so the navigation does not flash on document reload.
const fullscreenAtom = atomWithStorage<boolean>(
  'fullscreen',
  false,
  undefined,
  { getOnInit: true },
);
export const useIsFullscreen = () => useAtom(fullscreenAtom);

/** Mount once in the header. Fullscreen operations acknowledge browser results. */
export function useFullscreenControls() {
  const [enabled, setEnabled] = useIsFullscreen();
  const [browserFullscreen, setBrowserFullscreen] = useState(() =>
    Boolean(document.fullscreenElement),
  );
  const [restoreNeeded, setRestoreNeeded] = useState(false);
  const [error, setError] = useState('');
  const requesting = useRef(false);
  const request = useCallback(async () => {
    setError('');
    // Chromium launched with --kiosk is already fullscreen at the window level.
    // Entering DOM fullscreen on top introduces a second mode navigation can drop.
    if (
      requesting.current ||
      document.fullscreenElement ||
      !document.documentElement.requestFullscreen ||
      matchMedia('(display-mode: fullscreen)').matches
    )
      return;
    requesting.current = true;
    try {
      await document.documentElement.requestFullscreen({
        navigationUI: 'hide',
      });
      setRestoreNeeded(false);
    } catch {
      // Navigation normally requires a new gesture. Keep the saved layout.
      setRestoreNeeded(true);
    } finally {
      requesting.current = false;
    }
  }, []);
  useEffect(() => {
    const changed = () => {
      const active = Boolean(document.fullscreenElement);
      setBrowserFullscreen(active);
      if (!active && !matchMedia('(display-mode: fullscreen)').matches)
        setRestoreNeeded(true);
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (enabled && !document.fullscreenElement) void request();
  }, [enabled, request]);
  const toggle = async () => {
    setError('');
    if (enabled) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        setEnabled(false);
        setRestoreNeeded(false);
      } catch {
        setError('Could not exit fullscreen. Try again or use Escape.');
      }
    } else {
      setEnabled(true);
      await request();
    }
  };
  return {
    enabled,
    toggle,
    restore: request,
    restoreNeeded: enabled && restoreNeeded && !browserFullscreen,
    error,
  };
}
