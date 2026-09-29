import { IdentityFields } from '@/ui/settings/IdentityFields';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Eye, LoaderCircle, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useAppConfig } from '@/hooks/appConfig';
import {
  useGroups,
  useRoutines,
  useScenes,
  useSources,
  readApiResponse,
  type Scene,
  type SceneDeviceConfig,
} from '@/hooks/useConfig';
import { useScenesState } from '@/hooks/websocket';
import { entityFieldProps, useEntityDraft } from '@/hooks/useEntityDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { deepEqual } from '@/lib/configSection';
import { configItemHref } from '@/lib/configItemHref';
import { orderedSceneTargets, sourceAliasKeys } from '@/lib/sceneTargets';
import {
  validateSceneDraft,
  sceneTargetDraftPath,
  type SceneDraftContext,
} from '@/lib/sceneDraft';
import { suggestId } from '@/lib/groupGraph';
import { captureSceneDeviceState } from '@/lib/sceneCapture';
import { createUuid } from '@/lib/uuid';
import type { ControllableState } from '@/bindings/ControllableState';
import type { DeviceStateSource } from '@/bindings/DeviceStateSource';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { EntityPicker } from '@/ui/settings/EntityPicker';
import { StatePreview } from '@/ui/settings/StatePreview';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { useDeviceLookups } from '../groups/shared';
import { SceneTargetRow } from './target-row';

const ScriptEditor = lazy(() => import('@/ui/SceneScriptEditor'));
const EMPTY: Scene = {
  id: '',
  name: '',
  hidden: false,
  device_states: {},
  group_states: {},
};
type ScenePreview = {
  devices: Record<
    string,
    { state: ControllableState; source: DeviceStateSource }
  >;
  active_overrides: string[];
  script_evaluated: boolean;
  evaluated_at: string;
};
function referencesScene(value: unknown, id: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value))
    return value.some((item) => referencesScene(item, id));
  return Object.entries(value).some(
    ([key, value]) =>
      (key === 'scene_id' && value === id) || referencesScene(value, id),
  );
}
export function SceneEditor({ id }: { id?: string }) {
  const creating = id === undefined;
  const api = useScenes();
  const groups = useGroups();
  const routines = useRoutines();
  const sources = useSources();
  const lookups = useDeviceLookups();
  const runtimeScenes = useScenesState();
  const { apiEndpoint } = useAppConfig();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [showScript, setShowScript] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [preview, setPreview] = useState<{
    data: ScenePreview;
    input: Scene;
  }>();
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [activating, setActivating] = useState(false);
  const saved = api.data.find((scene) => scene.id === id);
  const captureId = creating ? params.get('capture') : null;
  const key = `${apiEndpoint}/scenes/${id ?? '$new'}${captureId ? '/' + captureId : ''}`;
  const returnTo = params.get('returnTo');
  const liveReturn =
    returnTo && /^\/(map|groups)(\/|\?|$)/.test(returnTo) ? returnTo : null;
  const href = creating
    ? `/config/scenes/new${params.size ? '?' + params.toString() : ''}`
    : configItemHref('scene', id!);
  const copyFrom = api.data.find((row) => row.id === params.get('copyFrom'));
  const initial = useMemo(
    () =>
      copyFrom
        ? {
            ...copyFrom,
            id: suggestId(
              `Copy of ${copyFrom.name}`,
              api.data.map((row) => row.id),
            ),
            name: `Copy of ${copyFrom.name}`,
          }
        : EMPTY,
    [copyFrom, api.data],
  );
  const draft = useEntityDraft({
    key,
    item: creating ? initial : saved,
    label: saved?.name ?? 'New scene',
    href,
    validate(value) {
      const errors = validateSceneDraft(value);
      if (creating && api.data.some((scene) => scene.id === value.id))
        errors.push({
          field: 'id',
          message: 'This scene ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      const result = creating
        ? await api.create(value)
        : await api.update(value.id, value, expected);
      if (creating && result) {
        entityDraftStore.forget(key);
        // The originating editor owns how the returned scene is selected.
        const returnTo = params.get('returnTo');
        if (
          returnTo?.startsWith('/config/routines/') &&
          !returnTo.startsWith('//')
        ) {
          const destination = new URL(returnTo, window.location.origin);
          destination.searchParams.set('scene', result.id);
          navigate(`${destination.pathname}${destination.search}`, {
            replace: true,
          });
        } else
          navigate(
            configItemHref('scene', result.id) +
              (liveReturn
                ? '?' + new URLSearchParams({ returnTo: liveReturn })
                : ''),
            { replace: true },
          );
      }
      return result;
    },
  });
  const scene = draft.value;
  const context: SceneDraftContext = useMemo(
    () => ({
      scenes: scene
        ? [...api.data.filter((row) => row.id !== scene.id), scene]
        : api.data,
      groups: groups.data,
      devices: lookups.devicesByKey,
      aliases: sourceAliasKeys(sources.data),
    }),
    [scene, api.data, groups.data, lookups.devicesByKey, sources.data],
  );
  const deviceOptions = lookups.options
    .filter((option) => 'Controllable' in option.device.data)
    .map((option) => ({ id: option.key, name: option.label }));
  const sourceOptions = lookups.options.map((option) => ({
    id: option.key,
    name: option.label,
  }));
  const usedBy = [
    ...routines.data
      .filter((row) => referencesScene(row, id ?? ''))
      .map((row) => ({ ...row, kind: 'routine' })),
    ...api.data
      .filter((row) => row.id !== id && referencesScene(row, id ?? ''))
      .map((row) => ({ ...row, kind: 'scene' })),
  ];
  const overrides = id ? (runtimeScenes?.[id]?.active_overrides ?? []) : [];
  const hasScene = Boolean(scene);
  useAssistantPageContext(
    saved ? { kind: 'scene', id: saved.id, label: saved.name } : null,
  );
  useEffect(() => {
    const target = params.get('target') ?? params.get('device');
    if (hasScene && target) {
      setQuery(target);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            `[data-target-key="${CSS.escape(target)}"]`,
          )
          ?.scrollIntoView({ block: 'center' }),
      );
      return;
    }
    const section = params.get('section');
    if (hasScene && section)
      requestAnimationFrame(() =>
        document.getElementById(section)?.scrollIntoView({ block: 'start' }),
      );
  }, [hasScene, params]);
  async function runPreview() {
    if (!scene || previewing) return;
    const errors = validateSceneDraft(scene);
    if (errors.length) {
      entityDraftStore.errors(key, errors);
      return;
    }
    setPreviewing(true);
    setPreviewError('');
    const input = structuredClone(scene);
    try {
      const result = await readApiResponse<ScenePreview>(
        await fetch(`${apiEndpoint}/api/v1/config/scenes/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(20_000),
        }),
        'Could not preview the scene',
      );
      if (!result.data) throw new Error('The preview response was empty');
      setPreview({ data: result.data, input });
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'Could not preview the scene',
      );
    } finally {
      setPreviewing(false);
    }
  }
  async function activateSaved() {
    if (!saved || activating) return;
    if (
      !(await confirmDialog({
        title: `Activate ${saved.name}?`,
        description: `This commands the scene's devices now.${draft.dirty ? ' It uses the saved scene; your unsaved draft stays here.' : ''}`,
        confirmLabel: 'Activate saved scene',
      }))
    )
      return;
    setActivating(true);
    try {
      const response = await fetch(`${apiEndpoint}/api/v1/commands/scene`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: createUuid(),
          scene_id: saved.id,
          device_keys: null,
          group_keys: null,
          use_scene_transition: true,
          transition: null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.applied)
        throw new Error(result.error ?? 'The scene was not activated');
      toast.success('Scene activation accepted');
    } catch (error) {
      toast.error(
        error instanceof DOMException && error.name === 'TimeoutError'
          ? 'The command timed out. Check device state before trying again; the server may have accepted it.'
          : error instanceof Error
            ? error.message
            : 'Could not activate the scene',
      );
    } finally {
      setActivating(false);
    }
  }
  async function removeScene() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description: `${usedBy.length} configurations reference this scene.${draft.dirty ? ' Unsaved changes will be discarded.' : ''}`,
        confirmLabel: 'Delete scene',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/scenes');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete scene',
      );
    }
  }
  function updateTargets(kind: 'group' | 'device', ids: string[]) {
    if (!scene) return;
    const field = kind === 'group' ? 'group_states' : 'device_states';
    const targets = Object.fromEntries(
      ids.map((id) => [id, scene[field][id] ?? {}]),
    );
    const removed = Object.keys(scene[field])
      .filter((id) => !ids.includes(id))
      .map((id) => sceneTargetDraftPath(kind, id));
    entityDraftStore.remapEditorPaths(key, (path) =>
      removed.some((slot) => path === slot || path.startsWith(slot + '/'))
        ? null
        : path,
    );
    draft.patch({
      [field]: targets,
      ...(kind === 'group'
        ? {
            group_state_order: [
              ...(scene.group_state_order ?? []).filter((id) =>
                ids.includes(id),
              ),
              ...ids.filter(
                (id) => !(scene.group_state_order ?? []).includes(id),
              ),
            ],
          }
        : {}),
    });
  }
  async function captureTargets() {
    if (
      !scene ||
      !(await confirmDialog({
        title: 'Capture device states?',
        description:
          'Replace the individual device targets in this draft with their current requested states. This also replaces any follow-device or follow-scene behavior on those targets.',
        confirmLabel: 'Capture states',
      }))
    )
      return;
    draft.patch({
      device_states: Object.fromEntries(
        Object.entries(scene.device_states).map(([key, value]) => {
          const device = lookups.devicesByKey[key];
          return [
            key,
            device && 'Controllable' in device.data
              ? captureSceneDeviceState(device).state
              : value,
          ];
        }),
      ),
    });
  }
  function targetSection(kind: 'group' | 'device') {
    if (!scene) return null;
    const field = kind === 'group' ? 'group_states' : 'device_states';
    const entries =
      kind === 'group'
        ? orderedSceneTargets(scene.group_states, scene.group_state_order)
        : Object.entries(scene.device_states);
    const label = (key: string) =>
      kind === 'group'
        ? (groups.data.find((row) => row.id === key)?.name ?? key)
        : lookups.labelFor(key);
    const filtered = entries.filter(([key]) =>
      `${label(key)} ${key}`.toLowerCase().includes(query.toLowerCase().trim()),
    );
    const options =
      kind === 'group'
        ? groups.data.map((group) => ({ id: group.id, name: group.name }))
        : deviceOptions;
    const update = (target: string, value: SceneDeviceConfig) =>
      draft.patch({ [field]: { ...scene[field], [target]: value } });
    return (
      <SettingsSection
        id={kind === 'group' ? 'rooms' : 'devices'}
        title={
          kind === 'group'
            ? `Rooms & groups · ${entries.length}`
            : `Device targets · ${entries.length}`
        }
        description={
          kind === 'group'
            ? 'Applied in order. Later groups win when membership overlaps.'
            : 'Device targets override group targets for the same device.'
        }
        actions={
          <>
            {kind === 'device' && entries.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Capture requested device states"
                title="Capture requested device states"
                disabled={lookups.loading || Boolean(lookups.error)}
                onClick={() => void captureTargets()}
              >
                <Camera className="size-4" />
              </Button>
            )}
            <EntityPicker
              title={kind === 'group' ? 'Rooms & groups' : 'Devices'}
              actionLabel={kind === 'group' ? 'Add groups' : 'Add devices'}
              options={options}
              selected={Object.keys(scene[field])}
              onChange={(ids) => updateTargets(kind, ids)}
            />
          </>
        }
      >
        {!entries.length ? (
          <p className="text-xs text-muted-foreground">
            {kind === 'group'
              ? 'No group targets.'
              : 'No individual device targets.'}
          </p>
        ) : (
          <div
            role="table"
            aria-label={
              kind === 'group' ? 'Group target states' : 'Device target states'
            }
          >
            <div role="row" className="scene-table-heading">
              {[
                'Target',
                'Behavior',
                'Power',
                'Brightness',
                'Color',
                'Fade (s)',
                '',
              ].map((heading, index) => (
                <span role="columnheader" key={index}>
                  {heading}
                </span>
              ))}
            </div>
            {filtered.slice(0, limit).map(([target, value]) => (
              <SceneTargetRow
                key={target}
                kind={kind}
                targetKey={target}
                name={label(target)}
                config={value}
                context={context}
                catalogReady={!lookups.loading && !lookups.error}
                draftKey={key}
                deviceOptions={sourceOptions}
                onChange={(value) => update(target, value)}
                onRemove={() =>
                  updateTargets(
                    kind,
                    Object.keys(scene[field]).filter((key) => key !== target),
                  )
                }
                canMoveUp={entries.findIndex(([key]) => key === target) > 0}
                canMoveDown={
                  entries.findIndex(([key]) => key === target) <
                  entries.length - 1
                }
                onMove={
                  kind === 'group'
                    ? (direction) => {
                        const order = entries.map(([key]) => key);
                        const index = order.indexOf(target);
                        [order[index], order[index + direction]] = [
                          order[index + direction],
                          order[index],
                        ];
                        draft.patch({ group_state_order: order });
                      }
                    : undefined
                }
                onReplace={(replacement) => {
                  if (replacement in scene[field]) {
                    toast.error('That target is already in this scene.');
                    return;
                  }
                  const next = { ...scene[field] };
                  delete next[target];
                  next[replacement] = value;
                  const previousSlot = sceneTargetDraftPath(kind, target);
                  const replacementSlot = sceneTargetDraftPath(
                    kind,
                    replacement,
                  );
                  entityDraftStore.remapEditorPaths(key, (path) =>
                    path === previousSlot || path.startsWith(previousSlot + '/')
                      ? replacementSlot + path.slice(previousSlot.length)
                      : path,
                  );
                  draft.patch({
                    [field]: next,
                    ...(kind === 'group'
                      ? {
                          group_state_order: entries.map(([key]) =>
                            key === target ? replacement : key,
                          ),
                        }
                      : {}),
                  });
                }}
              />
            ))}
          </div>
        )}
        {filtered.length > limit && (
          <Button
            variant="outline"
            onClick={() => setLimit((current) => current + 40)}
          >
            Show more ({filtered.length - limit} remaining)
          </Button>
        )}
        {entries.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">No matching targets.</p>
        )}
      </SettingsSection>
    );
  }
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/scenes"
      backLabel="Scenes"
      title={creating ? 'New scene' : (saved?.name ?? 'Scene')}
      status={
        <>
          {captureId
            ? 'Captured requested states. Review targets, then create the scene.'
            : 'Choose what each target sets or follows.'}
          {liveReturn && (
            <>
              {' '}
              <Link className="settings-link" to={liveReturn}>
                Return to controls
              </Link>
            </>
          )}
        </>
      }
      loading={api.loading || groups.loading}
      error={api.error ?? groups.error}
      onRetry={() => {
        void api.refetch();
        void groups.refetch();
      }}
      notFound={!creating && !saved && !draft.dirty}
      primaryAction={
        <Button
          variant="outline"
          disabled={previewing}
          onClick={() => void runPreview()}
        >
          {previewing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Eye className="size-4" />
          )}
          Preview draft
        </Button>
      }
      menu={
        creating
          ? undefined
          : [
              {
                label: activating ? 'Activating…' : 'Activate saved scene',
                onSelect: () => void activateSaved(),
                disabled: activating,
              },
              {
                label: 'Delete scene',
                onSelect: () => void removeScene(),
                destructive: true,
                disabled: draft.saving,
              },
            ]
      }
    >
      {scene && (
        <>
          <SettingsSection id="details" title="Details">
            <IdentityFields
              draft={draft}
              creating={creating}
              existingIds={api.data.map((row) => row.id)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!scene.hidden}
                  onChange={(event) =>
                    draft.patch({ hidden: !event.target.checked })
                  }
                />
                Show in scene lists
              </label>
            </div>
          </SettingsSection>
          {overrides.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <strong>{overrides.length} saved device overrides</strong> take
              precedence over the scene's targets and script. Open a device to
              review its persisted state.
              <div className="mt-2 flex flex-wrap gap-3">
                {overrides.map((key) => (
                  <Link
                    className="underline underline-offset-2"
                    key={key}
                    to={configItemHref('device', key)}
                  >
                    {lookups.labelFor(key)}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <label className="relative block max-w-md">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Filter targets"
              aria-label="Filter scene targets"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(40);
              }}
            />
          </label>
          {lookups.error && (
            <p role="alert" className="text-sm text-destructive">
              Device catalog unavailable. Saved targets are kept; previews may
              be incomplete.
            </p>
          )}
          {targetSection('group')}
          {targetSection('device')}
          {showScript || Boolean(scene.script) ? (
            <SettingsSection
              id="script"
              title="Scene script"
              description="Evaluated script output overrides matching group and device targets. Saved runtime overrides take precedence over the script."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    draft.change((current) => {
                      const next = { ...current };
                      delete next.script;
                      return next;
                    });
                    setShowScript(false);
                  }}
                >
                  Remove script
                </Button>
              }
            >
              <Suspense
                fallback={
                  <p className="text-xs text-muted-foreground">
                    Loading script editor…
                  </p>
                }
              >
                <ScriptEditor
                  value={scene.script ?? ''}
                  onChange={(script) => draft.patch({ script })}
                  deviceOptions={sourceOptions.map((option) => ({
                    key: option.id,
                    label: option.name,
                  }))}
                  groupOptions={groups.data.map((group) => ({
                    key: group.id,
                    label: group.name,
                  }))}
                  sceneIds={api.data.map((row) => row.id)}
                />
              </Suspense>
            </SettingsSection>
          ) : (
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => setShowScript(true)}
            >
              <Plus className="size-4" />
              Add scene script
            </Button>
          )}
          {(preview || previewError || previewing) && (
            <SettingsSection
              id="preview"
              title="Draft preview"
              description="Computed by the server on an isolated copy. No devices are commanded."
            >
              {previewError && (
                <p role="alert" className="text-sm text-destructive">
                  {previewError}
                </p>
              )}
              {preview && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Evaluated{' '}
                    {new Date(preview.data.evaluated_at).toLocaleTimeString()}
                    {!deepEqual(preview.input, scene) &&
                      ' · Draft changed since this preview. Run Preview draft again.'}
                    {preview.data.script_evaluated &&
                      ' · Draft script evaluated'}
                  </p>
                  <div className="divide-y divide-border">
                    {Object.entries(preview.data.devices).map(
                      ([key, result]) => (
                        <div
                          key={key}
                          className="flex min-h-12 items-center gap-3 py-2"
                        >
                          <StatePreview
                            {...result.state}
                            brightness={
                              result.state.brightness ??
                              (result.state.power ? 1 : null)
                            }
                            source="Draft resolution"
                          />
                          <Link
                            className="min-w-0 flex-1 truncate text-sm hover:underline"
                            to={configItemHref('device', key)}
                          >
                            {lookups.labelFor(key)}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {result.state.power
                              ? `${Math.round((result.state.brightness ?? 1) * 100)}%`
                              : 'Off'}{' '}
                            · {String(result.source.scope)}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                  {Object.keys(preview.data.devices).length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No device states resolved. Check missing targets and
                      source links.
                    </p>
                  )}
                </>
              )}
            </SettingsSection>
          )}
          {!creating && (
            <SettingsSection id="usage" title="Used by">
              <div className="flex flex-wrap gap-2">
                {usedBy.map((row) => (
                  <Button
                    asChild
                    key={`${row.kind}/${row.id}`}
                    variant="outline"
                    size="sm"
                  >
                    <Link to={configItemHref(row.kind, row.id)}>
                      {row.name}
                    </Link>
                  </Button>
                ))}
                {!usedBy.length && (
                  <p className="text-xs text-muted-foreground">
                    No other configuration references this scene.
                  </p>
                )}
              </div>
            </SettingsSection>
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create scene' : undefined}
          />
        </>
      )}
    </DetailPageShell>
  );
}
