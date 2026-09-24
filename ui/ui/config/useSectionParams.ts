import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type SectionParams = {
  /** `?section=<name>` — the section to expand and focus. */
  activeSection: string | null;
  /** `?target=<key>` — a nested target or step inside that section. */
  target: string | null;
  /** Expand a section (and optionally focus a nested target) in the URL. */
  openSection: (
    name: string | null,
    options?: { target?: string | null },
  ) => void;
};

/**
 * Detail pages keep expansion in the URL so a section can be linked to,
 * survives a refresh, and is what “Open item” links from diagnostics and
 * history point at. Writes use replace: Back leaves the page (to the list it
 * came from) instead of walking through section states.
 */
export function useSectionParams(): SectionParams {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeSection = searchParams.get('section');
  const target = searchParams.get('target');

  const openSection = useCallback(
    (name: string | null, options?: { target?: string | null }) => {
      const next = new URLSearchParams(searchParams);
      if (name) {
        next.set('section', name);
      } else {
        next.delete('section');
      }
      const nextTarget = options?.target;
      if (nextTarget) {
        next.set('target', nextTarget);
      } else if (options && 'target' in options) {
        next.delete('target');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { activeSection, target, openSection };
}
