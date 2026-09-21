import { useMutation, useQuery } from '@tanstack/react-query';

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
