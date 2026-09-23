import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import type { AssistantActionChangeResult } from '@/bindings/AssistantActionChangeResult';
import type { AssistantAttachment } from '@/bindings/AssistantAttachment';
import type { AssistantOperationResult } from '@/bindings/AssistantOperationResult';
import type { AssistantSearchResult } from '@/bindings/AssistantSearchResult';
import {
  useAssistantChat,
  useAssistantEntitySearch,
  useAssistantStatus,
  useAssistantThread,
  useAssistantThreads,
  useDeleteAssistantThread,
  useRecordAssistantThreadOutcome,
  type AssistantChatStatus,
} from '@/hooks/useAssistant';
import {
  buildAssistantHistory,
  contextUsagePercent,
  formatTokenCount,
  type AssistantHistoryEntry,
} from '@/lib/assistant-stream';
import { upsertAssistantAttachment } from '@/lib/assistant-diff';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Textarea } from '@/ui/primitives/textarea';

import { ActionCard } from './ActionCard';
import { AssistantEntityIcon, AttachmentChip } from './AttachmentChip';
import { PlanCard } from './PlanCard';
import {
  assistantPanelAtom,
  assistantThreadAtom,
  assistantThreadIdAtom,
  assistantThreadNameAtom,
  assistantUsageAtom,
  closeAssistantPanelAtom,
  createAssistantMessageId,
  newAssistantThreadAtom,
  setAssistantAttachmentsAtom,
  type AssistantThreadMessage,
} from './state';

const suggestionPrompts = [
  'Which lights are on right now?',
  'Turn off all lights when nobody is home',
  'Add a scene for movie night',
  'Dim the living room lights to 20%',
];

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Compact age label for persisted conversation timestamps (epoch millis). */
function formatThreadAge(updatedAtMs: number): string {
  const seconds = Math.round((updatedAtMs - Date.now()) / 1000);
  const minutes = Math.round(seconds / 60);
  if (Math.abs(seconds) < 60) {
    return relativeTime.format(seconds, 'second');
  }
  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, 'hour');
  }
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) {
    return relativeTime.format(days, 'day');
  }
  return relativeTime.format(Math.round(days / 30), 'month');
}

/** Compact text form of a thread turn for the provider history payload. */
function threadHistory(
  thread: AssistantThreadMessage[],
): AssistantHistoryEntry[] {
  const entries: AssistantHistoryEntry[] = [];
  for (const message of thread) {
    if (message.role === 'user') {
      entries.push({ role: 'user', content: message.text });
    } else if (message.kind === 'plan') {
      const operations = message.plan.operations
        .map(
          (operation) =>
            `- ${operation.op} ${operation.kind}: ${operation.label}`,
        )
        .join('\n');
      entries.push({
        role: 'assistant',
        content: `Plan: ${message.plan.summary}${operations ? `\n${operations}` : ''}`,
      });
    } else if (message.kind === 'action') {
      entries.push({
        role: 'assistant',
        content: `Action: ${message.action.summary}`,
      });
    } else if (message.kind === 'error') {
      entries.push({ role: 'assistant', content: `Error: ${message.error}` });
    } else {
      entries.push({ role: 'assistant', content: message.text });
    }
  }
  return entries;
}

export function AssistantPanel() {
  const state = useAtomValue(assistantPanelAtom);
  const closePanel = useSetAtom(closeAssistantPanelAtom);
  const setAttachments = useSetAtom(setAssistantAttachmentsAtom);
  const thread = useAtomValue(assistantThreadAtom);
  const setThread = useSetAtom(assistantThreadAtom);
  const threadId = useAtomValue(assistantThreadIdAtom);
  const setThreadId = useSetAtom(assistantThreadIdAtom);
  const threadName = useAtomValue(assistantThreadNameAtom);
  const setThreadName = useSetAtom(assistantThreadNameAtom);
  const usage = useAtomValue(assistantUsageAtom);
  const setUsage = useSetAtom(assistantUsageAtom);
  const startNewThread = useSetAtom(newAssistantThreadAtom);
  const { enabled, model } = useAssistantStatus();
  const { send, cancel, isStreaming } = useAssistantChat();
  const [prompt, setPrompt] = useState('');
  const [attachQuery, setAttachQuery] = useState('');
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState<AssistantChatStatus | null>(null);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  // Explicit "past conversations" view: reachable from a thread with the back
  // button, so browsing threads does not require closing the whole panel.
  const [browsingThreads, setBrowsingThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchQuery = attachQuery.trim();
  const searchResults = useAssistantEntitySearch(searchQuery);
  const searchHits: AssistantSearchResult[] = searchResults.data ?? [];
  // The past-threads list is the panel's home: shown when the user asked for
  // it, and whenever a fresh thread has nothing in it yet. A loaded thread
  // shows its messages until the user goes back.
  const showPastThreads = (browsingThreads || thread.length === 0) && !isStreaming;
  const threadsQuery = useAssistantThreads(state.open && showPastThreads);
  const pastThreads = threadsQuery.data ?? [];
  const deleteThread = useDeleteAssistantThread();
  const loadedThread = useAssistantThread(loadingThreadId);
  const recordThreadOutcome = useRecordAssistantThreadOutcome();

  useEffect(() => {
    const loaded = loadedThread.data;
    if (!loadingThreadId || !loaded) {
      return;
    }
    setThread(
      loaded.messages.map((message): AssistantThreadMessage => {
        if (message.role === 'user') {
          return {
            id: createAssistantMessageId(),
            role: 'user',
            text: message.content,
            attachments: [],
          };
        }
        // Turns that proposed a plan or a light-state action are stored with
        // that proposal, so a reopened thread can list what the assistant
        // suggested instead of only the one-line summary.
        const proposal = message.proposal;
        const outcome = message.outcome;
        if (proposal?.kind === 'plan') {
          return {
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'plan',
            plan: proposal.plan,
            historical: true,
            results: outcome?.kind === 'plan' ? outcome.results : undefined,
            acceptedOperationIds:
              outcome?.kind === 'plan'
                ? outcome.acceptedOperationIds
                : undefined,
          };
        }
        if (proposal?.kind === 'action') {
          return {
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'action',
            action: proposal.action,
            historical: true,
            results: outcome?.kind === 'action' ? outcome.results : undefined,
          };
        }
        return {
          id: createAssistantMessageId(),
          role: 'assistant',
          kind: 'text',
          text: message.content,
        };
      }),
    );
    setThreadId(loaded.id);
    setThreadName(loaded.name);
    setUsage(null);
    setLoadingThreadId(null);
    setBrowsingThreads(false);
  }, [
    loadedThread.data,
    loadingThreadId,
    setThread,
    setThreadId,
    setThreadName,
    setUsage,
  ]);

  useEffect(() => {
    if (loadedThread.isError && loadingThreadId) {
      setLoadingThreadId(null);
    }
  }, [loadedThread.isError, loadingThreadId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [thread, streamText, isStreaming, status]);

  const appendMessage = (message: AssistantThreadMessage) => {
    setThread((current) => [...current, message]);
  };

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) {
      return;
    }
    if (browsingThreads) {
      // Typing in the past-conversations list starts a new thread.
      startFreshThread();
      setBrowsingThreads(false);
    }
    const attachments = state.attachments;
    appendMessage({
      id: createAssistantMessageId(),
      role: 'user',
      text: trimmed,
      attachments,
    });
    setPrompt('');
    setAttachments([]);
    setStreamText('');
    setStatus({ phase: 'sending', message: 'Sending…' });
    const history = threadId
      ? undefined
      : buildAssistantHistory(threadHistory(thread));

    void send(
      {
        prompt: trimmed,
        attachments,
        history,
        threadId: threadId ?? undefined,
      },
      {
        onStatus: (next) => {
          setStatus(next);
          if ((next.attempt ?? 1) > 1) {
            setStreamText('');
          }
        },
        onDelta: (text) => setStreamText((current) => current + text),
        onUsage: (nextUsage) => setUsage(nextUsage),
        onPlan: (plan) => {
          appendMessage({
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'plan',
            plan,
          });
          setStreamText('');
          setStatus(null);
        },
        onAction: (action) => {
          appendMessage({
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'action',
            action,
          });
          setStreamText('');
          setStatus(null);
        },
        onAnswer: (text) => {
          appendMessage({
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'text',
            text,
          });
          setStreamText('');
          setStatus(null);
        },
        onThread: (next) => {
          setThreadId(next.id);
          setThreadName(next.name);
        },
        onError: (message) => {
          appendMessage({
            id: createAssistantMessageId(),
            role: 'assistant',
            kind: 'error',
            error: message,
          });
          setStreamText('');
          setStatus(null);
        },
      },
    );
  };

  const openThread = (id: string) => {
    if (isStreaming) {
      cancel();
    }
    setStreamText('');
    setStatus(null);
    setBrowsingThreads(false);
    setLoadingThreadId(id);
  };

  const removeThread = (id: string) => {
    if (id === threadId) {
      startNewThread();
    }
    deleteThread.mutate(id);
  };

  const stop = () => {
    cancel();
    setStreamText('');
    setStatus(null);
  };

  const startFreshThread = () => {
    if (isStreaming) {
      cancel();
    }
    startNewThread();
    setPrompt('');
    setAttachQuery('');
    setStreamText('');
    setStatus(null);
  };

  const removeAttachment = (attachment: AssistantAttachment) => {
    setAttachments(
      state.attachments.filter(
        (entry) =>
          !(entry.kind === attachment.kind && entry.id === attachment.id),
      ),
    );
  };

  const addAttachment = (hit: AssistantSearchResult) => {
    setAttachments(
      upsertAssistantAttachment(state.attachments, {
        kind: hit.kind,
        id: hit.id,
        label: hit.label,
      }),
    );
    setAttachQuery('');
  };

  const discardMessage = (id: string) => {
    setThread((current) => current.filter((message) => message.id !== id));
  };

  const recordActionResults = (
    id: string,
    results: AssistantActionChangeResult[],
  ) => {
    const message = thread.find((entry) => entry.id === id);
    if (
      threadId &&
      message?.role === 'assistant' &&
      message.kind === 'action'
    ) {
      recordThreadOutcome.mutate({
        threadId,
        proposalId: message.action.actionId,
        outcome: { kind: 'action', results },
      });
    }
    setThread((current) =>
      current.map((entry) =>
        entry.id === id &&
        entry.role === 'assistant' &&
        entry.kind === 'action'
          ? { ...entry, results, historical: true }
          : entry,
      ),
    );
  };

  const recordPlanResults = (
    id: string,
    planId: string,
    results: AssistantOperationResult[],
    acceptedOperationIds: string[],
  ) => {
    if (threadId) {
      recordThreadOutcome.mutate({
        threadId,
        proposalId: planId,
        outcome: { kind: 'plan', results, acceptedOperationIds },
      });
    }
    setThread((current) =>
      current.map((entry) =>
        entry.id === id && entry.role === 'assistant' && entry.kind === 'plan'
          ? { ...entry, results, acceptedOperationIds, historical: true }
          : entry,
      ),
    );
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
      description="Describe a change. The assistant proposes a plan or light change you review and apply before anything is written."
      className="h-[min(calc(var(--app-visual-viewport-height,100dvh)-4rem),44rem)] max-w-3xl"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 px-5 pb-5 md:px-0 md:pb-0">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {showPastThreads
              ? 'Past conversations'
              : threadName
                ? threadName
                : thread.length > 0
                  ? `${thread.length} message${thread.length === 1 ? '' : 's'} in this thread`
                  : 'New conversation'}
          </p>
          {showPastThreads ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              aria-label="Back to past conversations"
              onClick={() => setBrowsingThreads(true)}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          )}
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
        >
          {showPastThreads ? (
            loadingThreadId ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading conversation…
              </div>
            ) : pastThreads.length > 0 ? (
              <div className="space-y-1.5">
                <p className="px-1 text-xs text-muted-foreground">
                  Continue a conversation
                </p>
                <div className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain rounded-3xl border border-border bg-card p-1">
                  {pastThreads.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-1 rounded-2xl px-2 py-1.5 hover:bg-muted/60"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => openThread(entry.id)}
                      >
                        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {entry.name}
                          </span>
                          <span className="block text-[0.65rem] text-muted-foreground">
                            {entry.messageCount} message
                            {entry.messageCount === 1 ? '' : 's'} ·{' '}
                            {formatThreadAge(entry.updatedAtMs)}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground opacity-60 hover:opacity-100"
                        aria-label={`Delete conversation ${entry.name}`}
                        disabled={deleteThread.isPending}
                        onClick={() => removeThread(entry.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                {enabled ? (
                  <div className="flex flex-wrap gap-2 pt-1">
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
            ) : (
              <div className="space-y-3 rounded-3xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {enabled
                    ? 'Ask a question about the current state or recent logs, request a new automation, or ask for a quick light change. Attach entities from the page you came from.'
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
            )
          ) : null}

          {showPastThreads
            ? null
            : thread.map((message) => {
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
            if (message.kind === 'error') {
              return (
                <Alert key={message.id} variant="destructive">
                  <AlertDescription>{message.error}</AlertDescription>
                </Alert>
              );
            }
            if (message.kind === 'action') {
              return (
                <ActionCard
                  key={message.id}
                  action={message.action}
                  results={message.results ?? null}
                  readOnly={
                    message.historical === true && message.results === undefined
                  }
                  onApplied={(results) =>
                    recordActionResults(message.id, results)
                  }
                  onDiscard={() => discardMessage(message.id)}
                />
              );
            }
            if (message.kind === 'text') {
              return (
                <p
                  key={message.id}
                  className="whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm text-foreground/90"
                >
                  {message.text}
                </p>
              );
            }
            return (
              <PlanCard
                key={message.id}
                plan={message.plan}
                initialResults={message.results ?? null}
                initialAcceptedOperationIds={message.acceptedOperationIds}
                readOnly={
                  message.historical === true && message.results === undefined
                }
                onApplied={(results, acceptedOperationIds) =>
                  recordPlanResults(
                    message.id,
                    message.plan.planId,
                    results,
                    acceptedOperationIds,
                  )
                }
                onDiscard={() => discardMessage(message.id)}
              />
            );
          })}

          {isStreaming ? (
            <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span className="min-w-0 flex-1 truncate">
                  {status?.message ?? 'Thinking…'}
                </span>
              </div>
              {streamText ? (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[0.7rem] leading-relaxed text-muted-foreground">
                  {streamText}
                </pre>
              ) : null}
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
          {enabled ? (
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  aria-label="Search entities to attach"
                  placeholder="Attach an entity: search routines, scenes, devices…"
                  value={attachQuery}
                  onChange={(event) => setAttachQuery(event.target.value)}
                />
              </div>
              {searchQuery.length >= 2 ? (
                <div
                  role="listbox"
                  aria-label="Entity search results"
                  className="max-h-44 overflow-y-auto rounded-xl border border-border bg-card p-1"
                >
                  {searchResults.isFetching ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Searching…
                    </p>
                  ) : searchHits.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No matching entities.
                    </p>
                  ) : (
                    searchHits.map((hit) => (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => addAttachment(hit)}
                      >
                        <AssistantEntityIcon
                          kind={hit.kind}
                          className="text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {hit.label}
                        </span>
                        <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                          {hit.summary}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <Textarea
            rows={2}
            value={prompt}
            placeholder="Describe the change, for example “dim the office lights at sunset”"
            disabled={!enabled || isStreaming}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {usage ? (
                <div className="space-y-1">
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${contextUsagePercent(usage)}%` }}
                    />
                  </div>
                  <p className="truncate text-[0.7rem] text-muted-foreground">
                    {usage.approximate ? '≈' : ''}
                    {formatTokenCount(usage.totalTokens)} /{' '}
                    {formatTokenCount(usage.contextWindow)} tokens this thread
                    (approximate)
                  </p>
                </div>
              ) : (
                <p className="text-[0.7rem] text-muted-foreground">
                  {model
                    ? `Using ${model}. Nothing is written before you apply.`
                    : 'Nothing is written before you apply.'}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isStreaming ? (
                <Button type="button" variant="outline" onClick={stop}>
                  <Square />
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={!enabled || !prompt.trim() || isStreaming}
                onClick={submit}
              >
                {isStreaming ? <Loader2 className="animate-spin" /> : <Send />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}
