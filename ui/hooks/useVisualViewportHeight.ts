import { useEffect, useState } from 'react';

/**
 * Height of the visual viewport in pixels, or null when it is unavailable.
 *
 * iOS does not shrink the layout viewport when the software keyboard opens, so
 * `dvh`-sized sheets keep their full height and leave a large dead area between
 * the content and the keyboard. Overlays that host a text field should size
 * themselves with this value while `visualViewport` is available.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : (window.visualViewport?.height ?? null),
  );

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const update = () => setHeight(viewport.height);
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}

/** CSS custom property consumed by overlays that must follow the keyboard. */
export const visualViewportHeightVar = '--app-visual-viewport-height';

/**
 * Binds the visual viewport height to a CSS custom property on `document.body`
 * so stylesheets can use it without re-rendering on every keyboard frame.
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
