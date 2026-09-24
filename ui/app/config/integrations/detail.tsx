import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import {
  type Integration,
  type IntegrationConfigFieldSchema,
  type IntegrationConfigSchema,
  useIntegrationConfigSchemas,
  useIntegrations,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { ConfigField, ConfigToggleRow } from '@/ui/config-form';
import { checkboxClassName } from '@/ui/form-styles';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Textarea } from '@/ui/primitives/textarea';
import { toast } from 'sonner';

import {
  SchemaConfigField,
  configFieldIsVisible,
  describeLastReport,
  disabledBadgeClassName,
  enabledBadgeClassName,
  getConfigPathValue,
  missingRequiredFieldLabels,
  mqttProfileValidationError,
  parseConfigJsonText,
} from './page';

type ConfigPatch = Record<string, unknown>;

/** A saved value rendered for reading, not editing. */
function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'Not set';
  }
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Read a saved value the way a person wrote it: a select shows its option
 * label, not the raw stored value.
 */
function readFieldValue(
  field: IntegrationConfigFieldSchema,
  config: ConfigPatch,
): string {
  const value = getConfigPathValue(config, field.key);
  const option = field.options?.find(
    (candidate) => JSON.stringify(candidate.value) === JSON.stringify(value),
  );
  if (option) {
    return option.label;
  }
  return formatConfigValue(value);
}

function FieldReadGrid({
  fields,
  config,
}: {
  fields: IntegrationConfigFieldSchema[];
  config: ConfigPatch;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="truncate text-sm text-foreground">
            {readFieldValue(field, config)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The editor for a set of schema fields: one section, one Change, one Save. */
function ConfigFieldsSection({
  id,
  title,
  summary,
  fields,
  config,
  save,
  open,
  onOpenChange,
  headingRef,
}: {
  id: string;
  title: string;
  summary: string;
  fields: IntegrationConfigFieldSchema[];
  config: ConfigPatch;
  save: (patch: ConfigPatch) => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headingRef: (node: HTMLElement | null) => void;
}) {
  const api = useSectionEditor<ConfigPatch>({
    item: config,
    fields: fields.map((field) => field.key),
    save,
  });

  return (
    <Section<ConfigPatch>
      id={id}
      title={title}
      summary={summary}
      open={open}
      onOpenChange={onOpenChange}
      headingRef={headingRef}
      api={api}
      readView={<FieldReadGrid fields={fields} config={config} />}
      renderEditor={(editorApi) => (
        <div className="space-y-4">
          {fields.map((field) => (
            <SchemaConfigField
              key={field.key}
              field={field}
              config={{ ...config, ...(editorApi.draft ?? {}) }}
              onConfigChange={(next) => {
                const changed: ConfigPatch = {};
                for (const key of Object.keys(next)) {
                  if (
                    JSON.stringify(next[key]) !== JSON.stringify(config[key])
                  ) {
                    changed[key] = next[key];
                  }
                }
                editorApi.patch(changed);
              }}
            />
          ))}
        </div>
      )}
    />
  );
}

export default function IntegrationDetailPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const {
    data: integrations,
    loading,
    error,
    update,
    remove,
  } = useIntegrations();
  const { data: schemas, error: schemasError } = useIntegrationConfigSchemas();
  const devices = useDevicesState();
  const { activeSection, openSection } = useSectionParams();
  const headingRefs = useRef<Record<string, HTMLElement | null>>({});

  const integration = useMemo(
    () => (integrations ?? []).find((entry) => entry.id === routeId),
    [integrations, routeId],
  );

  useAssistantPageContext({
    kind: 'integration',
    id: integration?.id,
    label: integration?.id,
  });

  // Which devices behind this connection have stopped reporting, with the last
  // time they were heard from. Connection status is per device; "Enabled" only
  // says the runtime was told to start it.
  const health = useMemo(() => {
    const entry: {
      total: number;
      notReporting: Array<{ key: string; label: string; lastReport?: number }>;
    } = { total: 0, notReporting: [] };
    for (const [key, device] of Object.entries(devices ?? {})) {
      const [integrationId] = key.split('/');
      if (integrationId !== integration?.id) continue;
      entry.total += 1;
      const controllable =
        'Controllable' in device.data ? device.data.Controllable : undefined;
      const availability = controllable?.availability;
      if (availability && availability.online === false) {
        entry.notReporting.push({
          key,
          label: device.name || (key.split('/')[1] ?? key),
          lastReport:
            (availability as { observed_at_ms?: number }).observed_at_ms ??
            (availability as { last_report_ms?: number }).last_report_ms,
        });
      }
    }
    return entry;
  }, [devices, integration?.id]);

  useEffect(() => {
    if (!activeSection) return;
    const node = headingRefs.current[activeSection];
    if (node) {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [activeSection]);

  const config = (integration?.config ?? {}) as ConfigPatch;
  const schema: IntegrationConfigSchema | undefined = (schemas ?? []).find(
    (entry) => entry.plugin === integration?.plugin,
  );
  const visibleFields = (schema?.fields ?? []).filter((field) =>
    configFieldIsVisible(config, field),
  );
  const requiredFields = visibleFields.filter((field) => field.required);
  const optionalFields = visibleFields.filter(
    (field) => !field.required && !field.advanced,
  );
  const advancedFields = visibleFields.filter((field) => field.advanced);
  const optionalSections: string[] = [];
  for (const field of optionalFields) {
    const name = field.section ?? 'Settings';
    if (!optionalSections.includes(name)) {
      optionalSections.push(name);
    }
  }
  const missingFields = missingRequiredFieldLabels(schema, config);
  const profileError =
    integration?.plugin === 'mqtt' ? mqttProfileValidationError(config) : null;

  const savePatch = useCallback(
    async (patch: ConfigPatch) => {
      if (!integration) return;
      await update(integration.id, {
        config: { ...config, ...patch } as Integration['config'],
      });
    },
    [config, integration, update],
  );

  const enabledEditor = useSectionEditor<{ enabled: boolean }>({
    item: { enabled: integration?.enabled ?? true },
    fields: ['enabled'],
    save: async (draft) => {
      if (!integration) return;
      await update(integration.id, { enabled: draft.enabled });
    },
  });
  const jsonEditor = useSectionEditor<{ json: string }>({
    item: { json: JSON.stringify(config, null, 2) },
    fields: ['json'],
    save: async (draft) => {
      const parsed = parseConfigJsonText(draft.json);
      if (!parsed) {
        throw new Error('Fix the JSON before saving.');
      }
      await savePatch(parsed);
    },
  });

  const deleteConnection = () => {
    if (!integration) return;
    void (async () => {
      const confirmed = await confirmDestructive(
        `Delete ${integration.id}?`,
        'Its devices stop updating. Devices and routines that depend on it keep their saved settings until you point them somewhere else.',
      );
      if (!confirmed) return;
      try {
        await remove(integration.id);
        toast.success(`Deleted ${integration.id}`);
        void navigate('/config/integrations', { replace: true });
      } catch (nextError) {
        toast.error(
          nextError instanceof Error
            ? nextError.message
            : 'Failed to delete connection',
        );
      }
    })();
  };

  const crumbs = [
    { label: 'Settings', to: '/config' },
    { label: 'Connections & services', to: '/config/integrations' },
    { label: routeId ?? 'Connection' },
  ];

  if (loading) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/integrations"
        backLabel="Back to connections"
        title={routeId ?? 'Connection'}
      >
        <Skeleton className="h-32 w-full rounded-2xl" />
      </DetailPageShell>
    );
  }

  if (!integration) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/integrations"
        backLabel="Back to connections"
        title={routeId ?? 'Connection'}
      >
        <EmptyState
          title="This connection is not in the current configuration"
          description={`${routeId ?? 'It'} may have been deleted or renamed. Open Connections & services to pick another.`}
        />
      </DetailPageShell>
    );
  }

  const enabled = integration.enabled ?? true;
  const notReporting = health.notReporting[0];
  const lastReport = describeLastReport(notReporting?.lastReport);

  return (
    <DetailPageShell
      crumbs={crumbs}
      backTo="/config/integrations"
      backLabel="Back to connections"
      title={integration.id}
      status={
        <>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge
              className={
                enabled ? enabledBadgeClassName : disabledBadgeClassName
              }
            >
              {enabled ? 'Enabled in configuration' : 'Disabled'}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {integration.plugin}
            </span>
          </span>
          <span className="block text-muted-foreground">
            {enabled
              ? 'The runtime starts this connection. Reachability is reported per device, not here.'
              : 'Disabled: the runtime does not start this connection.'}
          </span>
          {notReporting ? (
            <span className="block">
              <Link
                className="underline underline-offset-2"
                to={`/config/devices/${encodeURIComponent(notReporting.key)}`}
              >
                {notReporting.label} stopped reporting
                {lastReport ? ` (last report ${lastReport})` : ''}
              </Link>
            </span>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* One next action, above the settings that need it. */}
        <Alert>
          <AlertDescription>
            {schemasError
              ? `Next step: reload this page. The plugin schema could not be loaded (${schemasError}), so the fields below may be incomplete.`
              : missingFields.length > 0
                ? `Next step: fill in ${missingFields[0]}${missingFields.length > 1 ? ` and ${missingFields.length - 1} more field${missingFields.length === 2 ? '' : 's'}` : ''}, then save.`
                : profileError
                  ? `Next step: ${profileError}`
                  : 'All required fields are present. Saving applies the configuration to the running connection.'}
          </AlertDescription>
        </Alert>

        <Section<{ enabled: boolean }>
          id="enabled"
          title="Enabled"
          summary={
            enabled
              ? 'Started by the runtime'
              : 'Kept in configuration, not started'
          }
          open={activeSection === 'enabled'}
          onOpenChange={(open) => openSection(open ? 'enabled' : null)}
          headingRef={(node) => {
            headingRefs.current.enabled = node;
          }}
          api={enabledEditor}
          readView={
            <p className="text-sm text-muted-foreground">
              {enabled
                ? 'The runtime starts this connection. It says nothing about whether the bridge is reachable right now — that is reported per device.'
                : 'The runtime does not start this connection. Its saved configuration and devices stay in place.'}
            </p>
          }
          renderEditor={(api) => (
            <ConfigToggleRow
              label="Enabled"
              description="Disabled connections stay in configuration but will not be started by the runtime."
            >
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={api.draft?.enabled ?? enabled}
                onChange={(event) =>
                  api.patch({ enabled: event.target.checked })
                }
              />
            </ConfigToggleRow>
          )}
        />

        {requiredFields.length > 0 ? (
          <ConfigFieldsSection
            id="primary"
            title="Primary settings"
            summary={`${requiredFields.length} required field${requiredFields.length === 1 ? '' : 's'}`}
            fields={requiredFields}
            config={config}
            save={savePatch}
            open={activeSection === 'primary'}
            onOpenChange={(open) => openSection(open ? 'primary' : null)}
            headingRef={(node) => {
              headingRefs.current.primary = node;
            }}
          />
        ) : null}

        {optionalSections.map((name) => {
          const fields = optionalFields.filter(
            (field) => (field.section ?? 'Settings') === name,
          );
          const sectionId = `group-${name}`;
          return (
            <ConfigFieldsSection
              key={sectionId}
              id={sectionId}
              title={name}
              summary={`${fields.length} optional field${fields.length === 1 ? '' : 's'}`}
              fields={fields}
              config={config}
              save={savePatch}
              open={activeSection === sectionId}
              onOpenChange={(open) => openSection(open ? sectionId : null)}
              headingRef={(node) => {
                headingRefs.current[sectionId] = node;
              }}
            />
          );
        })}

        {advancedFields.length > 0 ? (
          <ConfigFieldsSection
            id="advanced"
            title="Advanced settings"
            summary={`${advancedFields.length} field${advancedFields.length === 1 ? '' : 's'}`}
            fields={advancedFields}
            config={config}
            save={savePatch}
            open={activeSection === 'advanced'}
            onOpenChange={(open) => openSection(open ? 'advanced' : null)}
            headingRef={(node) => {
              headingRefs.current.advanced = node;
            }}
          />
        ) : null}

        {/* JSON is a closed advanced section: reading it is not the default. */}
        <Section<{ json: string }>
          id="json"
          title="Advanced JSON"
          summary={`${Object.keys(config).length} saved key${Object.keys(config).length === 1 ? '' : 's'}`}
          open={activeSection === 'json'}
          onOpenChange={(open) => openSection(open ? 'json' : null)}
          headingRef={(node) => {
            headingRefs.current.json = node;
          }}
          api={jsonEditor}
          readView={
            <p className="text-sm text-muted-foreground">
              {Object.keys(config).length === 0
                ? 'No saved keys yet.'
                : `Keys: ${Object.keys(config).join(', ')}. Masked secrets and unknown keys are preserved exactly as stored.`}
            </p>
          }
          renderEditor={(api) => (
            <ConfigField
              label="Configuration JSON"
              description="Unknown and advanced plugin settings. Values edited here are preserved when you return to the sections above."
            >
              <Textarea
                className="max-h-72 min-h-40 resize-y font-mono text-sm"
                rows={8}
                value={api.draft?.json ?? ''}
                onChange={(event) => api.patch({ json: event.target.value })}
              />
            </ConfigField>
          )}
        />

        {/* Delete last, outside the JSON editing form. */}
        <Section<{ json: string }>
          id="danger"
          title="Delete this connection"
          summary="Stops its devices from updating"
          open={activeSection === 'danger'}
          onOpenChange={(open) => openSection(open ? 'danger' : null)}
          headingRef={(node) => {
            headingRefs.current.danger = node;
          }}
          api={jsonEditor}
          editable={false}
          danger
          readView={
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Deleting this connection stops its devices from updating.
                Devices and routines that depend on it keep their saved settings
                until you point them somewhere else.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={deleteConnection}
              >
                Delete this connection
              </Button>
            </div>
          }
          renderEditor={() => null}
        />
      </div>
    </DetailPageShell>
  );
}
