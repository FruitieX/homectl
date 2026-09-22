import { Sparkles } from 'lucide-react';
import { useSetAtom } from 'jotai';
import type { ComponentProps } from 'react';

import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import { useAssistantStatus } from '@/hooks/useAssistant';
import { Button } from '@/ui/primitives/button';

import { openAssistantPanelAtom } from './state';

type AssistantButtonProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  attachment?: AssistantAttachment;
  label?: string;
  /** Renders just the icon; the label becomes the accessible name. */
  iconOnly?: boolean;
};

/**
 * "Ask AI" entry point. Renders nothing unless the deployment configured an
 * assistant provider, so callers can drop it into any toolbar.
 */
export function AssistantButton({
  attachment,
  label = 'Ask AI',
  iconOnly = false,
  children,
  ...props
}: AssistantButtonProps) {
  const openAssistant = useSetAtom(openAssistantPanelAtom);
  const { enabled } = useAssistantStatus();

  if (!enabled) {
    return null;
  }

  return (
    <Button
      type="button"
      aria-label={iconOnly ? label : undefined}
      onClick={() => openAssistant(attachment)}
      {...props}
    >
      <Sparkles />
      {iconOnly ? null : (children ?? label)}
    </Button>
  );
}
