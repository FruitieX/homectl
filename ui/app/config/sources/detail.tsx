import { Trash2 } from 'lucide-react';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { DeviceColor } from '@/bindings/DeviceColor';
import {
  useSources,
  useSourcePresets,
  useScenes,
  useGroups,
  useRoutines,
  useBlocks,
  type SourceConfig,
  type SourceComputeConfig,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { useAppConfig } from '@/hooks/appConfig';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { entityDraftStore } from '@/lib/entityDraft';
import {
  groupUsesDeviceKeys,
  routineReferences,
  sceneUsesDeviceKeys,
} from '@/lib/configUsage';
import { configItemHref } from '@/lib/configItemHref';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { StatePreview } from '@/ui/settings/StatePreview';
import { SceneColorControl } from '@/ui/settings/SceneColorControl';
import { JsonValueEditor } from '@/ui/settings/JsonValueEditor';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { SourcePreviewPanel } from '@/ui/SourcePreviewPanel';
import SourceScriptEditor, {
  SOURCE_SCRIPT_STARTER,
} from '@/ui/SourceScriptEditor';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  computationKey,
  sourceDefaults,
  validateSourceDraft,
  sourceParamField,
  validateSourceTiming,
} from './shared';

export default function SourceDetailPage() {
  const { id } = useParams(),
    creating = id === 'new',
    navigate = useNavigate();
  const api = useSources(),
    health = useDeviceHealth(),
    presets = useSourcePresets(),
    scenes = useScenes(),
    groups = useGroups(),
    routines = useRoutines(),
    blocks = useBlocks(),
    devices = useDevicesState();
  const { apiEndpoint } = useAppConfig(),
    { advanced } = useSettingsPreferences();
  const saved = api.data.find((row) => row.id === id),
    empty = useMemo(() => sourceDefaults(), []);
  const sourceHealth = health.data?.devices?.[`computed/${id}`];
  const key = `${apiEndpoint}/sources/${creating ? '$new' : id}`;
  const draft = useEntityDraft({
    key,
    item: creating ? empty : saved,
    label: saved?.name ?? 'New computed source',
    href: creating ? '/config/sources/new' : configItemHref('source', id!),
    validate(value) {
      const errors = validateSourceDraft(value);
      if (creating && api.data.some((row) => row.id === value.id))
        errors.push({
          field: 'id',
          message: 'This source ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      const request: SourceConfig & { create_only?: boolean } = {
        ...value,
        ...(creating ? { create_only: true } : {}),
      };
      const result = await api.update(
        value.id,
        request,
        creating ? undefined : expected,
      );
      if (result && creating) {
        draft.forget();
        navigate(configItemHref('source', result.id), { replace: true });
      }
      return result;
    },
  });
  const value = draft.value,
    compute = value?.compute,
    selection = compute ? computationKey(compute) : '';
  const preset =
    compute?.kind === 'script' && compute.preset
      ? presets.data.find(
          (row) =>
            row.id === compute.preset!.id &&
            row.version === compute.preset!.version,
        )
      : undefined;
  const rawParams = compute?.params,
    params =
      rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? (rawParams as Record<string, unknown>)
        : {};
  const circadian =
    rawParams != null &&
    typeof rawParams === 'object' &&
    !Array.isArray(rawParams) &&
    ((compute?.kind === 'circadian_compat' && compute.preset_version === 1) ||
      (compute?.kind === 'script' &&
        compute.preset?.id === 'circadian' &&
        compute.preset.version === 1));
  const knownParams = [
    'day_fade_start',
    'day_fade_duration_hours',
    'day_color',
    'day_brightness',
    'night_fade_start',
    'night_fade_duration_hours',
    'night_color',
    'night_brightness',
  ];
  const extraParams = Object.fromEntries(
    Object.entries(params).filter(([field]) => !knownParams.includes(field)),
  );
  const data = devices?.[`computed/${id}`]?.data,
    live =
      data && 'Sensor' in data && 'color' in data.Sensor ? data.Sensor : null;
  useAssistantPageContext(
    saved
      ? { kind: 'computed_source', id: saved.id, label: saved.name }
      : { kind: 'computed_source' },
  );
  const patchCompute = (next: SourceComputeConfig) =>
    draft.patch({ compute: next });
  const patchParam = (field: string, next: unknown) => {
    if (!compute) return;
    const nextParams = { ...params };
    if (next === undefined) delete nextParams[field];
    else nextParams[field] = next;
    patchCompute({ ...compute, params: nextParams });
  };
  function switchComputation(nextKey: string) {
    if (!compute) return;
    const match = presets.data.find(
      (row) => `${row.id}@${row.version}` === nextKey,
    );
    const fallback: SourceComputeConfig =
      nextKey === 'circadian_compat'
        ? sourceDefaults().compute
        : match
          ? {
              kind: 'script',
              preset: { id: match.id, version: match.version },
              params: match.default_params,
            }
          : {
              kind: 'script',
              source_body: preset?.source_body ?? SOURCE_SCRIPT_STARTER,
              params: compute.params,
            };
    patchCompute(
      entityDraftStore.switchVariant(
        key,
        'source-compute',
        selection,
        compute,
        nextKey,
        fallback,
      ),
    );
  }
  async function remove() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description:
          'Scenes and routines following this source will lose their input.',
        confirmLabel: 'Delete source',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/sources');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  const aliases =
      Array.isArray(value?.aliases) &&
      value.aliases.every((alias) => typeof alias === 'string')
        ? value.aliases
        : [],
    malformedAliases =
      value?.aliases !== undefined &&
      (!Array.isArray(value.aliases) ||
        value.aliases.some((alias) => typeof alias !== 'string')),
    keys = new Set([
      `computed/${id}`,
      ...(Array.isArray(saved?.aliases) ? saved.aliases : []),
    ]);
  const usage = [
    {
      kind: 'scene' as const,
      label: 'Scenes',
      query: scenes,
      rows: scenes.data.filter((scene) => sceneUsesDeviceKeys(scene, keys)),
    },
    {
      kind: 'group' as const,
      label: 'Rooms & groups',
      query: groups,
      rows: groups.data.filter((group) => groupUsesDeviceKeys(group, keys)),
    },
    {
      kind: 'routine' as const,
      label: 'Routines',
      query: routines,
      rows: routines.data.filter((row) => {
        const refs = routineReferences(row.definition_v2, blocks.data);
        return (
          refs.sources.has(id ?? '') ||
          [...refs.devices].some((key) => keys.has(key))
        );
      }),
    },
  ];
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/sources"
      backLabel="Computed sources"
      title={
        creating ? 'New computed source' : (saved?.name ?? 'Computed source')
      }
      status={
        advanced && saved
          ? `computed/${saved.id} · Revision ${saved.revision}`
          : undefined
      }
      loading={api.loading}
      error={api.error}
      onRetry={() => void api.refetch()}
      notFound={!creating && !saved && !draft.dirty}
      menu={
        !creating
          ? [
              {
                label: 'Delete source',
                onSelect: () => void remove(),
                destructive: true,
              },
            ]
          : undefined
      }
    >
      {value && compute && (
        <>
          {!creating && (
            <SettingsSection
              id="current"
              title="Current output"
              description="The running source’s last published output. Draft changes do not affect it until saved."
            >
              <div className="flex flex-wrap items-center gap-3">
                <StatePreview
                  color={live?.color}
                  brightness={live?.brightness}
                  power={live?.power}
                  certainty={live ? 'known' : 'unresolved'}
                  size={38}
                />
                <span className="text-sm">
                  {saved?.enabled
                    ? live
                      ? live.brightness == null
                        ? 'Brightness not specified'
                        : `${Math.round(live.brightness * 100)}% brightness`
                      : 'No output received yet'
                    : 'Disabled'}
                  {live?.color && 'ct' in live.color
                    ? ` · ${live.color.ct} K`
                    : ''}
                </span>
                {data && (
                  <Link
                    className="text-sm text-primary underline"
                    to={configItemHref('device', `computed/${id}`)}
                  >
                    Output device
                  </Link>
                )}
              </div>
              {health.isError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  Source health is unavailable.
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void health.refetch()}
                  >
                    Retry health
                  </Button>
                </div>
              ) : sourceHealth?.issues.length ? (
                <div
                  role="alert"
                  className="space-y-2 text-sm text-amber-700 dark:text-amber-400"
                >
                  {live && (
                    <p>
                      The last published value is retained; it is not a fresh
                      computation.
                    </p>
                  )}
                  {sourceHealth.issues.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                  <Link
                    className="text-primary underline"
                    to={`/config/logs?device=${encodeURIComponent(`computed/${id}`)}`}
                  >
                    Related logs
                  </Link>
                </div>
              ) : null}
            </SettingsSection>
          )}
          <SettingsSection id="details" title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid content-start gap-2 text-xs">
                Name
                <Input
                  data-field="name"
                  value={value.name}
                  onChange={(event) =>
                    draft.patch({ name: event.target.value })
                  }
                />
              </label>
              {creating && (
                <label className="grid content-start gap-2 text-xs">
                  Source ID
                  <Input
                    data-field="id"
                    value={value.id}
                    onChange={(event) =>
                      draft.patch({ id: event.target.value })
                    }
                  />
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.enabled}
                  onChange={(event) =>
                    draft.patch({ enabled: event.target.checked })
                  }
                />
                Enabled
              </label>
            </div>
          </SettingsSection>
          <SettingsSection id="schedule" title="Schedule">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid content-start gap-2 text-xs">
                Timezone
                <Input
                  data-field="timezone"
                  value={value.timezone}
                  onChange={(event) =>
                    draft.patch({ timezone: event.target.value })
                  }
                />
              </label>
              <label className="grid content-start gap-2 text-xs">
                Refresh interval (seconds)
                <DraftNumberInput
                  aria-label="Refresh interval (seconds)"
                  draftKey={key}
                  path="refresh_interval_ms"
                  value={value.refresh_interval_ms / 1000}
                  validate={(seconds) =>
                    seconds < 1 || seconds > 86400
                      ? 'Use an interval between 1 second and 24 hours.'
                      : Math.abs(seconds * 1000 - Math.round(seconds * 1000)) >
                          1e-7
                        ? 'Use whole milliseconds (up to three decimal places in seconds).'
                        : undefined
                  }
                  onValueChange={(seconds) =>
                    draft.patch({
                      refresh_interval_ms: Math.round(seconds! * 1000),
                    })
                  }
                />
              </label>
            </div>
          </SettingsSection>
          <SettingsSection id="compute" title="Computation">
            <label className="grid content-start gap-2 text-xs">
              Type
              <SettingsSelect
                data-field="compute"
                aria-label="Computation type"
                value={selection}
                onValueChange={switchComputation}
                options={[
                  { value: 'circadian_compat', label: 'Built-in circadian' },
                  ...presets.data.map((row) => ({
                    value: row.id + '@' + row.version,
                    label: row.name + ' · v' + row.version,
                  })),
                  { value: 'custom', label: 'Custom JavaScript' },
                  ...(compute.kind === 'script' && compute.preset && !preset
                    ? [
                        {
                          value: selection,
                          label:
                            'Unavailable preset: ' +
                            compute.preset.id +
                            ' · v' +
                            compute.preset.version,
                        },
                      ]
                    : []),
                  ...(compute.kind === 'circadian_compat' &&
                  compute.preset_version !== 1
                    ? [
                        {
                          value: selection,
                          label:
                            'Unavailable built-in circadian · v' +
                            compute.preset_version,
                        },
                      ]
                    : []),
                ]}
              />
            </label>
            {presets.error && (
              <p role="alert" className="mt-2 text-xs">
                Could not load presets.{' '}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void presets.refetch()}
                >
                  Retry
                </Button>
              </p>
            )}
            {preset && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                  {preset.description}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => switchComputation('custom')}
                >
                  {draft.entry?.variants?.['source-compute']?.custom
                    ? 'Return to custom draft'
                    : 'Copy to custom script'}
                </Button>
              </div>
            )}
          </SettingsSection>
          {circadian && (
            <SettingsSection
              id="profile"
              title="Day & night profile"
              description="Set the start and duration of each fade. Brightness can be left unspecified."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                {(['day', 'night'] as const).map((period) => {
                  const color = params[`${period}_color`] as
                      DeviceColor | undefined,
                    brightness = params[`${period}_brightness`] as
                      number | null | undefined;
                  return (
                    <div
                      key={period}
                      className="min-w-0 space-y-3 rounded-md border border-border p-3"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <StatePreview color={color} brightness={brightness} />
                        {period === 'day' ? 'Day' : 'Night'}
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="grid content-start gap-2 text-xs">
                          Fade starts
                          <Input
                            aria-label={`${period} fade starts`}
                            data-field={sourceParamField(
                              compute,
                              `${period}_fade_start`,
                            )}
                            type="time"
                            value={
                              typeof params[`${period}_fade_start`] === 'string'
                                ? (params[`${period}_fade_start`] as string)
                                : ''
                            }
                            onChange={(event) =>
                              patchParam(
                                `${period}_fade_start`,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="grid content-start gap-2 text-xs">
                          Duration (hours)
                          <DraftNumberInput
                            aria-label={`${period} fade duration`}
                            draftKey={key}
                            path={sourceParamField(
                              compute,
                              `${period}_fade_duration_hours`,
                            )}
                            validate={(hours) =>
                              !Number.isInteger(hours) ||
                              hours < 1 ||
                              hours > 24
                                ? 'Use 1–24 whole hours.'
                                : undefined
                            }
                            value={
                              typeof params[`${period}_fade_duration_hours`] ===
                              'number'
                                ? (params[
                                    `${period}_fade_duration_hours`
                                  ] as number)
                                : undefined
                            }
                            onValueChange={(hours) =>
                              patchParam(`${period}_fade_duration_hours`, hours)
                            }
                          />
                        </label>
                      </div>
                      <label className="grid content-start gap-2 text-xs">
                        Color
                        <SceneColorControl
                          field={`compute.params.${period}_color`}
                          color={color}
                          brightness={brightness}
                          capabilities={[
                            {
                              brightness: true,
                              ct: { start: 1000, end: 10000 },
                              hs: true,
                              rgb: false,
                              xy: false,
                            },
                          ]}
                          onChange={(next) =>
                            patchParam(`${period}_color`, next)
                          }
                        />
                      </label>
                      <label className="grid content-start gap-2 text-xs">
                        Brightness (%)
                        <DraftNumberInput
                          aria-label={`${period} brightness`}
                          draftKey={key}
                          path={sourceParamField(
                            compute,
                            `${period}_brightness`,
                          )}
                          optional
                          validate={(percent) =>
                            percent < 0 || percent > 100
                              ? 'Use brightness between 0 and 100%.'
                              : undefined
                          }
                          placeholder="Not specified"
                          value={
                            brightness == null
                              ? undefined
                              : Math.round(brightness * 1000) / 10
                          }
                          onValueChange={(percent) =>
                            patchParam(
                              `${period}_brightness`,
                              percent === undefined ? undefined : percent / 100,
                            )
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </SettingsSection>
          )}
          {(!circadian || Object.keys(extraParams).length > 0) && (
            <SettingsSection
              id="parameters"
              title={circadian ? 'Additional parameters' : 'Parameters'}
              description="Values passed to the computation."
            >
              <JsonValueEditor
                fixedType={circadian ? 'object' : undefined}
                value={circadian ? extraParams : compute.params}
                onChange={(next) => {
                  const nextParams = circadian
                    ? {
                        ...Object.fromEntries(
                          Object.entries(params).filter(([field]) =>
                            knownParams.includes(field),
                          ),
                        ),
                        ...(next as Record<string, unknown>),
                      }
                    : next;
                  patchCompute(
                    compute.kind === 'circadian_compat'
                      ? {
                          ...compute,
                          params: nextParams as Record<string, unknown>,
                        }
                      : { ...compute, params: nextParams },
                  );
                }}
                draftKey={key}
                path={`source-compute/${encodeURIComponent(selection)}/params`}
                label="Parameters"
              />
            </SettingsSection>
          )}
          {compute.kind === 'script' && !compute.preset && (
            <SettingsSection id="script" title="Script">
              <SourceScriptEditor
                value={compute.source_body ?? ''}
                onChange={(source_body) =>
                  patchCompute({ ...compute, source_body })
                }
              />
            </SettingsSection>
          )}
          <SettingsSection
            id="preview"
            title="Draft preview"
            description="Preview the current draft without saving or changing devices."
          >
            <SourcePreviewPanel
              timezone={value.timezone}
              compute={compute}
              blockedReason={
                validateSourceTiming(compute).length ||
                Object.entries(draft.entry?.inputs ?? {}).some(
                  ([path, input]) =>
                    path.startsWith('source-compute/') && input.error,
                )
                  ? 'Complete the invalid profile fields before previewing.'
                  : undefined
              }
            />
          </SettingsSection>
          <SettingsSection
            id="aliases"
            title="Aliases"
            description="Other device keys that resolve to this source. Existing scene links can keep using them."
          >
            <div data-field="aliases" tabIndex={-1} className="space-y-2">
              {malformedAliases ? (
                <JsonValueEditor
                  value={value.aliases}
                  label="Aliases"
                  draftKey={key}
                  path="aliases"
                  onChange={(aliases) =>
                    draft.patch({ aliases: aliases as string[] })
                  }
                />
              ) : (
                aliases.map((alias, index) => (
                  <div className="flex items-center gap-2" key={index}>
                    <Input
                      className="min-w-0 flex-1"
                      aria-label={`Alias ${index + 1}`}
                      value={alias}
                      placeholder="integration/device"
                      onChange={(event) =>
                        draft.patch({
                          aliases: aliases.map((item, i) =>
                            i === index ? event.target.value : item,
                          ),
                        })
                      }
                    />
                    <Button
                      size="icon"
                      className="shrink-0 md:size-8"
                      variant="ghost"
                      aria-label={`Remove alias ${index + 1}`}
                      onClick={() =>
                        draft.patch({
                          aliases: aliases.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
              {!malformedAliases && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => draft.patch({ aliases: [...aliases, ''] })}
                >
                  Add alias
                </Button>
              )}
            </div>
          </SettingsSection>
          {!creating && (
            <SettingsSection
              id="usage"
              title="Used by"
              description="Direct references to this source or its aliases, including declared script devices. Legacy automations, script bodies and indirect dependencies may add more."
            >
              {usage.map(({ kind, label, query, rows }) => (
                <div key={kind} className="space-y-2">
                  <h3 className="text-xs font-medium">{label}</h3>
                  {query.error ? (
                    <p role="alert">
                      Could not load references.{' '}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Retry ${label.toLowerCase()} references`}
                        onClick={() => void query.refetch()}
                      >
                        Retry
                      </Button>
                    </p>
                  ) : query.loading ? (
                    <p>Loading references…</p>
                  ) : rows.length ? (
                    <div className="flex flex-wrap gap-3">
                      {rows.map((row) => (
                        <Link
                          key={row.id}
                          className="text-sm text-primary underline"
                          to={configItemHref(kind, row.id)}
                        >
                          {row.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No direct references in {label.toLowerCase()}.
                    </p>
                  )}
                </div>
              ))}
            </SettingsSection>
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create source' : undefined}
          />
        </>
      )}
    </DetailPageShell>
  );
}
