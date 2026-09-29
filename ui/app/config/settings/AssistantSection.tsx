import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { ConfigApiError, readApiResponse } from '@/hooks/useConfig';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import type { FieldError } from '@/lib/configSection';

type ProviderSettings = {
  enabled: boolean;
  baseUrl: string | null;
  model: string | null;
  apiKeySet: boolean;
  reasoningEffort: string | null;
  timezone: string | null;
  timeoutMs: number;
  maxTokens: number;
  contextWindow: number;
  revisionToken: string;
};
type ProviderDraft = ProviderSettings & {
  apiKey: string;
  clearApiKey: boolean;
};
const toDraft = (value: ProviderSettings | undefined): ProviderDraft => {
  if (!value) throw new Error('The server did not return assistant settings.');
  return {
    ...value,
    apiKey: '',
    clearApiKey: false,
  };
};

function validate(value: ProviderDraft): FieldError[] {
  const errors: FieldError[] = [];
  if (Boolean(value.baseUrl?.trim()) !== Boolean(value.model?.trim()))
    errors.push({
      field: 'baseUrl',
      message:
        'Set both a provider URL and a model, or clear both to disable the assistant.',
    });
  if (value.baseUrl) {
    try {
      const url = new URL(value.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error();
    } catch {
      errors.push({
        field: 'baseUrl',
        message: 'Use an HTTP or HTTPS provider URL.',
      });
    }
  }
  for (const [field, min, max, label] of [
    ['timeoutMs', 1000, 600000, 'Timeout'],
    ['maxTokens', 1, 1000000, 'Maximum output tokens'],
    ['contextWindow', 1000, 100000000, 'Context window'],
  ] as const) {
    if (
      !Number.isInteger(value[field]) ||
      value[field] < min ||
      value[field] > max
    )
      errors.push({
        field,
        message: `${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`,
      });
  }
  return errors;
}

export function AssistantSection() {
  const { apiEndpoint } = useAppConfig(),
    client = useQueryClient(),
    recordWrite = useRecordConfigWrite();
  const queryKey = ['config', apiEndpoint, 'assistant-provider'],
    endpoint = `${apiEndpoint}/api/v1/config/assistant/settings`;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      toDraft(
        (
          await readApiResponse<ProviderSettings>(
            await fetch(endpoint, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
            }),
            'Could not load assistant settings',
          )
        ).data,
      ),
    refetchInterval: 30000,
  });
  const draft = useEntityDraft({
    key: `${apiEndpoint}/assistant-provider`,
    item: query.data,
    label: 'Assistant provider',
    href: '/config/settings?tab=assistant',
    validate,
    save: async (value, expected) => {
      await client.cancelQueries({ queryKey });
      try {
        const result = await readApiResponse<ProviderSettings>(
          await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
              baseUrl: value.baseUrl ?? '',
              model: value.model ?? '',
              reasoningEffort: value.reasoningEffort ?? '',
              timezone: value.timezone ?? '',
              maxTokens: value.maxTokens,
              timeoutMs: value.timeoutMs,
              contextWindow: value.contextWindow,
              ...(value.clearApiKey
                ? { apiKey: '' }
                : value.apiKey
                  ? { apiKey: value.apiKey }
                  : {}),
              expected: { revisionToken: expected.revisionToken },
            }),
          }),
          'Could not save assistant settings',
        );
        recordWrite('Assistant settings', result.write);
        const saved = toDraft(result.data);
        client.setQueryData(queryKey, saved);
        void client.invalidateQueries({
          queryKey: ['assistant', 'status', apiEndpoint],
        });
        return saved;
      } catch (error) {
        if (error instanceof ConfigApiError && error.current)
          error.current = toDraft(error.current as ProviderSettings);
        throw error;
      }
    },
  });
  const value = draft.value;
  return (
    <>
      <SettingsSection
        id="assistant-provider"
        title="Assistant provider"
        description="Shared provider settings. The saved API key is never returned to this form."
      >
        {query.isError && (
          <p role="alert">
            {query.error.message}{' '}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </p>
        )}
        {!value ? (
          <p className="text-sm text-muted-foreground">
            {query.isLoading
              ? 'Loading assistant settings…'
              : 'Assistant settings are unavailable.'}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {query.data?.enabled
                ? `Saved configuration uses ${query.data.model}.`
                : 'The saved assistant configuration is disabled.'}{' '}
              Changes take effect after Save.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs sm:col-span-2">
                Provider URL
                <Input
                  {...entityFieldProps(draft, 'baseUrl')}
                  value={value.baseUrl ?? ''}
                  onChange={(event) =>
                    draft.patch({ baseUrl: event.target.value })
                  }
                  placeholder="https://provider.example/v1"
                  autoComplete="off"
                />
                <span className="text-muted-foreground">
                  OpenAI-compatible API base URL. Clear the URL and model to
                  disable the assistant.
                </span>
              </label>
              <label className="grid content-start gap-2 text-xs">
                Model
                <Input
                  {...entityFieldProps(draft, 'model')}
                  value={value.model ?? ''}
                  onChange={(event) =>
                    draft.patch({ model: event.target.value })
                  }
                />
              </label>
              <div className="space-y-2">
                <label className="grid gap-2 text-xs">
                  API key
                  <Input
                    type="password"
                    autoComplete="new-password"
                    {...entityFieldProps(draft, 'apiKey')}
                    value={value.apiKey}
                    disabled={value.clearApiKey}
                    placeholder={
                      value.apiKeySet
                        ? 'Stored — leave blank to keep'
                        : 'Optional'
                    }
                    onChange={(event) =>
                      draft.patch({ apiKey: event.target.value })
                    }
                  />
                </label>
                {value.apiKeySet && (
                  <label className="flex min-h-9 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      aria-label="Remove stored API key on save"
                      checked={value.clearApiKey}
                      onChange={(event) =>
                        draft.patch({ clearApiKey: event.target.checked })
                      }
                    />
                    Remove stored key on Save
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  {value.clearApiKey
                    ? 'The stored key will be removed when you save.'
                    : value.apiKey
                      ? 'A replacement key is pending. It stays in this session until saved or discarded.'
                      : value.apiKeySet
                        ? 'A key is stored. Leave this blank to keep it.'
                        : 'No key is stored.'}
                </p>
              </div>
            </div>
          </>
        )}
      </SettingsSection>
      {value && (
        <SettingsSection
          id="assistant-options"
          title="Provider options"
          description="Limits for assistant requests and the context display."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid content-start gap-2 text-xs">
              Reasoning effort
              <select
                className="settings-select"
                {...entityFieldProps(draft, 'reasoningEffort')}
                value={value.reasoningEffort ?? ''}
                onChange={(event) =>
                  draft.patch({ reasoningEffort: event.target.value || null })
                }
              >
                <option value="">Provider default</option>
                {['low', 'medium', 'high'].map((effort) => (
                  <option key={effort} value={effort}>
                    {effort[0].toUpperCase() + effort.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-2 text-xs">
              Timezone
              <Input
                {...entityFieldProps(draft, 'timezone')}
                value={value.timezone ?? ''}
                onChange={(event) =>
                  draft.patch({ timezone: event.target.value || null })
                }
                placeholder="Inferred from existing routines"
              />
            </label>
            {(
              [
                ['maxTokens', 'Maximum output tokens', 1, 1000000],
                ['contextWindow', 'Context window (tokens)', 1000, 100000000],
                ['timeoutMs', 'Timeout (milliseconds)', 1000, 600000],
              ] as const
            ).map(([field, label, min, max]) => (
              <label key={field} className="grid content-start gap-2 text-xs">
                {label}
                <Input
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  {...entityFieldProps(draft, field)}
                  value={value[field]}
                  onChange={(event) =>
                    draft.patch({ [field]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </SettingsSection>
      )}
      <EntitySaveBar draft={draft} sensitivePaths={['/apiKey']} />
    </>
  );
}
