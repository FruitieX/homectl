import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type Scene,
  type SceneDeviceConfig,
  getSceneDeviceLinkTargetKey,
  useGroups,
  useScenes,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { createUuid } from '@/lib/uuid';
import {
  describeSceneTarget,
  orderedSceneTargets,
  sceneTargetsSummary,
} from '@/lib/sceneTargets';
import { BoundedList } from '@/ui/config/BoundedList';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { StatusRegion, useStatusAnnouncements } from '@/ui/config/StatusRegion';
import { useDirtyNavigationGuard } from '@/ui/config/useDirtyNavigationGuard';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { ConfigField, ConfigFormSection, ConfigToggleRow } from '@/ui/config-form';
import {
  AddSceneTargetModal,
  SceneTargetConfigEditor,
  type SceneTargetOption,
} from '@/ui/SceneDeviceStateEditor';
import {
  ResolvedColorDot,
  SceneResolvedColorPreview,
  resolveSceneColor,
} from '@/ui/SceneResolvedColorPreview';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Input } from '@/ui/primitives/input';
import { Skeleton } from '@/ui/primitives/skeleton';
import { checkboxClassName } from '@/ui/form-styles';
import { Suspense, lazy } from 'react';

const LazySceneScriptEditor = lazy(() => import('@/ui/SceneScriptEditor'));

const DEVICE_FIELDS = ['device_states'] as const;
const ROOM_FIELDS = ['group_states', 'group_state_order'] as const;
const DETAIL_FIELDS = ['name', 'hidden'] as const;
const SCRIPT_FIELDS = ['script'] as const;

async function triggerScene(apiEndpoint: string, sceneId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${apiEndpoint}/api/v1/commands/scene`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: createUuid(),
        scene_id: sceneId,
        device_keys: null,
        group_keys: null,
        use_scene_transition: false,
        transition: null,
      }),
    });
    if (response.status === 404)
      throw new Error('Scene controls need the updated backend.');
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.applied)
      throw new Error(result?.error || 'The scene change was rejected.');
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        'No runtime confirmation received. Check device states before trying again.',
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type TargetDraft = Record<string, SceneDeviceConfig>;

function modeLabel(mode: string): string {
  if (mode === 'device-link') return 'Tracks a device';
  if (mode === 'scene-link') return 'Links to a scene';
  return 'Sets state';
}

/**
 * Scene detail: what the scene would set, then the device and room targets as
 * separate sections that save independently, then details, script, delete.
 */
export default function SceneDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { apiEndpoint } = useAppConfig();
  const { data: scenes, loading, error, refetch, update, remove } = useScenes();
  const { data: groups } = useGroups();
  const { devicesState: devices } = useDevicesApi();
  const { activeSection, target, openSection } = useSectionParams();
  const { status, announce } = useStatusAnnouncements();

  const [activating, setActivating] = useState(false);
  const [addingTarget, setAddingTarget] = useState<'device' | 'room' | null>(null);

  const scene = scenes.find((entry) => entry.id === id);

  const deviceKeys = useMemo(
    () =>
      Object.keys(devices).filter(
        (key): key is string => devices[key] !== undefined,
      ),
    [devices],
  );
  const sceneIds = useMemo(() => scenes.map((entry) => entry.id), [scenes]);

  const deviceOptions: SceneTargetOption[] = useMemo(
    () =>
      deviceKeys
        .map((key) => ({ key, label: devices[key]?.name ?? key }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [deviceKeys, devices],
  );
  const roomOptions: SceneTargetOption[] = useMemo(
    () =>
      groups
        .map((group) => ({ key: group.id, label: group.name }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [groups],
  );

  const summary = useMemo(
    () =>
      scene
        ? sceneTargetsSummary(scene, { sceneIds, deviceKeys })
        : { deviceCount: 0, groupCount: 0, total: 0, unresolvedCount: 0, scripted: false },
    [deviceKeys, scene, sceneIds],
  );

  const saveSection = useCallback(
    async (merged: Scene) => {
      await update(merged.id, merged);
      announce('Saved', 'success');
    },
    [announce, update],
  );

  const detailEditor = useSectionEditor<Scene>({
    item: scene,
    fields: DETAIL_FIELDS,
    validate: (draft) =>
      String(draft.name ?? '').trim() === ''
        ? [{ field: 'name', message: 'Give this scene a name' }]
        : [],
    save: saveSection,
  });
  const deviceEditor = useSectionEditor<Scene>({
    item: scene,
    fields: DEVICE_FIELDS,
    save: saveSection,
  });
  const roomEditor = useSectionEditor<Scene>({
    item: scene,
    fields: ROOM_FIELDS,
    save: saveSection,
  });
  const scriptEditor = useSectionEditor<Scene>({
    item: scene,
    fields: SCRIPT_FIELDS,
    save: saveSection,
  });

  const dirty =
    detailEditor.dirty ||
    deviceEditor.dirty ||
    roomEditor.dirty ||
    scriptEditor.dirty;
  useDirtyNavigationGuard(dirty);

  useAssistantPageContext(
    scene
      ? { kind: 'scene', id: scene.id, label: scene.name }
      : { kind: 'scene' },
  );

  const headingRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!activeSection || loading) return;
    const node = headingRefs.current[activeSection];
    if (node) {
      node.focus();
      node.scrollIntoView({ block: 'start' });
    }
  }, [activeSection, loading]);

  useEffect(() => {
    if (!target || loading) return;
    const node = document.querySelector<HTMLElement>(
      `[data-target-key="${CSS.escape(target)}"]`,
    );
    if (node) {
      node.scrollIntoView({ block: 'center' });
      node.querySelector<HTMLElement>('button, a, input')?.focus();
    }
  }, [loading, target]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (!scene) {
    return (
      <DetailPageShell
        crumbs={[
          { label: 'Settings', to: '/config' },
          { label: 'Scenes', to: '/config/scenes' },
          { label: id },
        ]}
        backTo="/config/scenes"
        backLabel="Back to scenes"
        title={id}
        error={error}
        notFound={!error}
        onRetry={() => void refetch()}
      >
        {null}
      </DetailPageShell>
    );
  }

  const deviceTargets = orderedSceneTargets(scene.device_states ?? {});
  const roomTargets = orderedSceneTargets(
    scene.group_states ?? {},
    scene.group_state_order,
  );

  const resolvedAll = [
    ...deviceTargets.map(([key, config]) => ({ key, kind: 'device' as const, config })),
    ...roomTargets.map(([key, config]) => ({ key, kind: 'group' as const, config })),
  ];

  const activate = async () => {
    setActivating(true);
    try {
      await triggerScene(apiEndpoint, scene.id);
      announce(
        'Applied to the server’s runtime state. Devices confirm as they report.',
        'success',
      );
    } catch (activationError) {
      announce(
        activationError instanceof Error
          ? activationError.message
          : 'The scene change was rejected.',
        'error',
      );
    } finally {
      setActivating(false);
    }
  };

  const updateDevices = (next: TargetDraft) => deviceEditor.patch({ device_states: next });
  const updateRooms = (next: TargetDraft, order?: string[]) =>
    roomEditor.patch({
      group_states: next,
      ...(order ? { group_state_order: order } : {}),
    });

  const roomOrder = roomEditor.draft?.group_state_order?.length
    ? roomEditor.draft.group_state_order
    : Object.keys(roomEditor.draft?.group_states ?? {});

  const moveRoom = (key: string, delta: number) => {
    const ordered = [...roomOrder];
    const index = ordered.indexOf(key);
    if (index < 0) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= ordered.length) return;
    ordered.splice(nextIndex, 0, ...ordered.splice(index, 1));
    updateRooms(roomEditor.draft?.group_states ?? {}, ordered);
  };

  const targetRow = (
    key: string,
    kind: 'device' | 'group',
    config: SceneDeviceConfig,
  ) => {
    const descriptor = describeSceneTarget(key, { kind }, config, {
      sceneIds,
      deviceKeys,
    });
    const label =
      kind === 'device'
        ? (devices[key]?.name ?? key)
        : (groups.find((group) => group.id === key)?.name ?? key);

    return (
      <div className="space-y-2" data-target-key={key}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {kind === 'device' ? key : key}
            </p>
          </div>
          <Badge variant="muted">{modeLabel(descriptor.mode)}</Badge>
        </div>
        <p className="text-sm text-foreground/80">{descriptor.summary}</p>
        {descriptor.unresolvedReason ? (
          <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle aria-hidden className="size-3 shrink-0" />
            {descriptor.unresolvedReason}
          </p>
        ) : null}
        <SceneResolvedColorPreview
          config={config}
          devices={devices}
          scenes={scenes}
          targetKey={key}
          targetKind={kind}
        />
      </div>
    );
  };

  const draftTargetEditor = (
    kind: 'device' | 'group',
    items: TargetDraft,
    onChange: (next: TargetDraft) => void,
    order?: string[],
  ) => {
    const entries = orderedSceneTargets(items, order);
    return (
      <div className="space-y-3">
        {entries.map(([key, config], index) => {
          const label =
            kind === 'device'
              ? (devices[key]?.name ?? key)
              : (groups.find((group) => group.id === key)?.name ?? key);
          return (
            <div key={key} data-target-key={key}>
            <SceneTargetConfigEditor
              targetKey={key}
              targetLabel={label}
              config={config}
              devices={devices}
              allScenes={scenes}
              scenes={scenes.filter((candidate) => candidate.id !== scene.id)}
              targetKind={kind}
              onChange={(next) => onChange({ ...items, [key]: next })}
              onRemove={() => {
                const copy = { ...items };
                delete copy[key];
                onChange(copy);
              }}
              {...(kind === 'group'
                ? {
                    position: index,
                    targetCount: entries.length,
                    onMoveUp: () => moveRoom(key, -1),
                    onMoveDown: () => moveRoom(key, 1),
                  }
                : {})}
            />
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddingTarget(kind === 'device' ? 'device' : 'room')}
        >
          {kind === 'device' ? 'Add device target' : 'Add room target'}
        </Button>
        {addingTarget === (kind === 'device' ? 'device' : 'room') ? (
          <AddSceneTargetModal
            options={kind === 'device' ? deviceOptions : roomOptions}
            existingKeys={Object.keys(items)}
            onAdd={(targetKey) => {
              onChange({
                ...items,
                [targetKey]:
                  kind === 'device'
                    ? { power: true, brightness: 1 }
                    : { power: true, brightness: 0.8 },
              });
              setAddingTarget(null);
              openSection(kind === 'device' ? 'devices' : 'rooms', {
                target: targetKey,
              });
            }}
            onClose={() => setAddingTarget(null)}
          />
        ) : null}
      </div>
    );
  };

  const scriptPreview = (scene.script ?? '').trim();

  return (
    <DetailPageShell
      crumbs={[
        { label: 'Settings', to: '/config' },
        { label: 'Scenes', to: '/config/scenes' },
        { label: scene.name },
      ]}
      backTo="/config/scenes"
      backLabel="Back to scenes"
      title={scene.name}
      status={
        <>
          {`${summary.deviceCount} device target${summary.deviceCount === 1 ? '' : 's'} · ${summary.groupCount} room target${summary.groupCount === 1 ? '' : 's'}`}
          {summary.unresolvedCount > 0 ? (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="size-3.5" />
                {summary.unresolvedCount} target
                {summary.unresolvedCount === 1 ? '' : 's'} cannot be resolved
              </span>
            </>
          ) : null}
        </>
      }
      primaryAction={
        <Button
          onClick={() => void activate()}
          disabled={activating}
          aria-busy={activating}
        >
          {activating ? 'Activating…' : 'Activate'}
        </Button>
      }
    >
      <div className="space-y-4">
        <StatusRegion message={status?.message ?? null} tone={status?.tone} />

        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="text-sm font-semibold">What this scene would set</h2>
          {summary.total === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              This scene has no targets yet, so activating it would change
              nothing. Add device or room targets below.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.total} target{summary.total === 1 ? '' : 's'}
                {summary.scripted
                  ? ' · a script can override these values at runtime'
                  : ''}
                {summary.unresolvedCount > 0
                  ? ` · ${summary.unresolvedCount} cannot be resolved`
                  : ''}
              </p>
              <div className="mt-3 space-y-3">
                {(['device', 'group'] as const).map((chipKind) => {
                  const entries = resolvedAll.filter(
                    (entry) => entry.kind === chipKind,
                  );
                  if (entries.length === 0) return null;
                  return (
                    <div key={chipKind} className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {chipKind === 'device' ? 'Devices' : 'Rooms'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {entries.slice(0, 12).map(({ key, kind, config }) => {
                          const resolved = resolveSceneColor(
                            config,
                            kind,
                            key,
                            scenes,
                            devices,
                          );
                          const label =
                            kind === 'device'
                              ? (devices[key]?.name ?? key)
                              : (groups.find((group) => group.id === key)?.name ??
                                key);
                          return (
                            <span
                              key={`${kind}:${key}`}
                              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-foreground/85"
                            >
                              {resolved ? (
                                <ResolvedColorDot
                                  className="inline-flex h-3 w-3 shrink-0 rounded-full border border-foreground/15 shadow-inner"
                                  color={resolved.color}
                                  isPowered={resolved.isPowered}
                                />
                              ) : (
                                <AlertTriangle
                                  aria-hidden
                                  className="size-3 shrink-0 text-amber-600 dark:text-amber-300"
                                />
                              )}
                              <span className="max-w-36 truncate">{label}</span>
                              {!resolved ? (
                                <span className="text-amber-700 dark:text-amber-300">
                                  unresolved
                                </span>
                              ) : null}
                            </span>
                          );
                        })}
                        {entries.length > 12 ? (
                          <Badge variant="muted">
                            +{entries.length - 12} more
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <Section<Scene>
          id="devices"
          title="Device targets"
          summary={
            summary.deviceCount === 0
              ? 'No device targets'
              : `${summary.deviceCount} device target${summary.deviceCount === 1 ? '' : 's'}`
          }
          open={activeSection === 'devices'}
          onOpenChange={(open) => openSection(open ? 'devices' : null)}
          api={deviceEditor}
          headingRef={(node) => {
            headingRefs.current.devices = node;
          }}
          readView={
            <BoundedList
              items={deviceTargets}
              keyOf={([key]) => key}
              emptyMessage="No device targets yet. Add one to give every device in this scene its own state."
              renderItem={([key, config]) => targetRow(key, 'device', config)}
            />
          }
          renderEditor={() => (
            <ConfigFormSection
              title="Device targets"
              description="Set an explicit state, track another device, or follow another scene."
            >
              {draftTargetEditor(
                'device',
                deviceEditor.draft?.device_states ?? {},
                updateDevices,
              )}
            </ConfigFormSection>
          )}
        />

        <Section<Scene>
          id="rooms"
          title="Room targets"
          summary={
            summary.groupCount === 0
              ? 'No room targets'
              : `${summary.groupCount} room target${summary.groupCount === 1 ? '' : 's'}${
                  summary.groupCount > 1 ? ' · applied in order' : ''
                }`
          }
          open={activeSection === 'rooms'}
          onOpenChange={(open) => openSection(open ? 'rooms' : null)}
          api={roomEditor}
          headingRef={(node) => {
            headingRefs.current.rooms = node;
          }}
          readView={
            <BoundedList
              items={roomTargets}
              keyOf={([key]) => key}
              emptyMessage="No room targets yet. Add a room to apply shared state to all of its devices."
              renderItem={([key, config], index) => (
                <div className="space-y-1">
                  {index > 0 && roomTargets.length > 1 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Overrides the room above for shared devices
                    </p>
                  ) : null}
                  {targetRow(key, 'group', config)}
                </div>
              )}
            />
          }
          renderEditor={() => (
            <ConfigFormSection
              title="Room targets"
              description="Rooms apply in order. If two rooms share a device, the later room wins for it."
            >
              {draftTargetEditor(
                'group',
                roomEditor.draft?.group_states ?? {},
                (next) => updateRooms(next, roomOrder),
                roomOrder,
              )}
            </ConfigFormSection>
          )}
        />

        <Section<Scene>
          id="details"
          title="Details"
          summary={`${scene.hidden ? 'Hidden' : 'Visible'} · id ${scene.id}`}
          open={activeSection === 'details'}
          onOpenChange={(open) => openSection(open ? 'details' : null)}
          api={detailEditor}
          fieldLabels={{ name: 'Name' }}
          headingRef={(node) => {
            headingRefs.current.details = node;
          }}
          readView={
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd>{scene.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs">{scene.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Visibility</dt>
                <dd>{scene.hidden ? 'Hidden' : 'Visible'}</dd>
              </div>
            </dl>
          }
          renderEditor={() => (
            <div className="space-y-4">
              <ConfigField label="Name">
                <Input
                  data-field="name"
                  value={String(detailEditor.draft?.name ?? '')}
                  onChange={(event) => detailEditor.patch({ name: event.target.value })}
                />
              </ConfigField>
              <p className="text-xs text-muted-foreground">
                ID <span className="font-mono">{scene.id}</span> is referenced by
                routines and scene links and cannot be changed here.
              </p>
              <ConfigToggleRow
                label="Hidden"
                description="Hidden scenes stay available for automations and scene links, but are left out of primary control surfaces."
              >
                <input
                  type="checkbox"
                  data-field="hidden"
                  className={checkboxClassName}
                  checked={Boolean(detailEditor.draft?.hidden)}
                  onChange={(event) =>
                    detailEditor.patch({ hidden: event.target.checked })
                  }
                />
              </ConfigToggleRow>
            </div>
          )}
        />

        <Section<Scene>
          id="script"
          title="Advanced script"
          summary={
            scriptPreview
              ? `Script set (${scriptPreview.split('\n').length} line${scriptPreview.split('\n').length === 1 ? '' : 's'})`
              : 'No script — targets above decide the state'
          }
          badge={scriptPreview ? <Badge variant="secondary">Customized</Badge> : undefined}
          open={activeSection === 'script'}
          onOpenChange={(open) => openSection(open ? 'script' : null)}
          api={scriptEditor}
          headingRef={(node) => {
            headingRefs.current.script = node;
          }}
          editLabel="Edit script"
          readView={
            scriptPreview ? (
              <pre className="max-h-48 overflow-auto rounded-xl border border-border/70 bg-muted/30 p-3 text-xs">
                {scriptPreview.split('\n').slice(0, 12).join('\n')}
                {scriptPreview.split('\n').length > 12 ? '\n…' : ''}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Scripts generate target state at runtime and override the target
                rows above. Most scenes do not need one.
              </p>
            )
          }
          renderEditor={() => (
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
                  Loading script editor…
                </div>
              }
            >
              <LazySceneScriptEditor
                deviceOptions={deviceOptions}
                groupOptions={roomOptions}
                sceneIds={scenes
                  .filter((candidate) => candidate.id !== scene.id)
                  .map((candidate) => candidate.id)}
                value={String(scriptEditor.draft?.script ?? '')}
                onChange={(value) => scriptEditor.patch({ script: value })}
              />
            </Suspense>
          )}
        />

        <Section<Scene>
          id="danger"
          title="Delete this scene"
          summary="Removes the scene; routines and scene links that reference it stop resolving."
          open={activeSection === 'danger'}
          onOpenChange={(open) => openSection(open ? 'danger' : null)}
          api={detailEditor}
          editable={false}
          danger
          headingRef={(node) => {
            headingRefs.current.danger = node;
          }}
          readView={
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (
                  await confirmDestructive(
                    `Delete scene "${scene.name}"?`,
                    'Routines and scene links that reference this scene will stop resolving.',
                  )
                ) {
                  await remove(scene.id);
                  navigate('/config/scenes', { replace: true });
                }
              }}
            >
              Delete scene
            </Button>
          }
          renderEditor={() => null}
        />

        <p className="text-xs text-muted-foreground">
          Looking for the scene list?{' '}
          <Link to="/config/scenes" className="underline underline-offset-2">
            Back to scenes
          </Link>
        </p>
      </div>
    </DetailPageShell>
  );
}