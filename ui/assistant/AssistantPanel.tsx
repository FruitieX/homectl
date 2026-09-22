import { Loader2, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import type { AssistantPlan } from '@/bindings/AssistantPlan';
import { useAssistantPlan, useAssistantStatus } from '@/hooks/useAssistant';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Textarea } from '@/ui/primitives/textarea';

import { AttachmentChip } from './AttachmentChip';
import { PlanCard } from './PlanCard';
import {
  assistantPanelAtom,
  closeAssistantPanelAtom,
  setAssistantAttachmentsAtom,
} from './state';

type PanelMessage =
  | {
      id: string;
      role: 'user';
      text: string;
      attachments: AssistantAttachment[];
    }
  | { id: string; role: 'assistant'; plan: AssistantPlan }
  | { id: string; role: 'assistant'; error: string };

const suggestionPrompts = [
  'Turn off all lights when nobody is home',
  'Add a scene for movie night',
  'Create a room for the upstairs hallway',
];

export function AssistantPanel() {
  const state = useAtomValue(assistantPanelAtom);
  const closePanel = useSetAtom(closeAssistantPanelAtom);
  const setAttachments = useSetAtom(setAssistantAttachmentsAtom);
  const { enabled, model } = useAssistantStatus();
  const planMutation = useAssistantPlan();
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nextMessageId = useRef(1);

  useEffect(() => {
    if (!state.open) {
      setMessages([]);
      setPrompt('');
    }
  }, [state.open]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, planMutation.isPending]);

  const appendMessage = (message: PanelMessage) => {
    setMessages((current) => [...current, message]);
  };

  const createMessageId = () => {
    const id = `assistant-message-${nextMessageId.current}`;
    nextMessageId.current += 1;
    return id;
  };

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || planMutation.isPending) {
      return;
    }
    const attachments = state.attachments;
    appendMessage({
      id: createMessageId(),
      role: 'user',
      text: trimmed,
      attachments,
    });
    setPrompt('');
    planMutation.mutate(
      { prompt: trimmed, attachments },
      {
        onSuccess: (plan) => {
          appendMessage({
            id: createMessageId(),
            role: 'assistant',
            plan,
          });
          setAttachments([]);
        },
        onError: (error) => {
          const message =
            error instanceof Error
              ? error.message
              : 'The assistant request failed';
          appendMessage({
            id: createMessageId(),
            role: 'assistant',
            error: message,
          });
        },
      },
    );
  };

  const removeAttachment = (attachment: AssistantAttachment) => {
    setAttachments(
      state.attachments.filter(
        (entry) =>
          !(entry.kind === attachment.kind && entry.id === attachment.id),
      ),
    );
  };

  const discardMessage = (id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  };

  return (
    <ResponsiveOverlay
      open={state.open}
      onOpenChange={(next) => {
        if (!next) {
          closePanel();
        }
      }}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4" />
          AI assistant
        </span>
      }
      description="Describe a change. The assistant proposes a plan you review and accept before anything is written."
      className="h-[min(82dvh,44rem)] max-w-3xl"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 px-5 pb-5 md:px-0 md:pb-0">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
        >
          {messages.length === 0 ? (
            <div className="space-y-3 rounded-3xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'Ask for a new automation, a change to an existing entity, or attach one from the page you came from.'
                  : 'The assistant is not configured on this server. Set the provider base URL and model under Settings → Assistant.'}
              </p>
              {enabled ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestionPrompts.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal py-1.5 text-xs"
                      onClick={() => setPrompt(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <div
                  key={message.id}
                  className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5"
                >
                  {message.attachments.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {message.attachments.map((attachment) => (
                        <AttachmentChip
                          key={`${attachment.kind}:${attachment.id ?? ''}`}
                          attachment={attachment}
                        />
                      ))}
                    </div>
                  ) : null}
                  <p className="rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {message.text}
                  </p>
                </div>
              );
            }
            if ('error' in message) {
              return (
                <Alert key={message.id} variant="destructive">
                  <AlertDescription>{message.error}</AlertDescription>
                </Alert>
              );
            }
            return (
              <PlanCard
                key={message.id}
                plan={message.plan}
                onDiscard={() => discardMessage(message.id)}
              />
            );
          })}

          {planMutation.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Building a plan…
            </div>
          ) : null}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border pt-3">
          {state.attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {state.attachments.map((attachment) => (
                <AttachmentChip
                  key={`${attachment.kind}:${attachment.id ?? ''}`}
                  attachment={attachment}
                  onRemove={removeAttachment}
                />
              ))}
            </div>
          ) : null}
          <Textarea
            rows={2}
            value={prompt}
            placeholder="Describe the change, for example “dim the office lights at sunset”"
            disabled={!enabled || planMutation.isPending}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.7rem] text-muted-foreground">
              {model
                ? `Using ${model}. Nothing is written before you apply.`
                : 'Nothing is written before you apply.'}
            </p>
            <Button
              type="button"
              disabled={!enabled || !prompt.trim() || planMutation.isPending}
              onClick={submit}
            >
              {planMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send />
              )}
              Plan
            </Button>
          </div>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}
