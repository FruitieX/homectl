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
  useSources,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { createUuid } from '@/lib/uuid';
import {
  describeSceneTarget,
  orderedSceneTargets,
  sceneTargetsSummary,
} from '@/lib/sceneTargets';
import Color from 'color';

import { resolveSceneEffects } from '@/lib/sceneEffects';
import { sourceAliasKeys } from '@/lib/sceneTargets';
import { BoundedList } from '@/ui/config/BoundedList';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { StatusRegion, useStatusAnnouncements } from '@/ui/config/StatusRegion';
import { useDirtyNavigationGuard } from '@/ui/config/useDirtyNavigationGuard';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionEditCoordinator } from '@/ui/config/sectionEditCoordinator';
import { useSectionParams } from '@/ui/config/useSectionParams';
import {
  ConfigField,
  ConfigFormSection,
  ConfigToggleRow,
} from '@/ui/config-form';
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
/** Exact colour for a tooltip or the details block, never a bare hue number. */
function colourDetail(
  color: { h: number; s: number },
  words: string | null,
): string {
  const hex = Color({ h: color.h, s: color.s * 100, v: 100 }).hex();
  const exact = `h ${Math.round(color.h)}° · s ${Math.round(color.s * 100)}% · ${hex}`;
  return words ? `${words} · ${exact}` : exact;
}

export default function SceneDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { apiEndpoint } = useAppConfig();
  const { data: scenes, loading, error, refetch, update, remove } = useScenes();
  const { data: groups } = useGroups();
  const { devicesState: devices, loading: devicesLoading } = useDevicesApi();
  const { data: sources } = useSources();
  // Legacy keys a computed source still answers to (`circadian/color`), so a
  // saved reference is never reported as gone while the source serves it.
  const sourceAliases = useMemo(() => sourceAliasKeys(sources), [sources]);
  const { activeSection, target, openSection } = useSectionParams();
  const { status, announce } = useStatusAnnouncements();

  const [activating, setActivating] = useState(false);
  const [addingTarget, setAddingTarget] = useState<'device' | 'room' | null>(
    null,
  );

  const scene = scenes.find((entry) => entry.id === id);

  const deviceKeys = useMemo(
    () =>
      Object.keys(devices).filter(
        (key): key is string => devices[key] !== undefined,
      ),
    [devices],
  );
  const sceneIds = useMemo(() => scenes.map((entry) => entry.id), [scenes]);
  // While the device catalog is still loading there is no verdict to give.
  const knownDeviceKeys = devicesLoading ? undefined : deviceKeys;

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
        ? sceneTargetsSummary(scene, {
            sceneIds,
            deviceKeys: knownDeviceKeys,
            aliases: sourceAliases,
          })
        : {
            deviceCount: 0,
            groupCount: 0,
            total: 0,
            unresolvedCount: 0,
            scripted: false,
          },
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
  const [showAllEffects, setShowAllEffects] = useState(false);
  const coordinator = useSectionEditCoordinator();
  // Collections keep exactly one row editor open.
  const [openTargetKey, setOpenTargetKey] = useState<string | null>(null);
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
    ...deviceTargets.map(([key, config]) => ({
      key,
      kind: 'device' as const,
      config,
    })),
    ...roomTargets.map(([key, config]) => ({
      key,
      kind: 'group' as const,
      config,
    })),
  ];

  // What the engine would actually apply: rooms first, then devices, with the
  // last writer per device winning.
  const visibleEffectCount = showAllEffects ? Number.POSITIVE_INFINITY : 8;

  const effects = resolveSceneEffects(scene, {
    sourceAliases,
    devices,
    groups: Object.fromEntries(
      groups.map((group) => [
        group.id,
        {
          name: group.name,
          device_keys: (group.devices ?? []).map(
            (member: { integration_id: string; device_id: string }) =>
              `${member.integration_id}/${member.device_id}`,
          ),
        },
      ]),
    ),
    scenes: scenes.map((entry) => ({ id: entry.id, name: entry.name })),
    resolveSceneLink: (sceneId) => scenes.find((entry) => entry.id === sceneId),
  });

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

  const updateDevices = (next: TargetDraft) =>
    deviceEditor.patch({ device_states: next });
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
      deviceKeys: knownDeviceKeys,
      aliases: sourceAliases,
    });
    const label =
      kind === 'device'
        ? (devices[key]?.name ?? key)
        : (groups.find((group) => group.id === key)?.name ?? key);

    return (
      <div className="space-y-2" data-target-key={key}>
        {/* One line per target: name, then what it resolves to. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium">{label}</span>
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="min-w-0 truncate text-sm text-foreground/80">
            {descriptor.summary}
          </span>
        </div>
        {descriptor.unresolvedReason ? (
          <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle aria-hidden className="size-3 shrink-0" />
            {descriptor.unresolvedReason}
          </p>
        ) : null}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Details</summary>
          <dl className="mt-1 space-y-0.5">
            <div>
              <dt className="inline">Mode: </dt>
              <dd className="inline">{modeLabel(descriptor.mode)}</dd>
            </div>
            {label === key ? null : (
              <div>
                <dt className="inline">
                  {kind === 'device' ? 'Device key: ' : 'Room id: '}
                </dt>
                <dd className="inline font-mono">{key}</dd>
              </div>
            )}
            {descriptor.resolvedKey ? (
              <div>
                <dt className="inline">Resolves to: </dt>
                <dd className="inline font-mono">{descriptor.resolvedKey}</dd>
              </div>
            ) : null}
          </dl>
        </details>
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
      <div className="space-y-4">
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
                selected={openTargetKey === key}
                onSelect={() =>
                  setOpenTargetKey((current) => (current === key ? null : key))
                }
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
          {effects.unresolvedCount > 0 ? (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="size-3.5" />
                {effects.unresolvedCount} saved reference
                {effects.unresolvedCount === 1 ? '' : 's'} cannot be resolved
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
          <h2 className="text-sm font-semibold">
            What activating would change
          </h2>
          {effects.targets.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              This scene has no targets yet, so activating it would change
              nothing. Add device or room targets below.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {effects.affectedDeviceCount === 0
                  ? 'No device would change.'
                  : `Affects ${effects.affectedDeviceCount} device${
                      effects.affectedDeviceCount === 1 ? '' : 's'
                    }.`}
                {effects.unresolvedCount > 0
                  ? ` ${effects.unresolvedCount} saved reference${
                      effects.unresolvedCount === 1 ? '' : 's'
                    } cannot be resolved and will be skipped (${[
                      effects.unresolvedByKind.directTargets > 0
                        ? `${effects.unresolvedByKind.directTargets} direct device target${
                            effects.unresolvedByKind.directTargets === 1
                              ? ''
                              : 's'
                          }`
                        : null,
                      effects.unresolvedByKind.roomTargets > 0
                        ? `${effects.unresolvedByKind.roomTargets} room target${
                            effects.unresolvedByKind.roomTargets === 1
                              ? ''
                              : 's'
                          }`
                        : null,
                      effects.unresolvedByKind.roomMembers > 0
                        ? `${effects.unresolvedByKind.roomMembers} device${
                            effects.unresolvedByKind.roomMembers === 1
                              ? ''
                              : 's'
                          } inside a room`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}).`
                  : ''}
                {effects.scripted
                  ? ' Its script can override these values at runtime.'
                  : ''}
              </p>

              <ul className="mt-3 space-y-1.5">
                {effects.finalByDevice
                  .slice(0, visibleEffectCount)
                  .map((entry) => {
                    const winner = effects.targets.find(
                      (target) =>
                        target.label === entry.fromLabel &&
                        target.devices.some(
                          (device) => device.deviceKey === entry.deviceKey,
                        ),
                    );
                    const replaced = winner?.devices.find(
                      (device) =>
                        device.deviceKey === entry.deviceKey &&
                        device.overriddenBy,
                    );
                    return (
                      <li
                        key={entry.deviceKey}
                        className="text-sm"
                        data-target-key={entry.deviceKey}
                      >
                        <span className="text-foreground/90">
                          {entry.deviceLabel}
                        </span>{' '}
                        <span aria-hidden className="text-muted-foreground">
                          →
                        </span>{' '}
                        <span className="inline-flex items-center gap-1.5 align-middle">
                          <span>
                            {entry.changes.length > 0
                              ? entry.changes.join(' · ')
                              : 'no change'}
                          </span>
                          {entry.color ? (
                            <ResolvedColorDot
                              color={Color({
                                h: entry.color.h,
                                s: entry.color.s * 100,
                                v: 100,
                              })}
                              isPowered
                              label={entry.colorWords ?? 'colour set'}
                              detail={colourDetail(
                                entry.color,
                                entry.colorWords,
                              )}
                            />
                          ) : null}
                        </span>
                        {replaced || entry.color ? (
                          <details className="mt-0.5">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              {replaced
                                ? 'which target set this'
                                : 'exact values'}
                            </summary>
                            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                              {entry.color ? (
                                <p>
                                  Colour: {entry.colorWords ?? 'set'} —{' '}
                                  {colourDetail(entry.color, null)}
                                </p>
                              ) : null}
                              <p>
                                Set by {entry.fromLabel}
                                {replaced
                                  ? `; the room setting it replaced came from ${replaced.overriddenBy}`
                                  : ''}
                                .
                              </p>
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
              {effects.finalByDevice.length > visibleEffectCount ? (
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setShowAllEffects(true)}
                >
                  Show all {effects.finalByDevice.length} devices
                </button>
              ) : null}

              {effects.unresolvedCount > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Activating now affects only the available devices listed
                  above; the missing references are skipped.
                </p>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Show the saved targets ({effects.targets.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {effects.targets.map((target) => (
                    <li
                      key={`${target.kind}:${target.key}`}
                      className="rounded-xl border border-border/70 bg-background/60 p-2.5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">
                          {target.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {target.kind === 'group' ? 'Room' : 'Device'}
                        </span>
                        {target.unresolvedReason ? (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            {target.unresolvedReason}
                          </span>
                        ) : null}
                      </div>
                      {target.devices.length > 0 ? (
                        <ul className="mt-1.5 space-y-1 text-xs">
                          {target.devices.slice(0, 8).map((device) => (
                            <li
                              key={device.deviceKey}
                              className="flex flex-wrap items-baseline gap-x-1.5"
                            >
                              <span className="text-foreground/85">
                                {device.deviceLabel}
                              </span>
                              <span aria-hidden>→</span>
                              <span>
                                {target.unresolvedReason ? 'would set ' : ''}
                                {device.changes.join(', ')}
                              </span>
                              {device.overriddenBy ? (
                                <span className="text-muted-foreground">
                                  (replaced by {device.overriddenBy})
                                </span>
                              ) : null}
                            </li>
                          ))}
                          {target.devices.length > 8 ? (
                            <li className="text-muted-foreground">
                              +{target.devices.length - 8} more
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                      {target.missingMembers.length > 0 ? (
                        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                          {target.missingMembers.length} saved member
                          {target.missingMembers.length === 1 ? '' : 's'} no
                          longer exist
                          {target.missingMembers.length === 1 ? 's' : ''}:{' '}
                          {target.missingMembers.join(', ')}
                        </p>
                      ) : null}
                      {target.repair ? (
                        <button
                          type="button"
                          className="mt-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                          onClick={() => {
                            const begin =
                              target.kind === 'group'
                                ? roomEditor.begin
                                : deviceEditor.begin;
                            const sectionId =
                              target.kind === 'group' ? 'rooms' : 'devices';
                            if (coordinator) {
                              coordinator.requestBegin(sectionId, begin);
                            } else {
                              begin();
                            }
                          }}
                        >
                          {target.repair}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
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
              className="border-0 bg-transparent p-0 shadow-none"
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
              className="border-0 bg-transparent p-0 shadow-none"
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
                  onChange={(event) =>
                    detailEditor.patch({ name: event.target.value })
                  }
                />
              </ConfigField>
              <p className="text-xs text-muted-foreground">
                ID <span className="font-mono">{scene.id}</span> is referenced
                by routines and scene links and cannot be changed here.
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
          badge={
            scriptPreview ? (
              <Badge variant="secondary">Customized</Badge>
            ) : undefined
          }
          open={activeSection === 'script'}
          onOpenChange={(open) => openSection(open ? 'script' : null)}
          api={scriptEditor}
          headingRef={(node) => {
            headingRefs.current.script = node;
          }}
          changeLabel="Change script"
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
