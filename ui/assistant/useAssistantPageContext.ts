import { useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';

import type { AssistantAttachment } from '@/bindings/AssistantAttachment';

import { assistantPageContextAtom } from './state';

/**
 * Publish the entity the current page has in focus so the AppBar Ask AI
 * button attaches it. Pass the most specific open entity (a device detail, an
 * editor) or a kind-only attachment for a list page. The context clears when
 * the component unmounts.
 */
export function useAssistantPageContext(
  attachment?: AssistantAttachment | null,
): void {
  const setContext = useSetAtom(assistantPageContextAtom);
  const latest = useRef<AssistantAttachment | null>(attachment ?? null);
  latest.current = attachment ?? null;
  const key = attachment
    ? `${attachment.kind}:${attachment.id ?? ''}:${attachment.label ?? ''}`
    : '';

  useEffect(() => {
    setContext(latest.current);
    return () => setContext(null);
  }, [key, setContext]);
}
