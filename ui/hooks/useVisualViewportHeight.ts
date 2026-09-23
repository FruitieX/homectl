import { useEffect, useState } from 'react';

import { resolveVisualViewportHeight } from '@/lib/visualViewport';

/** How often the viewport is re-read while a text field has focus. */
const POLL_INTERVAL_MS = 250;

/**
 * How long to keep re-reading after the last text field loses focus: the
 * keyboard dismiss animation takes a few frames, and a final measurement taken
 * too early leaves the sheet sized for a keyboard that is already gone.
 */
const SETTLE_MS = 900;

function isTextEntry(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function readHeight(): number | null {
  const viewport = window.visualViewport;
  if (!viewport) {
    return null;
  }
  return resolveVisualViewportHeight({
    layoutHeight: window.innerHeight,
    visualHeight: viewport.height,
  });
}

/**
 * Height of the visual viewport in pixels while the software keyboard shrinks
 * it, or null when the overlay should use the full dynamic viewport height.
 *
 * iOS does not shrink the layout viewport when the software keyboard opens, so
 * `dvh`-sized sheets keep their full height and leave a large dead area between
 * the content and the keyboard. Overlays that host a text field should size
 * themselves with this value while `visualViewport` is available.
 *
 * Dismissals are not reliably reported: tapping a suggestion can hide the
 * keyboard without blurring the field and without a resize event, which used to
 * leave a keyboard-sized sheet with an empty backdrop below it. The height is
 * therefore re-read on every relevant event and polled while a text field has
 * focus, so a stale height cannot survive the keyboard.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : readHeight(),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    let poll: number | null = null;
    let settle: number | null = null;

    const update = () => setHeight(readHeight());

    const stopPolling = () => {
      if (poll !== null) {
        window.clearInterval(poll);
        poll = null;
      }
    };

    const startPolling = () => {
      if (settle !== null) {
        window.clearTimeout(settle);
        settle = null;
      }
      if (poll === null) {
        poll = window.setInterval(update, POLL_INTERVAL_MS);
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (isTextEntry(event.target as Element | null)) {
        startPolling();
      }
    };

    const onFocusOut = () => {
      update();
      stopPolling();
      if (settle !== null) {
        window.clearTimeout(settle);
      }
      // Keep watching through the dismiss animation, then let the value settle.
      poll = window.setInterval(update, POLL_INTERVAL_MS);
      settle = window.setTimeout(() => {
        stopPolling();
        settle = null;
        update();
      }, SETTLE_MS);
    };

    update();
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      stopPolling();
      if (settle !== null) {
        window.clearTimeout(settle);
      }
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return height;
}

/** CSS custom property consumed by overlays that must follow the keyboard. */
export const visualViewportHeightVar = '--app-visual-viewport-height';

/**
 * Binds the visual viewport height to a CSS custom property on the document
 * element so stylesheets can use it without re-rendering on every keyboard
 * frame. The property is removed when there is no keyboard, which leaves
 * overlays on their `dvh` fallback.
 */
export function useVisualViewportCssVariable(): void {
  const height = useVisualViewportHeight();

  useEffect(() => {
    const root = document.documentElement;
    if (height === null) {
      root.style.removeProperty(visualViewportHeightVar);
      return;
    }
    root.style.setProperty(visualViewportHeightVar, `${Math.round(height)}px`);
  }, [height]);
}
