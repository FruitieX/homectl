import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApplyAssistantActionResponse } from '@/bindings/ApplyAssistantActionResponse';
import type { ApplyAssistantPlanResponse } from '@/bindings/ApplyAssistantPlanResponse';
import type { AssistantAction } from '@/bindings/AssistantAction';
import type { AssistantChatRequest } from '@/bindings/AssistantChatRequest';
import type { AssistantEntityKind } from '@/bindings/AssistantEntityKind';
import type { AssistantPlan } from '@/bindings/AssistantPlan';
import type { AssistantPlanRequest } from '@/bindings/AssistantPlanRequest';
import type { AssistantSearchResult } from '@/bindings/AssistantSearchResult';
import type { AssistantThread } from '@/bindings/AssistantThread';
import type { AssistantThreadOutcome } from '@/bindings/AssistantThreadOutcome';
import type { AssistantThreadSummary } from '@/bindings/AssistantThreadSummary';
import type { AssistantUsage } from '@/bindings/AssistantUsage';
import {
  parseAssistantSseEvents,
  type AssistantSseEvent,
} from '@/lib/assistant-stream';

import { useAppConfig } from './appConfig';
import type { RoutineDefinitionV2Body } from './useConfig';

export interface AssistantStatus {
  enabled: boolean;
  model?: string;
}

export interface AssistantDraft {
  name?: string;
  definition: RoutineDefinitionV2Body;
  warnings: string[];
  attempts: number;
  model: string;
}

export interface AssistantDraftRequest {
  prompt: string;
  focus?: string;
}

async function readAssistantResponse<T>(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const result = (await response.json()) as {
      success: boolean;
      data?: T;
      error?: string | null;
    };

    if (response.ok && result.success) {
      return result;
    }

    throw new Error(result.error || fallback);
  }

  throw new Error((await response.text()) || fallback);
}

/**
 * Whether the deployment configured an OpenAI-compatible assistant provider.
 * The feature is hidden entirely while unconfigured.
 */
export function useAssistantStatus() {
  const { apiEndpoint } = useAppConfig();

  const query = useQuery({
    queryKey: ['assistant', 'status', apiEndpoint],
    queryFn: async () => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/status`,
      );
      const result = await readAssistantResponse<AssistantStatus>(
        response,
        'Assistant status unavailable',
      );
      return result.data ?? { enabled: false };
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    enabled: query.data?.enabled ?? false,
    model: query.data?.model,
    isLoading: query.isLoading,
  };
}

/** Drafts a v2 definition from a prompt. Drafts are never saved automatically. */
export function useDraftRoutine() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async (request: AssistantDraftRequest) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
      );
      const result = await readAssistantResponse<AssistantDraft>(
        response,
        'Failed to draft routine',
      );
      if (!result.data) {
        throw new Error('Failed to draft routine');
      }
      return result.data;
    },
  });
}

/**
 * Produces a reviewed plan of configuration operations. The plan is
 * ephemeral and nothing is written until it is applied.
 */
export function useAssistantPlan() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async (request: AssistantPlanRequest) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
      );
      const result = await readAssistantResponse<AssistantPlan>(
        response,
        'Failed to create assistant plan',
      );
      if (!result.data) {
        throw new Error('Failed to create assistant plan');
      }
      return result.data;
    },
  });
}

export interface AssistantChatStatus {
  phase: string;
  message: string;
  attempt?: number;
}

export interface AssistantChatCallbacks {
  onStatus?: (status: AssistantChatStatus) => void;
  onDelta?: (text: string) => void;
  onUsage?: (usage: AssistantUsage) => void;
  onPlan?: (plan: AssistantPlan) => void;
  onAction?: (action: AssistantAction) => void;
  onAnswer?: (text: string) => void;
  onThread?: (thread: { id: string; name: string }) => void;
  onError?: (message: string) => void;
}

async function readAssistantError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) {
      return body.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return 'Assistant request failed';
}

/**
 * Unified assistant turn: streams SSE status/delta events, then exactly one
 * `plan` or `action` result. `cancel` aborts the in-flight turn through the
 * fetch AbortController; the server stops provider work on disconnect.
 */
export function useAssistantChat() {
  const { apiEndpoint } = useAppConfig();
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (
      request: AssistantChatRequest,
      callbacks: AssistantChatCallbacks,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      const dispatch = (event: AssistantSseEvent) => {
        switch (event.type) {
          case 'status':
            callbacks.onStatus?.(event);
            break;
          case 'delta':
            callbacks.onDelta?.(event.text);
            break;
          case 'usage':
            callbacks.onUsage?.(event.usage);
            break;
          case 'plan':
            callbacks.onPlan?.(event.plan);
            break;
          case 'action':
            callbacks.onAction?.(event.action);
            break;
          case 'answer':
            callbacks.onAnswer?.(event.text);
            break;
          case 'thread':
            callbacks.onThread?.(event.thread);
            break;
          case 'error':
            callbacks.onError?.(event.message);
            break;
        }
      };

      try {
        const response = await fetch(
          `${apiEndpoint}/api/v1/config/assistant/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) {
          callbacks.onError?.(await readAssistantError(response));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseAssistantSseEvents(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            dispatch(event);
          }
        }
        buffer += decoder.decode();
        for (const event of parseAssistantSseEvents(buffer).events) {
          dispatch(event);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        callbacks.onError?.(
          error instanceof Error ? error.message : 'Assistant request failed',
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [apiEndpoint],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  return { send, cancel, isStreaming };
}

export interface ApplyAssistantPlanVariables {
  planId: string;
  acceptedOperationIds: string[];
}

/**
 * Deterministic entity search across the live snapshot. Used by the panel to
 * attach entities without leaving the prompt. Results are ranked by
 * exact/prefix/substring match on the server.
 */
export function useAssistantEntitySearch(
  query: string,
  kind?: AssistantEntityKind,
) {
  const { apiEndpoint } = useAppConfig();
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['assistant', 'search', apiEndpoint, kind ?? 'all', trimmed],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmed });
      if (kind) {
        params.set('kind', kind);
      }
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/search?${params.toString()}`,
      );
      const result = await readAssistantResponse<AssistantSearchResult[]>(
        response,
        'Assistant search failed',
      );
      return result.data ?? [];
    },
    enabled: trimmed.length >= 2,
    staleTime: 30 * 1000,
    retry: false,
  });
}

/**
 * Persisted assistant conversations, newest first (server caps the list).
 */
export function useAssistantThreads(enabled = true) {
  const { apiEndpoint } = useAppConfig();

  return useQuery({
    queryKey: ['assistant', 'threads', apiEndpoint],
    queryFn: async () => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/threads`,
      );
      const result = await readAssistantResponse<AssistantThreadSummary[]>(
        response,
        'Failed to load assistant conversations',
      );
      return result.data ?? [];
    },
    enabled,
    staleTime: 15 * 1000,
    retry: false,
  });
}

/** One persisted conversation with its stored messages. */
export function useAssistantThread(threadId: string | null) {
  const { apiEndpoint } = useAppConfig();

  return useQuery({
    queryKey: ['assistant', 'thread', apiEndpoint, threadId],
    queryFn: async () => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/threads/${encodeURIComponent(threadId ?? '')}`,
      );
      const result = await readAssistantResponse<AssistantThread>(
        response,
        'Failed to load assistant conversation',
      );
      return result.data ?? null;
    },
    enabled: Boolean(threadId),
    retry: false,
  });
}

/** Deletes a persisted conversation. */
export function useDeleteAssistantThread() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (threadId: string) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/threads/${encodeURIComponent(threadId)}`,
        { method: 'DELETE' },
      );
      await readAssistantResponse<boolean>(
        response,
        'Failed to delete assistant conversation',
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['assistant', 'threads', apiEndpoint],
      });
    },
  });
}

/**
 * Discards a stored plan without applying it. The UI hides the review card
 * regardless of the response, so an already-consumed plan is fine.
 */
export function useDiscardAssistantPlan() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async (planId: string) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/plans/${encodeURIComponent(planId)}`,
        { method: 'DELETE' },
      );
      await readAssistantResponse<boolean>(
        response,
        'Failed to discard assistant plan',
      );
    },
  });
}

/**
 * Applies accepted operations from a plan. Plans are single-use: the server
 * consumes the plan on the first successful call.
 */
export function useApplyAssistantPlan() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      acceptedOperationIds,
    }: ApplyAssistantPlanVariables) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/plans/${encodeURIComponent(planId)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acceptedOperationIds }),
        },
      );
      const result = await readAssistantResponse<ApplyAssistantPlanResponse>(
        response,
        'Failed to apply assistant plan',
      );
      if (!result.data) {
        throw new Error('Failed to apply assistant plan');
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

/**
 * Applies a stored light-state action through the normal device command path.
 * Actions are single-use and only written when the user applies them.
 */
export function useApplyAssistantActionPlan() {
  const { apiEndpoint } = useAppConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/actions/${encodeURIComponent(actionId)}/apply`,
        { method: 'POST' },
      );
      const result = await readAssistantResponse<ApplyAssistantActionResponse>(
        response,
        'Failed to apply assistant action',
      );
      if (!result.data) {
        throw new Error('Failed to apply assistant action');
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export interface RecordAssistantThreadOutcomeVariables {
  threadId: string;
  proposalId: string;
  outcome: AssistantThreadOutcome;
}

/**
 * Records what happened when a stored proposal was applied, so reopening the
 * thread shows the same applied state. Best effort: a failure only costs the
 * restore, so callers ignore it.
 */
export function useRecordAssistantThreadOutcome() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async ({
      threadId,
      proposalId,
      outcome,
    }: RecordAssistantThreadOutcomeVariables) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/threads/${encodeURIComponent(threadId)}/outcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId, outcome }),
        },
      );
      if (!response.ok) {
        throw new Error('Failed to record assistant outcome');
      }
      return true;
    },
    retry: false,
  });
}

/**
 * Discards a stored light-state action. The UI removes the card regardless of
 * the response, so an already-consumed action is fine.
 */
export function useDiscardAssistantAction() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async (actionId: string) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/actions/${encodeURIComponent(actionId)}`,
        { method: 'DELETE' },
      );
      await readAssistantResponse<boolean>(
        response,
        'Failed to discard assistant action',
      );
    },
  });
}
