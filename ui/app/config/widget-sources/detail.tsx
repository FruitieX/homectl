import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ConfigApiError, readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { ConfigPageHeader } from '../page-header';
import {
  sourceDefinitions,
  useWidgetSources,
  type WidgetSource,
} from './shared';
import type { FieldError } from '@/lib/configSection';

type SourceDraft = WidgetSource & {
  replacements: Record<string, string>;
  clear: Record<string, boolean>;
};
const toDraft = (source: WidgetSource): SourceDraft => ({
  ...source,
  replacements: {},
  clear: {},
});

export default function WidgetSourceDetail() {
  const { id = '' } = useParams(),
    query = useWidgetSources(),
    client = useQueryClient(),
    recordWrite = useRecordConfigWrite();
  const { advanced } = useSettingsPreferences();
  const definition = sourceDefinitions[id];
  const item = useMemo(() => {
    const source = query.data?.find((source) => source.key === id);
    return source && toDraft(source);
  }, [query.data, id]);
  const draft = useEntityDraft({
    key: `${query.endpoint}/${id}`,
    item,
    label: definition?.name ?? id,
    href: `/config/widget-sources/${encodeURIComponent(id)}`,
    validate: (value) => {
      const errors: FieldError[] = [];
      for (const field of definition?.fields ?? []) {
        const text = (
          field.secret
            ? value.clear[field.key]
              ? ''
              : value.replacements[field.key]
            : value.config[field.key]
        )?.trim();
        if (!field.url || !text) continue;
        try {
          const url = new URL(text);
          if (!['http:', 'https:'].includes(url.protocol)) throw Error();
        } catch {
          errors.push({
            field: field.key,
            message: `${field.label} must use HTTP or HTTPS.`,
          });
        }
      }
      if (value.invalidStoredConfig)
        errors.push({
          field: 'source',
          message:
            'This saved source contains malformed fields. Repair its configuration before saving.',
        });
      return errors;
    },
    save: async (value, expected) => {
      await client.cancelQueries({ queryKey: query.queryKey });
      const config = { ...value.config };
      for (const field of definition.fields.filter((field) => field.secret)) {
        if (value.clear[field.key]) config[field.key] = '';
        else if (value.replacements[field.key])
          config[field.key] = value.replacements[field.key];
      }
      try {
        const result = await readApiResponse<WidgetSource>(
          await fetch(`${query.endpoint}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({ config, expected: expected.revisionToken }),
          }),
          'Could not save widget source',
        );
        if (!result.data)
          throw Error('The server did not return the saved source.');
        recordWrite(definition.name, result.write);
        client.setQueryData<WidgetSource[]>(query.queryKey, (current) =>
          current?.map((source) => (source.key === id ? result.data! : source)),
        );
        return toDraft(result.data);
      } catch (error) {
        if (
          error instanceof ConfigApiError &&
          error.status === 409 &&
          error.current
        )
          error.current = toDraft(error.current as WidgetSource);
        throw error;
      }
    },
  });
  if (!definition)
    return (
      <p>
        Unknown widget source.{' '}
        <Link className="settings-link" to="/config/widget-sources">
          Widget sources
        </Link>
      </p>
    );
  const value = draft.value;
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title={definition.name}
        description={definition.description}
      />
      {query.isError && (
        <div role="alert">
          Could not refresh this source. Your draft is kept.{' '}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!value ? (
        <p>{query.isPending ? 'Loading source…' : 'Source unavailable.'}</p>
      ) : (
        <>
          <SettingsSection
            id="source-settings"
            title="Connection"
            description="Applies to widgets using the shared service. Save changes to update the service."
          >
            {value.invalidStoredConfig && (
              <p role="alert" className="text-sm text-destructive">
                The stored source contains malformed fields. It has been kept
                intact.
              </p>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              {definition.fields.map((field) => (
                <div className="min-w-0 space-y-2" key={field.key}>
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium">{field.label}</span>
                    <Input
                      {...entityFieldProps(draft, field.key)}
                      type={field.secret ? 'password' : 'url'}
                      autoComplete={field.secret ? 'new-password' : 'off'}
                      disabled={field.secret && value.clear[field.key]}
                      value={
                        field.secret
                          ? (value.replacements[field.key] ?? '')
                          : (value.config[field.key] ?? '')
                      }
                      placeholder={
                        field.secret && value.credentials[field.key]
                          ? 'Saved — leave empty to keep'
                          : field.url
                            ? 'https://…'
                            : ''
                      }
                      onChange={(event) =>
                        draft.patch(
                          field.secret
                            ? {
                                replacements: {
                                  ...value.replacements,
                                  [field.key]: event.target.value,
                                },
                              }
                            : {
                                config: {
                                  ...value.config,
                                  [field.key]: event.target.value,
                                },
                              },
                        )
                      }
                    />
                  </label>
                  {field.secret && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {value.credentials[field.key]
                          ? 'A value is configured. It is never returned to the browser.'
                          : 'No value is configured.'}
                      </p>
                      {value.credentials[field.key] && (
                        <label className="flex min-h-9 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={value.clear[field.key] ?? false}
                            onChange={(event) =>
                              draft.patch({
                                clear: {
                                  ...value.clear,
                                  [field.key]: event.target.checked,
                                },
                              })
                            }
                          />
                          Remove on Save
                        </label>
                      )}
                    </>
                  )}
                  {value.origins[field.key] === 'environment' && (
                    <p className="text-xs text-muted-foreground">
                      Currently supplied by the server environment. Saving a
                      value overrides that default; clearing disables it.
                    </p>
                  )}
                  {advanced && (
                    <p className="text-xs text-muted-foreground">
                      Field: <code>{field.key}</code>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SettingsSection>
          <SettingsSection title="Related settings">
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to="/config/widget-sources" className="settings-link">
                All widget sources
              </Link>
              {id === 'influxdb' && (
                <Link to="/config/sensors" className="settings-link">
                  Sensor names & groups
                </Link>
              )}
              <Link to="/dashboard" className="settings-link">
                Dashboard widgets
              </Link>
            </div>
          </SettingsSection>
          <EntitySaveBar draft={draft} sensitivePaths={['/replacements']} />
        </>
      )}
    </div>
  );
}
