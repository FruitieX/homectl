import { atom } from 'jotai';

import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import { upsertAssistantAttachment } from '@/lib/assistant-diff';

export type AssistantPanelState = {
  open: boolean;
  attachments: AssistantAttachment[];
};

export const assistantPanelAtom = atom<AssistantPanelState>({
  open: false,
  attachments: [],
});

/**
 * Open the assistant panel, optionally preloading an entity attachment.
 * Attachments are ephemeral and never persisted.
 */
export const openAssistantPanelAtom = atom(
  null,
  (get, set, attachment?: AssistantAttachment) => {
    const current = get(assistantPanelAtom);
    set(assistantPanelAtom, {
      open: true,
      attachments: attachment
        ? upsertAssistantAttachment(current.attachments, attachment)
        : current.attachments,
    });
  },
);

export const closeAssistantPanelAtom = atom(null, (_get, set) => {
  set(assistantPanelAtom, { open: false, attachments: [] });
});

export const setAssistantAttachmentsAtom = atom(
  null,
  (get, set, attachments: AssistantAttachment[]) => {
    set(assistantPanelAtom, { ...get(assistantPanelAtom), attachments });
  },
);
