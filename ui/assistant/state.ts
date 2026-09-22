import { atom } from 'jotai';

import type { AssistantAction } from '@/bindings/AssistantAction';
import type { AssistantActionChangeResult } from '@/bindings/AssistantActionChangeResult';
import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import type { AssistantPlan } from '@/bindings/AssistantPlan';
import type { AssistantUsage } from '@/bindings/AssistantUsage';
import { upsertAssistantAttachment } from '@/lib/assistant-diff';

export type AssistantPanelState = {
  open: boolean;
  attachments: AssistantAttachment[];
};

/**
 * One turn in the assistant thread. The thread lives in memory only: it
 * survives panel close/reopen within the browser session and is never
 * persisted.
 */
export type AssistantThreadMessage =
  | {
      id: string;
      role: 'user';
      text: string;
      attachments: AssistantAttachment[];
    }
  | { id: string; role: 'assistant'; kind: 'plan'; plan: AssistantPlan }
  | {
      id: string;
      role: 'assistant';
      kind: 'action';
      action: AssistantAction;
      results?: AssistantActionChangeResult[];
    }
  | { id: string; role: 'assistant'; kind: 'error'; error: string };

let nextAssistantMessageId = 1;

export function createAssistantMessageId(): string {
  const id = `assistant-message-${nextAssistantMessageId}`;
  nextAssistantMessageId += 1;
  return id;
}

export const assistantPanelAtom = atom<AssistantPanelState>({
  open: false,
  attachments: [],
});

export const assistantThreadAtom = atom<AssistantThreadMessage[]>([]);

/** Usage reported by the last completed turn, for the context meter. */
export const assistantUsageAtom = atom<AssistantUsage | null>(null);

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

/** Closing keeps the thread and attachments so the panel resumes where it left off. */
export const closeAssistantPanelAtom = atom(null, (_get, set) => {
  set(assistantPanelAtom, (current) => ({ ...current, open: false }));
});

export const setAssistantAttachmentsAtom = atom(
  null,
  (get, set, attachments: AssistantAttachment[]) => {
    set(assistantPanelAtom, { ...get(assistantPanelAtom), attachments });
  },
);

/** Clear the conversation, context meter, and attachments. */
export const newAssistantThreadAtom = atom(null, (get, set) => {
  set(assistantThreadAtom, []);
  set(assistantUsageAtom, null);
  set(assistantPanelAtom, { ...get(assistantPanelAtom), attachments: [] });
});
