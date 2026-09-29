import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const contexts = new Map<string, { top: number; focus: string | null }>();
/** Session-only scroll/focus restoration, shared by lists and entity editors. */
export function useSettingsPageContext() {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  const key = `${pathname}${search}`;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previous = contexts.get(key);
    let lastFocus = previous?.focus ?? null;
    const recordFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Tabs activate on focus. Saving the next tab under the outgoing URL
      // would activate it again during restoration, ping-ponging both URLs.
      if (target.closest('[role="tablist"]')) {
        lastFocus = null;
        return;
      }
      if (target.dataset.field)
        lastFocus = `[data-field="${CSS.escape(target.dataset.field)}"]`;
      else if (target.id) lastFocus = `#${CSS.escape(target.id)}`;
      else if (target instanceof HTMLAnchorElement)
        lastFocus = `a[href="${CSS.escape(target.getAttribute('href') ?? '')}"]`;
    };
    element.addEventListener('focusin', recordFocus);
    const frame = requestAnimationFrame(() => {
      if (!previous) return;
      if (previous.focus) {
        const target = element.querySelector<HTMLElement>(previous.focus);
        if (!target?.closest('[role="tablist"]'))
          target?.focus({ preventScroll: true });
      }
      element.scrollTop = previous.top;
    });
    return () => {
      cancelAnimationFrame(frame);
      contexts.set(key, { top: element.scrollTop, focus: lastFocus });
      // Bound session history without discarding unsaved entity drafts.
      if (contexts.size > 100) contexts.delete(contexts.keys().next().value!);
      element.removeEventListener('focusin', recordFocus);
    };
  }, [key]);
  return ref;
}
