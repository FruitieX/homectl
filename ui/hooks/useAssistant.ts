import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApplyAssistantPlanResponse } from '@/bindings/ApplyAssistantPlanResponse';
import type { AssistantPlan } from '@/bindings/AssistantPlan';
import type { AssistantPlanRequest } from '@/bindings/AssistantPlanRequest';

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

export interface AssistantAppliedChange {
  device_key: string;
  name?: string;
  ok: boolean;
  error?: string | null;
}

export interface AssistantApplyResult {
  summary?: string | null;
  applied: AssistantAppliedChange[];
  applied_count: number;
  model: string;
}

export interface AssistantApplyRequest {
  prompt: string;
  /** Optional scope; the model may only address these device keys. */
  deviceKeys?: string[];
}

/** Applies a one-off light state request to live devices. */
export function useApplyAssistantAction() {
  const { apiEndpoint } = useAppConfig();

  return useMutation({
    mutationFn: async (request: AssistantApplyRequest) => {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/assistant/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
      );
      const result = await readAssistantResponse<AssistantApplyResult>(
        response,
        'Failed to apply assistant action',
      );
      if (!result.data) {
        throw new Error('Failed to apply assistant action');
      }
      return result.data;
    },
  });
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

export interface ApplyAssistantPlanVariables {
  planId: string;
  acceptedOperationIds: string[];
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
