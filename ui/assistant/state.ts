import { atom } from 'jotai';

import type { AssistantAction } from '@/bindings/AssistantAction';
import type { AssistantActionChangeResult } from '@/bindings/AssistantActionChangeResult';
import type { AssistantOperationResult } from '@/bindings/AssistantOperationResult';
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
  | { id: string; role: 'assistant'; kind: 'text'; text: string }
  | {
      id: string;
      role: 'assistant';
      kind: 'plan';
      plan: AssistantPlan;
      /** Restored from a saved thread: shown as a record, not applicable. */
      historical?: boolean;
      /** Results of applying the plan, restored with the thread. */
      results?: AssistantOperationResult[];
      /** Operations the user applied, restored with the thread. */
      acceptedOperationIds?: string[];
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'action';
      action: AssistantAction;
      results?: AssistantActionChangeResult[];
      /** Restored from a saved thread: shown as a record, not applicable. */
      historical?: boolean;
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

/**
 * Context published by the active page (for example the entity open in a
 * detail overlay). The AppBar Ask AI button attaches it automatically so
 * pages do not need their own assistant entry points.
 */
export const assistantPageContextAtom = atom<AssistantAttachment | null>(null);

export const assistantThreadAtom = atom<AssistantThreadMessage[]>([]);

/** Persisted thread id of the active conversation, when one exists. */
export const assistantThreadIdAtom = atom<string | null>(null);

/** Display name of the active conversation. */
export const assistantThreadNameAtom = atom<string | null>(null);

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
  set(assistantThreadIdAtom, null);
  set(assistantThreadNameAtom, null);
  set(assistantUsageAtom, null);
  set(assistantPanelAtom, { ...get(assistantPanelAtom), attachments: [] });
});
