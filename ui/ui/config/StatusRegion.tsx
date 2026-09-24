import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export type StatusTone = 'info' | 'success' | 'error';

/**
 * Polite status region for save results and other outcome announcements.
 * Screen readers hear it without stealing focus; sighted users get the same
 * sentence in a muted line.
 */
export function StatusRegion({
  message,
  tone = 'info',
  className,
}: {
  message: string | null;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'min-h-[1rem] text-xs leading-5',
        tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'error' && 'text-destructive',
        tone === 'info' && 'text-muted-foreground',
        className,
      )}
    >
      {message}
    </p>
  );
}

/** Status message state with automatic clearing after a few seconds. */
export function useStatusAnnouncements(clearAfterMs = 8000) {
  const [status, setStatus] = useState<{
    message: string;
    tone: StatusTone;
  } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(
    (message: string, tone: StatusTone = 'info') => {
      setStatus({ message, tone });
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setStatus(null), clearAfterMs);
    },
    [clearAfterMs],
  );

  const clear = useCallback(() => setStatus(null), []);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  return { status, announce, clear };
}
