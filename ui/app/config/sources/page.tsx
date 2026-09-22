import type { Device } from '@/bindings/Device';
import type { SourcePresetInfo } from '@/bindings/SourcePresetInfo';
import {
  type SourceComputeConfig,
  type SourceConfig,
  useSourcePresets,
  useSources,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import { SourcePreviewPanel } from '@/ui/SourcePreviewPanel';
import SourceScriptEditor, {
  SOURCE_SCRIPT_STARTER,
} from '@/ui/SourceScriptEditor';
import {
  DEFAULT_CIRCADIAN_PARAMS,
  SourceParamsForm,
  type SourceCircadianParams,
  circadianParamsFromJson,
  circadianParamsToJson,
} from '@/ui/SourceParamsForm';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Button } from '@/ui/primitives/button';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormGrid,
  ConfigFormSection,
  ConfigHelpPanel,
  ConfigToggleRow,
} from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';
import { useMemo, useState } from 'react';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { ConfigPageHeader } from '../page-header';
import { selectClassName } from '@/ui/form-styles';

const MIN_REFRESH_INTERVAL_MS = 1_000;

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function newSourceDraft(): SourceConfig {
  return {
    id: '',
    name: '',
    enabled: true,
    revision: 0,
    timezone: browserTimezone(),
    refresh_interval_ms: 60_000,
    aliases: [],
    compute: {
      kind: 'circadian_compat',
      preset_version: 1,
      params: circadianParamsToJson({ ...DEFAULT_CIRCADIAN_PARAMS }),
    },
  };
}

function isCircadianShaped(compute: SourceComputeConfig) {
  if (compute.kind === 'circadian_compat') {
    return true;
  }
  return compute.preset?.id === 'circadian';
}

function circadianParamsOf(
  compute: SourceComputeConfig,
): SourceCircadianParams {
  return circadianParamsFromJson(compute.params);
}

function presetRef(compute: SourceComputeConfig) {
  return compute.kind === 'script' ? compute.preset : undefined;
}

function kindLabel(compute: SourceComputeConfig) {
  if (compute.kind === 'circadian_compat') {
    return 'Built-in circadian';
  }
  if (compute.preset) {
    return `Script preset ${compute.preset.id} v${compute.preset.version}`;
  }
  return 'Custom script';
}

function sourceSearchValues(source: SourceConfig) {
  return [
    source.id,
    source.name,
    source.enabled ? 'enabled' : 'disabled',
    source.timezone,
    source.compute.kind,
    kindLabel(source.compute),
    ...(source.aliases ?? []),
  ];
}

function liveValue(device: Device | undefined) {
  if (!device || !('Sensor' in device.data)) {
    return null;
  }
  const sensor = device.data.Sensor;
  if ('value' in sensor) {
    return String(sensor.value);
  }
  const parts: string[] = [];
  const color = sensor.color;
  if (color && 'ct' in color) {
    parts.push(`${color.ct} K`);
  } else if (color && 'h' in color) {
    parts.push(`h ${color.h}° · s ${Math.round(color.s * 100)}%`);
  }
  if (sensor.brightness != null) {
    parts.push(`${Math.round(sensor.brightness * 100)}%`);
  }
  if (parts.length === 0) {
    return sensor.power ? 'No value yet' : 'Off';
  }
  return parts.join(' · ');
}

function validationError(draft: SourceConfig): string | null {
  if (!draft.id.trim()) {
    return 'Id must not be empty.';
  }
  if (!draft.name.trim()) {
    return 'Name must not be empty.';
  }
  if (!draft.timezone.trim()) {
    return 'Timezone must not be empty.';
  }
  if (
    !Number.isFinite(draft.refresh_interval_ms) ||
    draft.refresh_interval_ms < MIN_REFRESH_INTERVAL_MS
  ) {
    return `Refresh interval must be at least ${MIN_REFRESH_INTERVAL_MS} ms.`;
  }
  for (const alias of draft.aliases ?? []) {
    const [integrationId, deviceId, ...rest] = alias.split('/');
    if (rest.length > 0 || !integrationId || !deviceId) {
      return `Alias "${alias}" must look like integration/device.`;
    }
  }
  if (draft.compute.kind === 'script') {
    const hasPreset = Boolean(draft.compute.preset);
    const hasBody = Boolean(draft.compute.source_body?.trim());
    if (hasPreset === hasBody) {
      return 'A script source pins a preset or carries an inline body, not both.';
    }
  }
  return null;
}

function SourceEditor({
  draft,
  presets,
  onChange,
  onSave,
  onCancel,
  onDelete,
  saving,
  error,
  isNew,
}: {
  draft: SourceConfig;
  presets: SourcePresetInfo[];
  onChange: (draft: SourceConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  isNew: boolean;
}) {
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(draft, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const compute = draft.compute;
  const circadianShaped = isCircadianShaped(compute);
  const preset = presetRef(compute);
  const shippedPreset = preset
    ? presets.find(
        (candidate) =>
          candidate.id === preset.id && candidate.version === preset.version,
      )
    : undefined;

  const setCompute = (next: SourceComputeConfig) =>
    onChange({ ...draft, compute: next });

  const forkPreset = () => {
    if (!shippedPreset) {
      return;
    }
    setCompute({
      kind: 'script',
      source_body: shippedPreset.source_body,
      params: compute.params,
    });
  };

  return (
    <Tabs defaultValue="basics">
      <TabsList className="flex-wrap">
        <TabsTrigger value="basics">Basics</TabsTrigger>
        <TabsTrigger value="compute">Compute</TabsTrigger>
        <TabsTrigger value="params">Parameters</TabsTrigger>
        <TabsTrigger value="script">Script</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="json">Advanced JSON</TabsTrigger>
      </TabsList>

      <TabsContent value="basics" className="space-y-4 pt-4">
        <ConfigFormSection
          title="Identity"
          description="The canonical device key is computed/<id>; the id is fixed once the source exists."
        >
          <ConfigFormGrid>
            <ConfigField label="Id">
              <Input
                disabled={!isNew}
                value={draft.id}
                onChange={(event) =>
                  onChange({ ...draft, id: event.target.value })
                }
              />
            </ConfigField>
            <ConfigField label="Name">
              <Input
                value={draft.name}
                onChange={(event) =>
                  onChange({ ...draft, name: event.target.value })
                }
              />
            </ConfigField>
            <ConfigField
              label="Timezone"
              description="IANA zone or fixed offset used to derive civil time."
            >
              <Input
                value={draft.timezone}
                onChange={(event) =>
                  onChange({ ...draft, timezone: event.target.value })
                }
              />
            </ConfigField>
            <ConfigField
              label="Refresh interval (ms)"
              description="Minimum one second; startup always computes once."
            >
              <Input
                min={MIN_REFRESH_INTERVAL_MS}
                step={1000}
                type="number"
                value={draft.refresh_interval_ms}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    refresh_interval_ms: Number(event.target.value),
                  })
                }
              />
            </ConfigField>
          </ConfigFormGrid>

          <ConfigToggleRow
            label="Enabled"
            description="Disabled sources never compute or publish."
          >
            <input
              checked={draft.enabled}
              className="size-4 rounded border border-input accent-primary"
              type="checkbox"
              onChange={(event) =>
                onChange({ ...draft, enabled: event.target.checked })
              }
            />
          </ConfigToggleRow>
        </ConfigFormSection>

        <ConfigFormSection
          title="Legacy aliases"
          description="Device keys this source also answers for, one per line. The alias resolves to the same entity and never duplicates it."
        >
          <Textarea
            placeholder="circadian/color"
            rows={3}
            value={(draft.aliases ?? []).join('\n')}
            onChange={(event) =>
              onChange({
                ...draft,
                aliases: event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </ConfigFormSection>
      </TabsContent>

      <TabsContent value="compute" className="space-y-4 pt-4">
        <ConfigFormSection
          title="Computation"
          description="Built-in presets are frozen and versioned; script presets are shipped assets you can fork into a DB-backed body."
        >
          <ConfigField label="Kind">
            <select
              className={selectClassName}
              value={compute.kind}
              onChange={(event) => {
                if (event.target.value === 'circadian_compat') {
                  setCompute({
                    kind: 'circadian_compat',
                    preset_version: 1,
                    params: circadianParamsToJson(circadianParamsOf(compute)),
                  });
                } else {
                  const first = presets[0];
                  setCompute({
                    kind: 'script',
                    preset: first
                      ? { id: first.id, version: first.version }
                      : undefined,
                    source_body: first ? undefined : SOURCE_SCRIPT_STARTER,
                    params: circadianParamsToJson(circadianParamsOf(compute)),
                  });
                }
              }}
            >
              <option value="circadian_compat">
                Built-in circadian preset
              </option>
              <option value="script">JavaScript script</option>
            </select>
          </ConfigField>

          {compute.kind === 'script' ? (
            <>
              <ConfigField
                label="Shipped preset"
                description="Pinned by id and version so later preset updates never mutate this source."
              >
                <select
                  className={selectClassName}
                  value={
                    compute.preset
                      ? `${compute.preset.id}@${compute.preset.version}`
                      : 'custom'
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === 'custom') {
                      setCompute({
                        kind: 'script',
                        source_body:
                          compute.source_body ??
                          shippedPreset?.source_body ??
                          SOURCE_SCRIPT_STARTER,
                        params: compute.params,
                      });
                      return;
                    }
                    const [id, version] = value.split('@');
                    const match = presets.find(
                      (candidate) =>
                        candidate.id === id &&
                        candidate.version === Number(version),
                    );
                    setCompute({
                      kind: 'script',
                      preset: { id, version: Number(version) },
                      params: match?.default_params ?? compute.params,
                    });
                  }}
                >
                  {presets.map((candidate) => (
                    <option
                      key={`${candidate.id}@${candidate.version}`}
                      value={`${candidate.id}@${candidate.version}`}
                    >
                      {candidate.name} v{candidate.version}
                    </option>
                  ))}
                  <option value="custom">Custom script</option>
                </select>
              </ConfigField>

              {shippedPreset ? (
                <ConfigHelpPanel>
                  <p>{shippedPreset.description}</p>
                  <div className="mt-3">
                    <Button size="sm" type="button" onClick={forkPreset}>
                      Fork into editable script
                    </Button>
                  </div>
                </ConfigHelpPanel>
              ) : null}
            </>
          ) : null}
        </ConfigFormSection>
      </TabsContent>

      <TabsContent value="params" className="space-y-4 pt-4">
        {circadianShaped ? (
          <ConfigFormSection
            title="Circadian parameters"
            description="Strictly validated: fades must not cross midnight or overlap, and brightness stays optional."
          >
            <SourceParamsForm
              params={circadianParamsOf(compute)}
              onChange={(params) =>
                setCompute({
                  ...compute,
                  params: circadianParamsToJson(params),
                })
              }
            />
          </ConfigFormSection>
        ) : (
          <ConfigFormSection
            title="Parameters"
            description="Opaque JSON object passed to the script as ctx.params."
          >
            <Textarea
              className="font-mono text-xs"
              rows={10}
              value={JSON.stringify(
                compute.kind === 'script' ? compute.params : {},
                null,
                2,
              )}
              onChange={(event) => {
                try {
                  const parsed = JSON.parse(event.target.value);
                  setCompute({ ...compute, params: parsed });
                  setJsonError(null);
                } catch {
                  setJsonError('Parameters must be valid JSON.');
                }
              }}
            />
            {jsonError ? (
              <p className="text-xs text-destructive">{jsonError}</p>
            ) : null}
          </ConfigFormSection>
        )}
      </TabsContent>

      <TabsContent value="script" className="space-y-4 pt-4">
        {compute.kind !== 'script' ? (
          <ConfigHelpPanel>
            Switch the computation kind to JavaScript to author or fork a script
            body.
          </ConfigHelpPanel>
        ) : compute.preset ? (
          <ConfigFormSection
            title="Shipped preset body"
            description="Read-only asset. Fork it to edit a DB-backed copy; the shipped preset stays untouched for everyone else."
            actions={
              shippedPreset ? (
                <Button size="sm" type="button" onClick={forkPreset}>
                  Fork
                </Button>
              ) : undefined
            }
          >
            <SourceScriptEditor
              readOnly
              value={shippedPreset?.source_body ?? ''}
              onChange={() => undefined}
            />
          </ConfigFormSection>
        ) : (
          <ConfigFormSection
            title="Script body"
            description="Pure function body returning one light profile. Reads parameters and injected civil time only."
            actions={
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() =>
                  setCompute({
                    kind: 'script',
                    source_body: SOURCE_SCRIPT_STARTER,
                    params: compute.params,
                  })
                }
              >
                Insert starter
              </Button>
            }
          >
            <SourceScriptEditor
              value={compute.source_body ?? ''}
              onChange={(source_body) =>
                setCompute({ ...compute, source_body })
              }
            />
          </ConfigFormSection>
        )}
      </TabsContent>

      <TabsContent value="preview">
        <SourcePreviewPanel timezone={draft.timezone} compute={compute} />
      </TabsContent>

      <TabsContent value="json" className="space-y-4 pt-4">
        <ConfigFormSection
          title="Raw definition"
          description="Advanced escape hatch. Apply parses the JSON back into the editor."
        >
          <Textarea
            className="font-mono text-xs"
            rows={16}
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonText) as SourceConfig;
                  onChange(parsed);
                  setJsonError(null);
                } catch {
                  setJsonError('Definition must be valid JSON.');
                }
              }}
            >
              Apply JSON
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setJsonText(JSON.stringify(draft, null, 2));
                setJsonError(null);
              }}
            >
              Reload from editor
            </Button>
          </div>
          {jsonError ? (
            <p className="text-xs text-destructive">{jsonError}</p>
          ) : null}
        </ConfigFormSection>
      </TabsContent>

      {error ? (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ConfigFormActions>
        {onDelete ? (
          <Button
            className="sm:mr-auto"
            type="button"
            variant="destructive"
            onClick={onDelete}
          >
            Delete
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={saving} type="button" onClick={onSave}>
          {saving ? 'Saving…' : 'Save source'}
        </Button>
      </ConfigFormActions>
    </Tabs>
  );
}

export default function SourcesConfigPage() {
  const { data: sources, loading, error, update, remove } = useSources();
  const { data: presets } = useSourcePresets();
  const liveDevices = useDevicesState();

  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceConfig | null>(null);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('edit');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const visibleSources = useMemo(
    () =>
      sources.filter((source) =>
        matchesConfigSearch(search, ...sourceSearchValues(source)),
      ),
    [search, sources],
  );

  useAssistantPageContext(
    draft
      ? {
          kind: 'computed_source',
          id: draft.id.trim() ? draft.id : undefined,
          label: draft.name || draft.id || 'New source',
        }
      : { kind: 'computed_source' },
  );

  const openEditor = (source: SourceConfig) => {
    setDraft(JSON.parse(JSON.stringify(source)) as SourceConfig);
    setEditorMode('edit');
    setSaveError(null);
    setOpenId(source.id);
  };

  const openCreate = () => {
    setDraft(newSourceDraft());
    setEditorMode('create');
    setSaveError(null);
    setOpenId(null);
  };

  const closeEditor = () => {
    setDraft(null);
    setOpenId(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!draft) {
      return;
    }
    const invalid = validationError(draft);
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await update(draft.id, draft);
      closeEditor();
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error ? saveFailure.message : 'Failed to save',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!draft || editorMode === 'create') {
      return;
    }
    if (
      !(await confirmDestructive(
        `Delete source "${draft.name}"?`,
        'Routines, scripts, and widgets that reference this source will stop resolving until it is recreated.',
      ))
    ) {
      return;
    }
    setSaving(true);
    try {
      await remove(draft.id);
      closeEditor();
    } catch (deleteFailure) {
      setSaveError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : 'Failed to delete',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConfigPageHeader
        title="Computed sources"
        description="Server-owned values computed from pure inputs and published as read-only sensors under computed/<id>."
        actions={
          <Button type="button" onClick={openCreate}>
            New source
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ConfigListSearchBar
        filteredCount={visibleSources.length}
        onChange={setSearch}
        placeholder="Search sources"
        totalCount={sources.length}
        value={search}
      />

      {visibleSources.length === 0 ? (
        <ConfigHelpPanel>
          No computed sources yet. Create one to publish a circadian profile
          without an integration wrapper.
        </ConfigHelpPanel>
      ) : null}

      <div className="grid gap-4">
        {visibleSources.map((source) => {
          const device = liveDevices?.[`computed/${source.id}`];
          return (
            <ExpandableConfigCard
              key={source.id}
              open={openId === source.id}
              onOpen={() => openEditor(source)}
              onClose={closeEditor}
              dialogTitle={source.name}
              dialogSubtitle={`computed/${source.id}`}
              summary={
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">
                        {source.name}
                      </span>
                      <Badge variant={source.enabled ? 'default' : 'muted'}>
                        {source.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <Badge variant="outline">
                        {kindLabel(source.compute)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      computed/{source.id} · {source.timezone} · every{' '}
                      {Math.round(source.refresh_interval_ms / 1000)}s
                      {(source.aliases ?? []).length > 0
                        ? ` · aliases: ${(source.aliases ?? []).join(', ')}`
                        : ''}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground sm:text-right">
                    {liveValue(device) ?? 'No value yet'}
                  </div>
                </div>
              }
            >
              <SourceEditor
                draft={draft ?? source}
                presets={presets}
                onChange={setDraft}
                onSave={save}
                onCancel={closeEditor}
                onDelete={deleteDraft}
                saving={saving}
                error={saveError}
                isNew={false}
              />
            </ExpandableConfigCard>
          );
        })}
      </div>

      <ResponsiveOverlay
        open={draft !== null && editorMode === 'create'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeEditor();
          }
        }}
        title="New computed source"
        description="Publishes a read-only sensor under computed/<id>."
        presentation="fullscreen"
        className="max-w-6xl"
      >
        {draft ? (
          <div className="px-5 pb-5 md:px-0 md:pb-0">
            <SourceEditor
              draft={draft}
              presets={presets}
              onChange={setDraft}
              onSave={save}
              onCancel={closeEditor}
              saving={saving}
              error={saveError}
              isNew
            />
          </div>
        ) : null}
      </ResponsiveOverlay>
    </div>
  );
}
