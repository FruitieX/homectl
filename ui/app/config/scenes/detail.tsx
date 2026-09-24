import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type Scene,
  type SceneDeviceConfig,
  type DeviceColor,
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
import { colorToRgb, formatColorExact } from '@/lib/deviceColor';

import {
  groupSceneEffectOutcomes,
  resolveSceneEffects,
} from '@/lib/sceneEffects';
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

const TARGET_FIELDS = [
  'device_states',
  'group_states',
  'group_state_order',
] as const;
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
  if (mode === 'device-link') return 'Follow a device';
  if (mode === 'scene-link') return 'Use another scene';
  return 'Set a state';
}

/**
 * Scene detail: what the scene would set, then one coherent target collection,
 * then details, script, and delete.
 */
/** Exact colour for a tooltip or the details block, never a raw coordinate. */
function colourDetail(color: DeviceColor, words: string | null): string {
  const exact = formatColorExact(color);
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
  const [addingTarget, setAddingTarget] = useState(false);

  const scene = scenes.find((entry) => entry.id === id);
  const urlTargetRevealKey = target
    ? Object.hasOwn(scene?.group_states ?? {}, target)
      ? `group:${target}`
      : Object.hasOwn(scene?.device_states ?? {}, target)
        ? `device:${target}`
        : null
    : null;

  const deviceKeys = useMemo(
    () =>
      Object.keys(devices).filter(
        (key): key is string => devices[key] !== undefined,
      ),
    [devices],
  );
  const sceneIds = useMemo(() => scenes.map((entry) => entry.id), [scenes]);
  const sceneNames = useMemo(
    () =>
      Object.fromEntries(
        scenes.map((candidate) => [candidate.id, candidate.name]),
      ),
    [scenes],
  );
  const groupNames = useMemo(
    () => Object.fromEntries(groups.map((group) => [group.id, group.name])),
    [groups],
  );
  const deviceNames = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(devices).map(([deviceKey, device]) => [
          deviceKey,
          device?.name ?? deviceKey,
        ]),
      ),
    [devices],
  );
  // While the device catalog is still loading there is no verdict to give.
  const knownDeviceKeys = devicesLoading ? undefined : deviceKeys;

  const deviceOptions: SceneTargetOption[] = useMemo(
    () =>
      deviceKeys
        .map((key) => {
          const [integrationId] = key.split('/', 1);
          const containingRooms = groups
            .filter((group) =>
              (group.devices ?? []).some(
                (member: { integration_id: string; device_id: string }) =>
                  `${member.integration_id}/${member.device_id}` === key,
              ),
            )
            .map((group) => group.name);
          return {
            key,
            label: devices[key]?.name ?? key,
            detail: `Device · ${containingRooms.length ? containingRooms.join(', ') : 'No room'} · ${integrationId} · ${key}`,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    [deviceKeys, devices, groups],
  );
  const roomOptions: SceneTargetOption[] = useMemo(
    () =>
      groups
        .map((group) => ({
          key: group.id,
          label: group.name,
          detail: `Room · ${group.devices?.length ?? 0} saved direct devices · ${group.id}`,
        }))
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
    [knownDeviceKeys, scene, sceneIds, sourceAliases],
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
  const targetEditor = useSectionEditor<Scene>({
    item: scene,
    fields: TARGET_FIELDS,
    save: saveSection,
  });
  const scriptEditor = useSectionEditor<Scene>({
    item: scene,
    fields: SCRIPT_FIELDS,
    save: saveSection,
  });

  const dirty = detailEditor.dirty || targetEditor.dirty || scriptEditor.dirty;
  useDirtyNavigationGuard(dirty);

  useAssistantPageContext(
    scene
      ? { kind: 'scene', id: scene.id, label: scene.name }
      : { kind: 'scene' },
  );

  useEffect(() => {
    if (loading || (activeSection !== 'devices' && activeSection !== 'rooms')) {
      return;
    }
    openSection('targets', { target });
  }, [activeSection, loading, openSection, target]);

  const headingRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!activeSection || loading) return;
    const headingId =
      activeSection === 'devices' || activeSection === 'rooms'
        ? 'targets'
        : activeSection;
    const node = headingRefs.current[headingId];
    if (node) {
      node.focus();
      node.scrollIntoView({ block: 'start' });
    }
  }, [activeSection, loading]);

  useEffect(() => {
    if (!target || !urlTargetRevealKey || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const node = Array.from(
        document.querySelectorAll<HTMLElement>(
          '#targets-body [data-target-key]',
        ),
      ).find((entry) => entry.dataset.targetKey === target);
      if (!node) return;
      node.scrollIntoView({ block: 'center' });
      (node.querySelector<HTMLElement>('button, a, input') ?? node).focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, target, urlTargetRevealKey]);

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

  // Group resolved device requests by the target and shared outcome. Brightness
  // can vary within a room, so retain each exact value for the compact summary.
  const groupedEffects = groupSceneEffectOutcomes(effects.finalByDevice);
  const visibleEffectCount = showAllEffects ? Number.POSITIVE_INFINITY : 4;

  const activate = async () => {
    setActivating(true);
    try {
      await triggerScene(apiEndpoint, scene.id);
      announce(
        'Accepted by homectl. Devices confirm as they report.',
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
    targetEditor.patch({ device_states: next });
  const updateRooms = (next: TargetDraft, order?: string[]) =>
    targetEditor.patch({
      group_states: next,
      ...(order ? { group_state_order: order } : {}),
    });

  const roomOrder = targetEditor.draft?.group_state_order?.length
    ? targetEditor.draft.group_state_order
    : Object.keys(targetEditor.draft?.group_states ?? {});

  const moveRoom = (key: string, delta: number) => {
    const ordered = [...roomOrder];
    const index = ordered.indexOf(key);
    if (index < 0) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= ordered.length) return;
    ordered.splice(nextIndex, 0, ...ordered.splice(index, 1));
    updateRooms(targetEditor.draft?.group_states ?? {}, ordered);
  };

  const beginAddingTarget = () => {
    const begin = () => {
      targetEditor.begin();
      setAddingTarget(true);
      openSection('targets', { target: null });
    };
    if (coordinator) coordinator.requestBegin('targets', begin);
    else begin();
  };

  const targetRow = (
    key: string,
    kind: 'device' | 'group',
    config: SceneDeviceConfig,
  ) => {
    const resolvedTarget = effects.targets.find(
      (entry) => entry.key === key && entry.kind === kind,
    );
    const descriptor = describeSceneTarget(key, { kind }, config, {
      sceneIds,
      sceneNames,
      groupNames,
      deviceNames,
      deviceKeys: knownDeviceKeys,
      aliases: sourceAliases,
    });
    const label =
      kind === 'device'
        ? (devices[key]?.name ?? key)
        : (groups.find((group) => group.id === key)?.name ?? key);
    const missingReferenceKey =
      kind === 'device' &&
      knownDeviceKeys !== undefined &&
      !knownDeviceKeys.includes(key)
        ? key
        : kind === 'group' && !groups.some((group) => group.id === key)
          ? key
          : 'integration_id' in config && descriptor.unresolvedReason
            ? getSceneDeviceLinkTargetKey(config)
            : 'scene_id' in config && descriptor.unresolvedReason
              ? config.scene_id
              : null;
    const linkedIssues = resolvedTarget?.linkedIssues ?? [];

    return (
      <div className="min-w-0 space-y-2" data-target-key={key} tabIndex={-1}>
        <p className="text-sm leading-5">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-foreground/80">
            {modeLabel(descriptor.mode)}: {descriptor.summary}
          </span>
        </p>
        {descriptor.unresolvedReason ? (
          <div className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 text-sm">
            <p className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {descriptor.unresolvedReason}
                {missingReferenceKey ? (
                  <span className="mt-1 block break-all font-mono text-xs">
                    {missingReferenceKey}
                  </span>
                ) : null}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="#targets-change"
                className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Change targets below
              </a>
              {missingReferenceKey ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(missingReferenceKey)
                      .then(() => announce('Saved key copied', 'success'))
                      .catch(() =>
                        announce('Could not copy the saved key', 'error'),
                      );
                  }}
                >
                  Copy key
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {resolvedTarget && resolvedTarget.missingMembers.length > 0 ? (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 text-sm">
            <p className="text-amber-800 dark:text-amber-200">
              {resolvedTarget.missingMembers.length} saved room member
              {resolvedTarget.missingMembers.length === 1 ? '' : 's'} are
              unavailable. Their keys remain saved in this room.
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {resolvedTarget.missingMembers.map((memberKey) => (
                <li key={memberKey} className="break-all font-mono">
                  {memberKey}
                </li>
              ))}
            </ul>
            <Link
              to={`/config/groups/${encodeURIComponent(key)}?section=devices`}
              className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              Repair room devices
            </Link>
          </div>
        ) : null}
        {linkedIssues.length > 0 && 'scene_id' in config ? (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-3 text-sm">
            <p className="text-amber-800 dark:text-amber-200">
              The linked scene has {linkedIssues.length} unavailable saved
              reference{linkedIssues.length === 1 ? '' : 's'}.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-200">
              {linkedIssues.map((issue) => (
                <li key={issue} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
            <Link
              to={`/config/scenes/${encodeURIComponent(config.scene_id)}?section=targets`}
              className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              Review linked scene targets
            </Link>
          </div>
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
        {descriptor.mode === 'state' &&
        descriptor.summary !== 'No state set' ? (
          <SceneResolvedColorPreview
            config={config}
            devices={devices}
            scenes={scenes}
            targetKey={key}
            targetKind={kind}
          />
        ) : null}
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
      <div className="min-w-0 space-y-4">
        <BoundedList
          items={entries}
          keyOf={([key]) => `${kind}:${key}`}
          revealKey={
            openTargetKey?.startsWith(`${kind}:`) ? openTargetKey : null
          }
          moreLabel={(remaining) =>
            `Show ${Math.min(remaining, 30)} more ${kind === 'device' ? 'device' : 'room'} targets`
          }
          renderItem={([key, config], index) => {
            const label =
              kind === 'device'
                ? (devices[key]?.name ?? key)
                : (groups.find((group) => group.id === key)?.name ?? key);
            const descriptor = describeSceneTarget(key, { kind }, config, {
              sceneIds,
              sceneNames,
              groupNames,
              deviceNames,
              deviceKeys: knownDeviceKeys,
              aliases: sourceAliases,
            });
            const unavailable = /no longer exists|not available/i.test(
              descriptor.unresolvedReason ?? '',
            );
            const missingMembers =
              kind === 'group'
                ? (effects.targets.find(
                    (target) => target.kind === 'group' && target.key === key,
                  )?.missingMembers ?? [])
                : [];
            return (
              <div data-target-key={key}>
                <SceneTargetConfigEditor
                  targetKey={key}
                  targetLabel={label}
                  config={config}
                  devices={devices}
                  groups={groups}
                  allScenes={scenes}
                  scenes={scenes.filter(
                    (candidate) => candidate.id !== scene.id,
                  )}
                  targetKind={kind}
                  onChange={(next) => onChange({ ...items, [key]: next })}
                  onRemove={() => {
                    const copy = { ...items };
                    delete copy[key];
                    if (kind === 'group') {
                      updateRooms(
                        copy,
                        (order ?? Object.keys(items)).filter(
                          (orderedKey) => orderedKey !== key,
                        ),
                      );
                    } else {
                      onChange(copy);
                    }
                  }}
                  {...(kind === 'group'
                    ? {
                        position: index,
                        targetCount: entries.length,
                        onMoveUp: () => moveRoom(key, -1),
                        onMoveDown: () => moveRoom(key, 1),
                      }
                    : {})}
                  selected={openTargetKey === `${kind}:${key}`}
                  onSelect={() =>
                    setOpenTargetKey((current) =>
                      current === `${kind}:${key}` ? null : `${kind}:${key}`,
                    )
                  }
                />
                {unavailable ? (
                  <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/5 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                    <AlertTriangle
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>
                      {descriptor.unresolvedReason}. Open this row to choose a
                      replacement or remove the saved target.
                      <span className="mt-1 block break-all font-mono">
                        {kind === 'device' ? key : label === key ? key : null}
                      </span>
                    </span>
                  </p>
                ) : null}
                {missingMembers.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/5 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                    <p>
                      {missingMembers.length} saved room member
                      {missingMembers.length === 1 ? '' : 's'} are unavailable:
                    </p>
                    <ul className="mt-1 space-y-1">
                      {missingMembers.map((memberKey) => (
                        <li key={memberKey} className="break-all font-mono">
                          {memberKey}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={`/config/groups/${encodeURIComponent(key)}?section=devices`}
                      className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Repair room devices
                    </Link>
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      </div>
    );
  };

  const targetSectionOpen =
    activeSection === 'targets' ||
    activeSection === 'devices' ||
    activeSection === 'rooms';
  const draftDeviceStates = targetEditor.draft?.device_states ?? {};
  const draftGroupStates = targetEditor.draft?.group_states ?? {};
  const selectedTargetKeys = [
    ...Object.keys(draftDeviceStates).map((key) => `device:${key}`),
    ...Object.keys(draftGroupStates).map((key) => `group:${key}`),
  ];
  const targetAddOptions: SceneTargetOption[] = [
    ...deviceOptions.map((option) => ({ ...option, kind: 'device' as const })),
    ...roomOptions.map((option) => ({ ...option, kind: 'group' as const })),
  ];

  const savedTargetRows = [
    ...roomTargets.map(([key, config]) => ({
      key,
      config,
      kind: 'group' as const,
    })),
    ...deviceTargets.map(([key, config]) => ({
      key,
      config,
      kind: 'device' as const,
    })),
  ];
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
        <span>
          {scene.hidden ? 'Hidden · ' : ''}
          {effects.unknownOutcomeCount > 0
            ? effects.affectedDeviceCount > 0
              ? `${effects.affectedDeviceCount} fallback device effect${effects.affectedDeviceCount === 1 ? '' : 's'}`
              : 'Output depends on the current room scene'
            : effects.scripted
              ? effects.affectedDeviceCount > 0
                ? `${effects.affectedDeviceCount} resolved device effect${effects.affectedDeviceCount === 1 ? '' : 's'} before script`
                : 'Script output is not predicted'
              : effects.affectedDeviceCount > 0
                ? `${effects.affectedDeviceCount} device${effects.affectedDeviceCount === 1 ? '' : 's'} would be affected`
                : 'This scene would change nothing'}
        </span>
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

        {effects.unresolvedCount > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/35 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>
              {effects.unresolvedCount} saved reference
              {effects.unresolvedCount === 1 ? '' : 's'} cannot be resolved;
              activation would request changes for {effects.affectedDeviceCount}{' '}
              available device{effects.affectedDeviceCount === 1 ? '' : 's'}.
            </span>
            <span className="w-full pl-6 text-xs text-amber-800/90 dark:text-amber-200/90">
              Missing:{' '}
              {[
                effects.unresolvedByKind.directTargets > 0
                  ? `${effects.unresolvedByKind.directTargets} device target${effects.unresolvedByKind.directTargets === 1 ? '' : 's'}`
                  : null,
                effects.unresolvedByKind.roomTargets > 0
                  ? `${effects.unresolvedByKind.roomTargets} room target${effects.unresolvedByKind.roomTargets === 1 ? '' : 's'}`
                  : null,
                effects.unresolvedByKind.roomMembers > 0
                  ? `${effects.unresolvedByKind.roomMembers} saved room member${effects.unresolvedByKind.roomMembers === 1 ? '' : 's'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11 text-amber-900 underline dark:text-amber-100"
              onClick={() => openSection('targets', { target: null })}
            >
              Review targets
            </Button>
          </p>
        ) : null}

        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <h2 className="text-sm font-semibold">
            {effects.scripted
              ? 'Saved targets before script'
              : 'What activation would request'}
          </h2>
          {effects.targets.length === 0 ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-muted-foreground">
                {effects.scripted
                  ? 'This scene has no saved targets. Its script may create effects that are not predicted here.'
                  : 'This scene has no targets yet, so activating it would change nothing.'}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={beginAddingTarget}
              >
                Add a target
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {effects.affectedDeviceCount === 0
                  ? effects.unknownOutcomeCount > 0
                    ? 'The current scene in a linked room determines which devices receive requests.'
                    : 'No available device would change.'
                  : `${effects.affectedDeviceCount} available device${effects.affectedDeviceCount === 1 ? '' : 's'} match the saved target preview.`}
                {effects.scripted
                  ? ' The script can override these saved targets when it runs.'
                  : ''}
                {effects.unknownOutcomeCount > 0
                  ? ' A mirrored target may use a different current scene when activated.'
                  : ''}
              </p>

              <ul className="mt-3 space-y-1.5">
                {groupedEffects.slice(0, visibleEffectCount).map((group) => {
                  const brightness = group.entries
                    .map((entry) =>
                      entry.changes.find((change) =>
                        /^\d+(?:\.\d+)?%$/.test(change),
                      ),
                    )
                    .filter((value): value is string => Boolean(value));
                  const brightnessSummary = [...new Set(brightness)].join(
                    ' and ',
                  );
                  const colorRgb = group.color ? colorToRgb(group.color) : null;
                  const powered = !group.changes.includes('off');
                  return (
                    <li
                      key={`${group.fromLabel}:${group.changes.join(',')}:${JSON.stringify(group.color)}`}
                      className="rounded-lg px-2 py-1.5 text-sm even:bg-muted/30"
                    >
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{group.fromLabel}</span>
                        <span className="text-muted-foreground">
                          {group.entries.length} device
                          {group.entries.length === 1 ? '' : 's'}
                        </span>
                        {group.color && powered ? (
                          <ResolvedColorDot
                            color={Color.rgb(
                              colorRgb!.r,
                              colorRgb!.g,
                              colorRgb!.b,
                            )}
                            isPowered={powered}
                            label={group.colorWords ?? 'color set'}
                            detail={colourDetail(group.color, group.colorWords)}
                          />
                        ) : null}
                        <span className="text-foreground/85">
                          {[
                            ...group.changes,
                            ...(brightnessSummary ? [brightnessSummary] : []),
                          ].join(' · ') || 'no state change'}
                        </span>
                        {group.colorWords && powered ? (
                          <span className="text-foreground/85">
                            {group.colorWords}
                          </span>
                        ) : null}
                      </p>
                      {group.entries.length > 1 || group.color ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            Device details
                          </summary>
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                            {group.color ? (
                              <p>
                                Color:{' '}
                                {colourDetail(group.color, group.colorWords)}
                              </p>
                            ) : null}
                            <ul className="space-y-0.5">
                              {group.entries.slice(0, 40).map((entry) => (
                                <li key={entry.deviceKey}>
                                  {entry.deviceLabel}:{' '}
                                  {entry.changes.join(' · ') ||
                                    'no state change'}
                                </li>
                              ))}
                              {group.entries.length > 40 ? (
                                <li>
                                  +{group.entries.length - 40} more devices
                                </li>
                              ) : null}
                            </ul>
                          </div>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {groupedEffects.length > visibleEffectCount ? (
                <button
                  type="button"
                  className="min-h-11 text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setShowAllEffects(true)}
                >
                  Show all {groupedEffects.length} outcomes
                </button>
              ) : null}

              {effects.overrideNotes.length > 0 ? (
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer text-xs font-medium text-muted-foreground">
                    When targets overlap
                  </summary>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {effects.overrideNotes.map((note, index) => (
                      <li key={`${index}:${note}`}>{note}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </div>

        <Section<Scene>
          id="targets"
          title="Targets"
          summary={`${summary.groupCount} room · ${summary.deviceCount} device target${summary.deviceCount === 1 ? '' : 's'}${summary.groupCount > 1 ? ' · rooms apply in order' : ''}`}
          open={targetSectionOpen}
          onOpenChange={(open) => openSection(open ? 'targets' : null)}
          api={targetEditor}
          changeLabel="Change targets"
          headingRef={(node) => {
            headingRefs.current.targets = node;
          }}
          readView={
            <BoundedList
              items={savedTargetRows}
              keyOf={(item) => `${item.kind}:${item.key}`}
              revealKey={urlTargetRevealKey}
              emptyMessage="No targets yet. Add a device or room to decide what this scene requests."
              renderItem={({ key, config, kind }, index) => (
                <div className="space-y-2">
                  {kind === 'group' && index > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Later room targets win when rooms share a device.
                    </p>
                  ) : null}
                  {targetRow(key, kind, config)}
                </div>
              )}
            />
          }
          renderEditor={() => (
            <ConfigFormSection
              className="border-0 bg-transparent p-0 shadow-none"
              description={
                roomTargets.length > 1
                  ? 'Room targets run in order, then direct device targets. Later targets win for shared devices.'
                  : 'Room targets run first, then direct device targets.'
              }
            >
              <div className="space-y-5">
                {roomTargets.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    Reorder rooms only when their members overlap. Direct device
                    targets always run after rooms.
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {draftTargetEditor(
                    'group',
                    draftGroupStates,
                    (next) => updateRooms(next, roomOrder),
                    roomOrder,
                  )}
                  {draftTargetEditor(
                    'device',
                    draftDeviceStates,
                    updateDevices,
                  )}
                </div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddingTarget(true)}
                  >
                    Add device or room
                  </Button>
                  {addingTarget ? (
                    <AddSceneTargetModal
                      options={targetAddOptions}
                      existingKeys={selectedTargetKeys}
                      onAdd={(key, kind) => {
                        const targetKind = kind ?? 'device';
                        if (targetKind === 'device') {
                          updateDevices({ ...draftDeviceStates, [key]: {} });
                        } else {
                          updateRooms({ ...draftGroupStates, [key]: {} }, [
                            ...roomOrder,
                            key,
                          ]);
                        }
                        setOpenTargetKey(`${targetKind}:${key}`);
                        setAddingTarget(false);
                        openSection('targets', { target: key });
                      }}
                      onClose={() => setAddingTarget(false)}
                    />
                  ) : null}
                </div>
              </div>
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
                ID <span className="font-mono">{scene.id}</span> is fixed once
                routines or scene links refer to it.
              </p>
              <ConfigToggleRow
                label="Hidden"
                description="Hidden scenes still run from automations and scene links; they are just left out of the main lists."
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
