import { useState } from 'react';

import { type Integration, useIntegrations } from '@/hooks/useConfig';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigReadOnlyGrid,
  ConfigReadOnlyItem,
  ConfigToggleRow,
} from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';

const pluginOptions = ['mqtt', 'circadian', 'cron', 'timer', 'dummy'];
const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const enabledBadgeClassName =
  'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
const disabledBadgeClassName =
  'border-transparent bg-destructive/15 text-destructive dark:text-red-300';

const getIntegrationSearchValues = (integration: Integration) => [
  integration.id,
  integration.plugin,
  integration.enabled ? 'enabled' : 'disabled',
  integration.config,
];

export default function IntegrationsPage() {
  const {
    data: integrations,
    loading,
    error,
    create,
    update,
    remove,
  } = useIntegrations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const editingIntegration = integrations.find(
    (integration) => integration.id === editingId,
  );
  const visibleIntegrations = integrations.filter((integration) =>
    matchesConfigSearch(search, ...getIntegrationSearchValues(integration)),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading integrations: {error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Integrations"
        description="Connect plugins, schedules, and virtual devices to the runtime."
        actions={
          <Button onClick={() => setShowCreate(true)}>Add Integration</Button>
        }
      />

      <ConfigListSearchBar
        filteredCount={visibleIntegrations.length}
        onChange={setSearch}
        placeholder="Search by id, plugin, or config"
        totalCount={integrations.length}
        value={search}
      />

      {visibleIntegrations.length === 0 ? (
        <EmptyState
          title="No integrations match the current search"
          description="Try a different plugin name, id, or configuration value."
        />
      ) : (
        <div className="grid gap-4">
          {visibleIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onEdit={() => setEditingId(integration.id)}
              onDelete={async () => {
                if (confirm(`Delete integration "${integration.id}"?`)) {
                  await remove(integration.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <IntegrationOverlay
          mode="create"
          onClose={() => setShowCreate(false)}
          onSubmit={async (integration) => {
            await create(integration);
            setShowCreate(false);
          }}
        />
      )}

      {editingIntegration && (
        <IntegrationOverlay
          mode="edit"
          integration={editingIntegration}
          onClose={() => setEditingId(null)}
          onSubmit={async (integration) => {
            await update(editingIntegration.id, integration);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  onEdit,
  onDelete,
}: {
  integration: Integration;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{integration.id}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">{integration.plugin}</Badge>
              <Badge
                className={
                  integration.enabled
                    ? enabledBadgeClassName
                    : disabledBadgeClassName
                }
              >
                {integration.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <details className="rounded-2xl border border-border bg-muted/30">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Configuration
          </summary>
          <pre className="max-h-72 overflow-auto border-t border-border px-4 py-3 text-xs">
            {JSON.stringify(integration.config, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function ConfigEditor({
  config,
  onConfigChange,
}: {
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  const updateKey = (key: string, value: string) => {
    const updated = { ...config };
    try {
      updated[key] = JSON.parse(value);
    } catch {
      updated[key] = value;
    }
    onConfigChange(updated);
  };

  const removeKey = (key: string) => {
    const updated = { ...config };
    delete updated[key];
    onConfigChange(updated);
  };

  const renameKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) {
      return;
    }
    const updated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      updated[key === oldKey ? newKey : key] = value;
    }
    onConfigChange(updated);
  };

  return (
    <ConfigFormSection
      title="Configuration fields"
      description="Use key/value rows for common plugin settings. Values are parsed as JSON when possible."
      className="bg-muted/20"
    >
      <div className="space-y-2">
        {Object.entries(config).map(([key, value], index) => {
          const displayValue =
            typeof value === 'object' && value !== null
              ? JSON.stringify(value)
              : String(value ?? '');

          return (
            <div
              key={`integration-config-${index}`}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
            >
              <Input
                className="font-mono text-xs"
                value={key}
                onChange={(event) => renameKey(key, event.target.value)}
                placeholder="key"
              />
              <Input
                className="font-mono text-xs"
                value={displayValue}
                onChange={(event) => updateKey(key, event.target.value)}
                placeholder="value"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeKey(key)}
              >
                ✕
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onConfigChange({ ...config, '': '' })}
        >
          + Add Field
        </Button>
      </div>
    </ConfigFormSection>
  );
}

function IntegrationOverlay({
  mode,
  integration,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  integration?: Integration;
  onClose: () => void;
  onSubmit: (integration: Partial<Integration>) => Promise<void>;
}) {
  const [id, setId] = useState(integration?.id ?? '');
  const [plugin, setPlugin] = useState(integration?.plugin ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(
    integration?.config ?? {},
  );
  const [enabled, setEnabled] = useState(integration?.enabled ?? true);
  const [editTab, setEditTab] = useState<'basics' | 'fields' | 'json'>(
    'basics',
  );
  const [jsonText, setJsonText] = useState(
    JSON.stringify(integration?.config ?? {}, null, 2),
  );
  const isCreate = mode === 'create';

  const changeTab = (value: string) => {
    if (value === 'json') {
      setJsonText(JSON.stringify(config, null, 2));
      setEditTab('json');
      return;
    }

    if (editTab === 'json') {
      try {
        setConfig(JSON.parse(jsonText));
      } catch {
        alert('Invalid JSON - fix before leaving the JSON tab');
        return;
      }
    }

    if (value === 'basics' || value === 'fields') {
      setEditTab(value);
    }
  };

  const submit = () => {
    let effectiveConfig = config;

    if (editTab === 'json') {
      try {
        effectiveConfig = JSON.parse(jsonText);
      } catch {
        alert('Invalid JSON in configuration');
        return;
      }
    }

    void onSubmit({
      id,
      plugin,
      config: effectiveConfig,
      enabled,
    });
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={isCreate ? 'Add Integration' : `Edit ${integration?.id ?? id}`}
      description={
        isCreate
          ? 'Create a new integration instance and initial plugin config.'
          : 'Adjust whether the integration is enabled and update plugin configuration.'
      }
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="mt-4 space-y-4">
            <ConfigFormSection
              title="Integration identity"
              description="Pick a stable id and plugin type. Existing integration ids and plugins are read-only to avoid breaking references."
            >
              {isCreate ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigField label="Integration ID">
                    <Input
                      value={id}
                      onChange={(event) => setId(event.target.value)}
                      placeholder="e.g. my-mqtt"
                    />
                  </ConfigField>

                  <ConfigField label="Plugin">
                    <select
                      className={selectClassName}
                      value={plugin}
                      onChange={(event) => setPlugin(event.target.value)}
                    >
                      <option value="">Select plugin...</option>
                      {pluginOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </ConfigField>
                </div>
              ) : (
                <ConfigReadOnlyGrid>
                  <ConfigReadOnlyItem
                    label="Integration ID"
                    value={integration?.id}
                  />
                  <ConfigReadOnlyItem
                    label="Plugin"
                    value={integration?.plugin}
                  />
                </ConfigReadOnlyGrid>
              )}

              <ConfigToggleRow
                label="Enabled"
                description="Disabled integrations stay in configuration but will not be started by the runtime."
              >
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
              </ConfigToggleRow>
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="fields" className="mt-4">
            <ConfigEditor config={config} onConfigChange={setConfig} />
          </TabsContent>

          <TabsContent value="json" className="mt-4">
            <ConfigFormSection
              title="Advanced JSON"
              description="Use this for nested plugin settings that do not fit into key/value rows."
            >
              <Textarea
                className="h-96 font-mono text-sm"
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
              />
            </ConfigFormSection>
          </TabsContent>
        </Tabs>

        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!id || !plugin} onClick={submit}>
            {isCreate ? 'Create' : 'Save'}
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
