import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useIntegrations,
  useIntegrationConfigSchemas,
  type Integration,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { entityDraftStore } from '@/lib/entityDraft';
import { configItemHref } from '@/lib/configItemHref';
import {
  readConfigPath,
  validateIntegrationDraft,
  integrationFieldVisible,
} from '@/lib/integrationDraft';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { JsonValueEditor } from '@/ui/settings/JsonValueEditor';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { IntegrationField } from './fields';
import { AttentionDevices } from '@/ui/settings/HealthStatus';
import {
  ReportingPolicyField,
  reportingPolicyError,
} from '@/ui/settings/ReportingPolicyField';
export const legacyIntegration = (plugin: string) =>
  ['cron', 'timer', 'circadian'].includes(plugin);
function initial(): Integration {
  return {
    id: '',
    plugin: 'mqtt',
    enabled: true,
    config: {
      host: '',
      port: 1883,
      mode: 'zigbee2mqtt',
      zigbee2mqtt_base_topic: 'zigbee2mqtt',
    },
  };
}
export default function IntegrationDetailPage() {
  const { id } = useParams(),
    creating = id === 'new';
  const api = useIntegrations(),
    schemas = useIntegrationConfigSchemas(),
    catalog = useDevicesApi();
  const { apiEndpoint } = useAppConfig(),
    { advanced } = useSettingsPreferences(),
    navigate = useNavigate();
  const saved = api.data.find((row) => row.id === id),
    empty = useMemo(() => initial(), []);
  const key = `${apiEndpoint}/integrations/${creating ? '$new' : id}`,
    href = creating
      ? '/config/integrations/new'
      : configItemHref('integration', id!);
  const draft = useEntityDraft({
    key,
    item: creating ? empty : saved,
    label: saved?.id ?? 'New integration',
    href,
    validate(value) {
      const errors = validateIntegrationDraft(
        value,
        schemas.data.find((schema) => schema.plugin === value.plugin),
      );
      const policyError = reportingPolicyError(
        value.reporting_policy ?? { mode: 'inherit' },
      );
      if (policyError)
        errors.push({ field: 'reporting_policy', message: policyError });
      if (legacyIntegration(value.plugin))
        errors.push({
          field: 'plugin',
          message:
            'Legacy integrations are read-only. Use routines and computed sources for new configuration.',
        });
      if (creating && api.data.some((row) => row.id === value.id))
        errors.push({
          field: 'id',
          message: 'This integration ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      const result = creating
        ? await api.create(value)
        : await api.update(value.id, value, expected);
      if (result && creating) {
        draft.forget();
        navigate(configItemHref('integration', result.id), { replace: true });
      }
      return result;
    },
  });
  const value = draft.value,
    schema = schemas.data.find((schema) => schema.plugin === value?.plugin);
  const legacy = value ? legacyIntegration(value.plugin) : false;
  const editable = Boolean(schema) && !legacy;
  const groups = new Map<string, NonNullable<typeof schema>['fields']>();
  for (const field of schema?.fields ?? []) {
    const present = readConfigPath(value?.config, field.key) !== undefined;
    if (
      (!integrationFieldVisible(field, value?.config ?? {}) && !present) ||
      (field.advanced && !advanced && !present && !field.required)
    )
      continue;
    const section = field.section ?? 'Configuration';
    groups.set(section, [...(groups.get(section) ?? []), field]);
  }
  const unknownConfig = Object.fromEntries(
    Object.entries(value?.config ?? {}).filter(
      ([name]) =>
        !schema?.fields.some((field) => field.key.split('.')[0] === name),
    ),
  );
  const devices = catalog.devices.filter(
    (device) => device.integration_id === id,
  );
  useAssistantPageContext(
    saved ? { kind: 'integration', id: saved.id, label: saved.id } : null,
  );
  async function remove() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.id}?`,
        description:
          'Stops the integration and removes its configuration. Scenes and routines may still reference its devices.',
        confirmLabel: 'Delete integration',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/integrations');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function downloadSaved() {
    if (!saved) return;
    const {
      revision_token: _revision,
      secret_fields: _secrets,
      ...configuration
    } = saved;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(configuration, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `integration-${saved.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/integrations"
      backLabel="Connections & services"
      title={creating ? 'New connection' : (saved?.id ?? 'Connection')}
      status={
        legacy
          ? 'Legacy integration · Read-only'
          : creating
            ? 'Configure the connection, then create it when ready.'
            : 'Saving applies the configuration and reloads this integration.'
      }
      loading={api.loading || schemas.loading}
      error={api.error ?? schemas.error}
      onRetry={() => {
        void api.refetch();
        void schemas.refetch();
      }}
      notFound={!creating && !saved && !draft.dirty}
      menu={
        !creating
          ? [
              {
                label: 'Download saved configuration (without passwords)',
                onSelect: downloadSaved,
              },
              {
                label: 'Delete integration',
                onSelect: () => void remove(),
                destructive: true,
              },
            ]
          : undefined
      }
    >
      {value && (
        <>
          <SettingsSection id="details" title="Details">
            {creating ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-xs">
                  Integration ID
                  <Input
                    data-field="id"
                    value={value.id}
                    onChange={(event) =>
                      draft.patch({ id: event.target.value })
                    }
                    placeholder="For example, zigbee2mqtt"
                  />
                </label>
                <label className="grid gap-2 text-xs">
                  Connection type
                  <SettingsSelect
                    aria-label="Connection type"
                    data-field="plugin"
                    value={value.plugin}
                    onValueChange={(plugin) => {
                      draft.patch({
                        plugin,
                        config: entityDraftStore.switchVariant(
                          key,
                          'plugin',
                          value.plugin,
                          value.config,
                          plugin,
                          plugin === 'dummy'
                            ? { devices: {} }
                            : plugin === 'mqtt'
                              ? initial().config
                              : {},
                        ),
                      });
                    }}
                    options={schemas.data
                      .filter((schema) => !legacyIntegration(schema.plugin))
                      .map((schema) => ({
                        value: schema.plugin,
                        label: schema.name,
                      }))}
                  />
                </label>
              </div>
            ) : (
              <p className="text-sm">{schema?.name ?? value.plugin}</p>
            )}
            {editable ? (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={value.enabled}
                  onChange={(event) =>
                    draft.patch({ enabled: event.target.checked })
                  }
                />
                {creating ? 'Enable after creating' : 'Enabled'}
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">
                {value.enabled ? 'Enabled' : 'Disabled'}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {schema?.description ??
                'This plugin is not supported by this editor; its configuration is preserved.'}
            </p>
          </SettingsSection>
          {legacy ? (
            <SettingsSection id="upgrade" title="Use the current format">
              <p className="text-sm">
                {value.plugin === 'circadian'
                  ? 'Circadian schedules are now configured as computed sources.'
                  : 'Schedules and timers are now configured inside routines.'}
              </p>
              <p className="text-xs text-muted-foreground">
                This legacy entry remains read-only. Review its replacement
                before removing it so existing references keep working.
              </p>
              <Button asChild variant="outline" className="w-fit">
                <Link
                  to={
                    value.plugin === 'circadian'
                      ? '/config/sources'
                      : '/config/routines'
                  }
                >
                  {value.plugin === 'circadian'
                    ? 'Open computed sources'
                    : 'Open routines'}
                </Link>
              </Button>
              {value.plugin !== 'circadian' && (
                <p className="text-xs text-muted-foreground">
                  The server’s offline convert command can migrate compatible
                  legacy schedules and timer actions. It produces a dry-run
                  report and requires the server to be stopped before applying.
                </p>
              )}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(value.config, null, 2)}
              </pre>
            </SettingsSection>
          ) : editable ? (
            <>
              <SettingsSection
                id="reporting"
                title="Reporting defaults"
                description="Missing-report policy for devices using this integration. Individual devices can override it."
              >
                <ReportingPolicyField
                  value={value.reporting_policy ?? { mode: 'inherit' }}
                  onChange={(reporting_policy) =>
                    draft.patch({ reporting_policy })
                  }
                  scope="integration"
                  draftKey={key}
                />
              </SettingsSection>
              {[...groups].map(([title, fields]) => (
                <SettingsSection
                  key={title}
                  id={`section-${title.toLowerCase().replaceAll(' ', '-')}`}
                  title={title}
                >
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    {fields.map((field) => (
                      <IntegrationField
                        key={field.key}
                        field={field}
                        config={value.config}
                        onChange={(config) => draft.patch({ config })}
                        plugin={value.plugin}
                        draftKey={key}
                        storedSecret={
                          value.secret_fields?.includes(field.key) ?? false
                        }
                      />
                    ))}
                  </div>
                </SettingsSection>
              ))}
              {(advanced || Object.keys(unknownConfig).length > 0) && (
                <SettingsSection
                  id="additional"
                  title="Additional fields"
                  description="Extension fields remain intact when editing ordinary settings."
                >
                  <JsonValueEditor
                    value={unknownConfig}
                    fixedType="object"
                    label="Additional configuration"
                    draftKey={key}
                    path="config/extensions"
                    onChange={(next) => {
                      if (
                        !next ||
                        typeof next !== 'object' ||
                        Array.isArray(next)
                      )
                        return;
                      draft.patch({
                        config: {
                          ...Object.fromEntries(
                            Object.entries(value.config).filter(
                              ([name]) => !Object.hasOwn(unknownConfig, name),
                            ),
                          ),
                          ...next,
                        },
                      });
                    }}
                  />
                </SettingsSection>
              )}
            </>
          ) : (
            <SettingsSection title="Stored configuration">
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(value.config, null, 2)}
              </pre>
            </SettingsSection>
          )}
          {!creating && (
            <SettingsSection
              id="devices"
              title="Devices"
              description={`${devices.length} devices reported through this integration.`}
              actions={
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to={`/config/devices?integration=${encodeURIComponent(id!)}`}
                  >
                    All devices
                  </Link>
                </Button>
              }
            >
              {catalog.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {catalog.error.message}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {devices.slice(0, 24).map((device) => (
                    <Link
                      key={device.id}
                      className="settings-link truncate text-sm"
                      to={configItemHref(
                        'device',
                        `${device.integration_id}/${device.id}`,
                      )}
                    >
                      {device.name || device.id}
                    </Link>
                  ))}
                </div>
              )}
            </SettingsSection>
          )}
          {!creating && (
            <SettingsSection title="Device attention">
              <AttentionDevices integration={id} />
            </SettingsSection>
          )}
          {editable && (
            <EntitySaveBar
              draft={draft}
              createLabel={creating ? 'Create connection' : undefined}
              sensitivePaths={schema?.fields
                .filter((field) => field.kind === 'password')
                .map((field) => '/config/' + field.key.replaceAll('.', '/'))}
            />
          )}
        </>
      )}
    </DetailPageShell>
  );
}
