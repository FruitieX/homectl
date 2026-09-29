import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { readApiResponse } from '@/hooks/useConfig';
import { entityDraftStore } from '@/lib/entityDraft';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';

interface SystemSettings {
  warmup_time_seconds: number;
  default_transition_ms: number | null;
  scene_transition_ms: number | null;
  weather_api_url: string;
  train_api_url: string;
  influx_url: string;
}
export function BehaviorSection() {
  const { apiEndpoint } = useAppConfig(),
    client = useQueryClient(),
    recordWrite = useRecordConfigWrite();
  const queryKey = ['config', apiEndpoint, 'system-behavior'];
  const endpoint = `${apiEndpoint}/api/v1/config/core`;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<SystemSettings>(
          await fetch(endpoint, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          }),
          'Could not load system settings',
        )
      ).data,
    refetchInterval: 30000,
  });
  const draft = useEntityDraft({
    key: `${apiEndpoint}/system-behavior`,
    item: query.data,
    label: 'Startup & transitions',
    href: '/config/settings?tab=core',
    validate: (value) => [
      ...(!Number.isInteger(value.warmup_time_seconds) ||
      value.warmup_time_seconds < 0 ||
      value.warmup_time_seconds > 2147483647
        ? [
            {
              field: 'warmup_time_seconds',
              message: 'Warmup must be a non-negative whole number of seconds.',
            },
          ]
        : []),
      ...(['default_transition_ms', 'scene_transition_ms'] as const).flatMap(
        (field) =>
          value[field] !== null &&
          (!Number.isInteger(value[field]) ||
            value[field]! < 0 ||
            value[field]! > 65535000)
            ? [
                {
                  field,
                  message:
                    'Transitions must be whole milliseconds between 0 and 65,535,000, or use the default.',
                },
              ]
            : [],
      ),
    ],
    save: async (value, expected) => {
      await client.cancelQueries({ queryKey });
      const result = await readApiResponse<SystemSettings>(
        await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warmup_time_seconds: value.warmup_time_seconds,
            default_transition_ms: value.default_transition_ms,
            scene_transition_ms: value.scene_transition_ms,
            expected,
          }),
          signal: AbortSignal.timeout(20000),
        }),
        'Could not save system settings',
      );
      recordWrite('System settings', result.write);
      client.setQueryData(queryKey, result.data);
      return result.data;
    },
  });
  const value = draft.value;
  return (
    <>
      <SettingsSection
        id="behavior"
        title="Startup & transitions"
        description="Saved settings apply to everyone using this home."
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
              ? 'Loading system settings…'
              : 'System settings are unavailable.'}
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid content-start gap-2 text-xs">
              Startup warmup (seconds)
              <Input
                type="number"
                min={0}
                max={2147483647}
                step={1}
                {...entityFieldProps(draft, 'warmup_time_seconds')}
                value={value.warmup_time_seconds}
                onChange={(event) =>
                  draft.patch({
                    warmup_time_seconds: Number(event.target.value),
                  })
                }
              />
              <span className="text-muted-foreground">
                Time for integrations to report before startup completes.
              </span>
            </label>
            {(['default_transition_ms', 'scene_transition_ms'] as const).map(
              (field) => (
                <div key={field} className="space-y-2 text-xs">
                  <label className="grid gap-2">
                    {field === 'default_transition_ms'
                      ? 'Device transition'
                      : 'Scene transition'}
                    <SettingsSelect
                      aria-label={`${field} mode`}
                      value={value[field] === null ? 'default' : 'custom'}
                      onValueChange={(mode) =>
                        draft.patch({
                          [field]: entityDraftStore.switchVariant<
                            number | null
                          >(
                            draft.key,
                            field,
                            value[field] === null ? 'default' : 'custom',
                            value[field],
                            mode,
                            mode === 'default' ? null : 1000,
                          ),
                        })
                      }
                      options={[
                        { value: 'default', label: 'Use default' },
                        { value: 'custom', label: 'Set duration' },
                      ]}
                    />
                  </label>
                  {value[field] !== null && (
                    <label className="grid gap-2">
                      Duration (milliseconds)
                      <Input
                        type="number"
                        min={0}
                        max={65535000}
                        step={1}
                        {...entityFieldProps(draft, field)}
                        aria-label={`${field} duration`}
                        value={value[field]}
                        onChange={(event) =>
                          draft.patch({ [field]: Number(event.target.value) })
                        }
                      />
                    </label>
                  )}
                  <p className="text-muted-foreground">
                    {field === 'default_transition_ms'
                      ? 'Used when a device command does not specify a transition.'
                      : 'Used when scene activation does not specify a transition.'}{' '}
                    Zero requests an immediate change.
                  </p>
                </div>
              ),
            )}
          </div>
        )}
      </SettingsSection>
      <EntitySaveBar draft={draft} />
    </>
  );
}
