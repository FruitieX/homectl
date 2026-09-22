import type { SceneCommand } from '@/bindings/SceneCommand';
import { createUuid } from '@/lib/uuid';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import {
  useGroups,
  useScenes,
  Scene,
  SceneDeviceConfig,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { matchesConfigSearch } from '@/lib/configSearch';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { ConfigPageHeader } from '../page-header';
import { Advanced } from '@/ui/primitives/advanced';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { ExpandableConfigCard } from '@/ui/ExpandableConfigCard';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigHelpPanel,
  ConfigToggleRow,
} from '@/ui/config-form';
import {
  SceneTargetOption,
  SceneTargetSectionEditor,
} from '@/ui/SceneDeviceStateEditor';
import {
  ResolvedColorDot,
  SceneResolvedColorPreview,
  resolveSceneColor,
  type SceneTargetKind,
} from '@/ui/SceneResolvedColorPreview';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { checkboxClassName } from '@/ui/form-styles';

const LazySceneScriptEditor = lazy(() => import('@/ui/SceneScriptEditor'));

const NoSSRSceneScriptEditor = (
  props: React.ComponentProps<typeof LazySceneScriptEditor>,
) => (
  <Suspense
    fallback={
      <div className="flex h-96 items-center justify-center rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
        Loading script editor...
      </div>
    }
  >
    <LazySceneScriptEditor {...props} />
  </Suspense>
);

const getSceneSearchValues = (scene: Scene) => [
  scene.id,
  scene.name,
  scene.hidden ? 'hidden' : 'visible',
  scene.script ?? '',
  Object.keys(scene.device_states ?? {}),
  Object.keys(scene.group_states ?? {}),
];

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
      } satisfies SceneCommand),
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

export default function ScenesPage() {
  const { apiEndpoint } = useAppConfig();
  const {
    data: scenes,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
  } = useScenes();
  const { data: groups } = useGroups();
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationNotice, setActivationNotice] = useState<string | null>(null);
  const [activatingSceneId, setActivatingSceneId] = useState<string | null>(
    null,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [showCreate, setShowCreate] = useState(false);
  useCreateDeepLink(useCallback(() => setShowCreate(true), []));
  const location = useLocation();
  const requestedSceneId = searchParams.get('scene');
  const requestedDeviceKey = searchParams.get('device');
  const appliedDeepLink = useRef<string | null>(null);
  const [deviceFocus, setDeviceFocus] = useState<{
    sceneId: string;
    deviceKey: string;
    nonce: number;
  } | null>(null);
  const { devicesState: devices } = useDevicesApi();
  const deviceOptions = useMemo(
    () =>
      Object.entries(devices)
        .filter(
          (entry): entry is [string, NonNullable<(typeof devices)[string]>] =>
            entry[1] !== undefined,
        )
        .map(([key, device]) => ({
          key,
          label: device.name,
        }))
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) ||
            left.key.localeCompare(right.key),
        ),
    [devices],
  );
  const groupOptions = useMemo(
    () =>
      groups
        .map((group) => ({
          key: group.id,
          label: group.name,
        }))
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) ||
            left.key.localeCompare(right.key),
        ),
    [groups],
  );
  const visibleScenes = scenes.filter((scene) =>
    matchesConfigSearch(search, ...getSceneSearchValues(scene)),
  );

  useEffect(() => {
    if (loading || error || !requestedSceneId) {
      return;
    }
    const scene = scenes.find((candidate) => candidate.id === requestedSceneId);
    if (!scene) {
      return;
    }
    const linkKey = `${location.key}:${requestedSceneId}:${requestedDeviceKey ?? ''}`;
    if (appliedDeepLink.current === linkKey) {
      return;
    }
    appliedDeepLink.current = linkKey;
    if (!matchesConfigSearch(search, ...getSceneSearchValues(scene))) {
      setSearch('');
    }
    setOpenId(scene.id);
    if (requestedDeviceKey) {
      setDeviceFocus((current) => ({
        sceneId: scene.id,
        deviceKey: requestedDeviceKey,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    }
  }, [
    error,
    loading,
    location.key,
    requestedDeviceKey,
    requestedSceneId,
    scenes,
    search,
  ]);

  const openScene = scenes?.find((scene) => scene.id === openId) ?? null;
  useAssistantPageContext(
    openScene
      ? { kind: 'scene', id: openScene.id, label: openScene.name }
      : { kind: 'scene' },
  );

  const activateScene = async (scene: Scene) => {
    setActivatingSceneId(scene.id);
    setActivationError(null);
    setActivationNotice(null);

    try {
      await triggerScene(apiEndpoint, scene.id);
    } catch (nextError) {
      setActivationError(
        nextError instanceof Error
          ? nextError.message
          : `Failed to activate scene "${scene.name}".`,
      );
      return;
    } finally {
      setActivatingSceneId(null);
    }

    setActivationNotice(`Applied scene "${scene.name}" to runtime state.`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>Could not load scenes: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Scenes"
        description="Save a device state you can recall manually or from an automation."
        actions={<Button onClick={() => setShowCreate(true)}>Add scene</Button>}
      />

      {activationError && openId === null && (
        <Alert variant="warning">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{activationError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActivationError(null)}
            >
              ✕
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {activationNotice && openId === null && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{activationNotice}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActivationNotice(null)}
            >
              ✕
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <ConfigListSearchBar
          filteredCount={visibleScenes.length}
          onChange={setSearch}
          placeholder="Search scenes"
          totalCount={scenes.length}
          value={search}
        />

        {visibleScenes.length === 0 ? (
          <EmptyState
            title={scenes.length === 0 ? 'No scenes yet' : 'No matching scenes'}
            description={
              scenes.length === 0
                ? 'Save a useful light or device state to recall it later.'
                : 'Try another name or clear your search.'
            }
            action={
              scenes.length === 0 ? (
                <Button onClick={() => setShowCreate(true)}>
                  Create your first scene
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-4">
            {visibleScenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                scenes={scenes}
                devices={devices}
                deviceOptions={deviceOptions}
                groupOptions={groupOptions}
                isActivating={activatingSceneId === scene.id}
                activationError={openId === scene.id ? activationError : null}
                activationNotice={openId === scene.id ? activationNotice : null}
                isOpen={openId === scene.id}
                focusDeviceKey={
                  deviceFocus?.sceneId === scene.id
                    ? deviceFocus.deviceKey
                    : null
                }
                focusNonce={
                  deviceFocus?.sceneId === scene.id ? deviceFocus.nonce : 0
                }
                onOpen={() => {
                  setActivationError(null);
                  setActivationNotice(null);
                  setOpenId(scene.id);
                }}
                onClose={() => {
                  setOpenId((current) =>
                    current === scene.id ? null : current,
                  );
                }}
                onActivate={() => {
                  void activateScene(scene);
                }}
                onSave={async (updated) => {
                  await update(scene.id, updated);
                  setOpenId((current) =>
                    current === scene.id ? null : current,
                  );
                }}
                onCancel={() =>
                  setOpenId((current) =>
                    current === scene.id ? null : current,
                  )
                }
                onDelete={async () => {
                  if (
                    await confirmDestructive(
                      `Delete scene "${scene.name}"?`,
                      'Routines and links that reference this scene will stop resolving.',
                    )
                  ) {
                    await remove(scene.id);
                    setOpenId((current) =>
                      current === scene.id ? null : current,
                    );
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSceneModal
          onClose={() => setShowCreate(false)}
          onCreate={async (scene) => {
            await create(scene);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function getSceneConfigTypeLabel(config: SceneDeviceConfig) {
  if ('scene_id' in config) {
    return 'Scene Link';
  }

  if ('integration_id' in config) {
    return 'Device Link';
  }

  return 'Device State';
}

function getSceneConfigSummary(config: SceneDeviceConfig) {
  if ('scene_id' in config) {
    const scope = [];
    if (config.device_keys?.length) {
      scope.push(
        `${config.device_keys.length} device${config.device_keys.length === 1 ? '' : 's'}`,
      );
    }
    if (config.group_keys?.length) {
      scope.push(
        `${config.group_keys.length} group${config.group_keys.length === 1 ? '' : 's'}`,
      );
    }

    return scope.length > 0
      ? `Inherit from ${config.scene_id} for ${scope.join(', ')}`
      : `Inherit from ${config.scene_id}`;
  }

  if ('integration_id' in config) {
    const target = getSceneDeviceLinkTargetKey(config) || 'unknown device';
    const brightness =
      config.brightness !== undefined
        ? ` · ${Math.round(config.brightness * 100)}% brightness`
        : '';
    return `Track ${target}${brightness}`;
  }

  const details = [];
  if (config.power !== undefined) {
    details.push(config.power ? 'On' : 'Off');
  }
  if (config.brightness !== undefined) {
    details.push(`${Math.round(config.brightness * 100)}% brightness`);
  }
  if (config.transition !== undefined) {
    details.push(`${config.transition}s transition`);
  }
  if (config.color) {
    details.push('Color set');
  }

  return details.join(' · ') || 'Custom device state';
}

function SceneTargetsSummary({
  emptyMessage,
  items,
  scenes,
  devices,
  options,
  targetKind,
  title,
  order,
}: {
  emptyMessage: string;
  items: Record<string, SceneDeviceConfig>;
  scenes: Scene[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  options: SceneTargetOption[];
  targetKind: SceneTargetKind;
  title: string;
  order?: string[];
}) {
  const optionLabelByKey = Object.fromEntries(
    options.map((option) => [option.key, option.label]),
  );
  const entries = [
    ...(order ?? [])
      .filter((key) => key in items)
      .map((key) => [key, items[key]] as const),
    ...Object.entries(items).filter(([key]) => !(order ?? []).includes(key)),
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-sm opacity-60">{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {entries.map(([targetKey, config]) => (
            <div
              key={targetKey}
              className="rounded-2xl border border-border bg-background/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {optionLabelByKey[targetKey] ?? targetKey}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {targetKey}
                  </div>
                </div>
                <Badge variant="muted">{getSceneConfigTypeLabel(config)}</Badge>
              </div>
              <p className="mt-2 text-sm text-foreground/80">
                {getSceneConfigSummary(config)}
              </p>
              <SceneResolvedColorPreview
                config={config}
                devices={devices}
                scenes={scenes}
                targetKey={targetKey}
                targetKind={targetKind}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SceneResolvedColorCardSummary({
  deviceItems,
  deviceOptions,
  devices,
  groupItems,
  groupOptions,
  scenes,
}: {
  deviceItems: Record<string, SceneDeviceConfig>;
  deviceOptions: SceneTargetOption[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  groupItems: Record<string, SceneDeviceConfig>;
  groupOptions: SceneTargetOption[];
  scenes: Scene[];
}) {
  const deviceLabelByKey = Object.fromEntries(
    deviceOptions.map((option) => [option.key, option.label]),
  );
  const groupLabelByKey = Object.fromEntries(
    groupOptions.map((option) => [option.key, option.label]),
  );
  const resolvedTargets = [
    ...Object.entries(deviceItems).flatMap(([targetKey, config]) => {
      const resolved = resolveSceneColor(
        config,
        'device',
        targetKey,
        scenes,
        devices,
      );
      if (!resolved) {
        return [];
      }

      return [
        {
          key: `device:${targetKey}`,
          label: deviceLabelByKey[targetKey] ?? targetKey,
          resolved,
        },
      ];
    }),
    ...Object.entries(groupItems).flatMap(([targetKey, config]) => {
      const resolved = resolveSceneColor(
        config,
        'group',
        targetKey,
        scenes,
        devices,
      );
      if (!resolved) {
        return [];
      }

      return [
        {
          key: `group:${targetKey}`,
          label: groupLabelByKey[targetKey] ?? targetKey,
          resolved,
        },
      ];
    }),
  ];

  if (resolvedTargets.length === 0) {
    return null;
  }

  const visibleTargets = resolvedTargets.slice(0, 6);

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {visibleTargets.map(({ key, label, resolved }) => (
        <span
          key={key}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-foreground/85"
        >
          <ResolvedColorDot
            className="inline-flex h-3 w-3 shrink-0 rounded-full border border-foreground/15 shadow-inner"
            color={resolved.color}
            isPowered={resolved.isPowered}
          />
          <span className="max-w-36 truncate">{label}</span>
        </span>
      ))}
      {resolvedTargets.length > visibleTargets.length && (
        <Badge variant="muted">
          +{resolvedTargets.length - visibleTargets.length} more
        </Badge>
      )}
    </div>
  );
}

function SceneEditorForm({
  scene,
  scenes,
  devices,
  deviceOptions,
  groupOptions,
  onSave,
  onCancel,
  focusDeviceKey,
  focusNonce,
}: {
  scene: Scene;
  scenes: Scene[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  deviceOptions: SceneTargetOption[];
  groupOptions: SceneTargetOption[];
  onSave: (scene: Partial<Scene>) => Promise<void>;
  onCancel: () => void;
  focusDeviceKey?: string | null;
  focusNonce?: number;
}) {
  const [name, setName] = useState(scene.name);
  const [hidden, setHidden] = useState(scene.hidden);
  const [script, setScript] = useState(scene.script || '');
  const [deviceStates, setDeviceStates] = useState(() => {
    const initial = scene.device_states || {};
    if (focusDeviceKey && !(focusDeviceKey in initial)) {
      return { ...initial, [focusDeviceKey]: { power: true, brightness: 1 } };
    }
    return initial;
  });
  const [groupStates, setGroupStates] = useState(scene.group_states || {});
  const [groupStateOrder, setGroupStateOrder] = useState(
    scene.group_state_order?.length
      ? scene.group_state_order
      : Object.keys(scene.group_states || {}),
  );
  const [editTab, setEditTab] = useState<
    'basics' | 'script' | 'devices' | 'groups'
  >(focusDeviceKey ? 'devices' : 'basics');
  const focusNotice =
    focusDeviceKey && !(focusDeviceKey in (scene.device_states || {}))
      ? `${focusDeviceKey} is not a target of this scene yet; add it below and save to keep it.`
      : null;
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const otherScenes = scenes.filter((candidate) => candidate.id !== scene.id);

  const changeTab = (value: string) => {
    if (
      value === 'basics' ||
      value === 'script' ||
      value === 'devices' ||
      value === 'groups'
    ) {
      setEditTab(value);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave({
        name,
        hidden,
        script: script || undefined,
        device_states: deviceStates,
        group_states: groupStates,
        group_state_order: groupStateOrder,
      });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save scene.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <Tabs value={editTab} onValueChange={changeTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="basics">Basics</TabsTrigger>

          <TabsTrigger value="script">Advanced script</TabsTrigger>

          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="groups">Rooms</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="mt-4">
          <ConfigFormSection
            title="Scene identity"
            description="Give this scene a name that makes sense when you need it."
          >
            <ConfigField label="Scene name">
              <Input
                type="text"
                className="w-full text-lg font-bold"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </ConfigField>

            <Advanced
              label={hidden ? 'Visibility: Hidden' : 'Visibility: Visible'}
            >
              <ConfigToggleRow
                label="Hidden"
                description="Hidden scenes remain available for automations and linked scene targets."
              >
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={hidden}
                  onChange={(event) => setHidden(event.target.checked)}
                />
              </ConfigToggleRow>
            </Advanced>
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="script" className="mt-4 space-y-4">
          <ConfigFormSection
            title="Script"
            description="Optional JavaScript expression for advanced scene state generation."
          >
            <ConfigHelpPanel>
              Scene scripts evaluate a JavaScript expression. Use{' '}
              defineSceneScript(() =&gt; {'{'} ... {'}'}) for typed
              autocomplete, plus bindings like
              devices[&quot;integration/device&quot;] and{' '}
              groups[&quot;group-id&quot;].
            </ConfigHelpPanel>
            <ConfigField label="Script (JavaScript)">
              <NoSSRSceneScriptEditor
                deviceOptions={deviceOptions}
                groupOptions={groupOptions}
                sceneIds={otherScenes.map((candidate) => candidate.id)}
                value={script}
                onChange={setScript}
              />
            </ConfigField>
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="devices" className="mt-4">
          <ConfigFormSection
            title="Device targets"
            description="Set explicit device states or link a target to another device or scene."
          >
            {focusNotice && (
              <Alert>
                <AlertDescription>{focusNotice}</AlertDescription>
              </Alert>
            )}
            <SceneTargetSectionEditor
              addLabel="Add Device"
              allScenes={scenes}
              emptyDescription="Add devices to configure their states for this scene."
              emptyTitle="No device targets configured"
              items={deviceStates}
              options={deviceOptions}
              scenes={otherScenes}
              sectionTitle="Device Targets"
              targetKind="device"
              devices={devices}
              onChange={setDeviceStates}
              focusTargetKey={focusDeviceKey}
              focusNonce={focusNonce}
            />
          </ConfigFormSection>
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <ConfigFormSection
            title="Room targets"
            description="Apply shared state to groups in order; later targets override earlier ones."
          >
            <SceneTargetSectionEditor
              addLabel="Add Group"
              allScenes={scenes}
              emptyDescription="Add groups to apply the same target config to all devices in that group."
              emptyTitle="No group targets configured"
              items={groupStates}
              options={groupOptions}
              scenes={otherScenes}
              sectionTitle="Group Targets"
              targetKind="group"
              devices={devices}
              order={groupStateOrder}
              onOrderChange={setGroupStateOrder}
              onChange={setGroupStates}
            />
          </ConfigFormSection>
        </TabsContent>
      </Tabs>

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <ConfigFormActions>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isSaving}
          onClick={() => {
            void handleSave();
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </ConfigFormActions>
    </div>
  );
}

function SceneCard({
  scene,
  scenes,
  devices,
  deviceOptions,
  groupOptions,
  isActivating,
  activationError,
  activationNotice,
  isOpen,
  focusDeviceKey,
  focusNonce,
  onActivate,
  onOpen,
  onClose,
  onSave,
  onCancel,
  onDelete,
}: {
  scene: Scene;
  scenes: Scene[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  deviceOptions: SceneTargetOption[];
  groupOptions: SceneTargetOption[];
  isActivating: boolean;
  activationError: string | null;
  activationNotice: string | null;
  isOpen: boolean;
  focusDeviceKey: string | null;
  focusNonce: number;
  onActivate: () => void;
  onOpen: () => void;
  onClose: () => void;
  onSave: (scene: Partial<Scene>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const deviceStateCount = Object.keys(scene.device_states || {}).length;
  const groupStateCount = Object.keys(scene.group_states || {}).length;

  const summary = (
    <div className="space-y-3 pr-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{scene.name}</h2>
          <div className="text-sm text-muted-foreground">{scene.id}</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          {scene.hidden && <Badge variant="muted">Hidden</Badge>}
          {scene.script && <Badge variant="secondary">Script</Badge>}
          {deviceStateCount > 0 && (
            <Badge variant="secondary">
              {deviceStateCount} device{deviceStateCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {groupStateCount > 0 && (
            <Badge variant="outline">
              {groupStateCount} group{groupStateCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      <div className="text-sm text-foreground/80">
        <span className="font-medium">{deviceStateCount}</span> device targets ·{' '}
        <span className="font-medium">{groupStateCount}</span> group targets
        {scene.script ? ' · scripted overrides enabled' : ''}
      </div>

      <SceneResolvedColorCardSummary
        deviceItems={scene.device_states || {}}
        deviceOptions={deviceOptions}
        devices={devices}
        groupItems={scene.group_states || {}}
        groupOptions={groupOptions}
        scenes={scenes}
      />
    </div>
  );

  return (
    <ExpandableConfigCard
      open={isOpen}
      onOpen={onOpen}
      onClose={onClose}
      summary={summary}
      dialogTitle={scene.name}
      dialogSubtitle={scene.id}
      dialogBoxClassName="max-w-6xl"
    >
      <div className="space-y-6">
        {activationError && (
          <Alert variant="destructive">
            <AlertDescription>{activationError}</AlertDescription>
          </Alert>
        )}
        {activationNotice && (
          <Alert>
            <AlertDescription>{activationNotice}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isActivating}
            onClick={onActivate}
            type="button"
          >
            {isActivating ? (
              <>
                <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Activating
              </>
            ) : (
              'Activate'
            )}
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
        <SceneEditorForm
          key={`${scene.id}:${focusDeviceKey ?? ''}:${focusNonce}`}
          scene={scene}
          scenes={scenes}
          devices={devices}
          deviceOptions={deviceOptions}
          groupOptions={groupOptions}
          onSave={onSave}
          onCancel={onCancel}
          focusDeviceKey={focusDeviceKey}
          focusNonce={focusNonce}
        />
      </div>
    </ExpandableConfigCard>
  );
}

function CreateSceneModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (scene: Partial<Scene>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [hidden, setHidden] = useState(false);

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Scene"
      description="Create a new scene preset."
      className="max-w-xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <ConfigFormSection
          title="Scene identity"
          description="Create the scene shell first; targets and scripts can be added from the edit modal."
        >
          <ConfigField label="Scene ID">
            <Input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="evening-relax"
            />
          </ConfigField>

          <ConfigField label="Name">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Evening Relax"
            />
          </ConfigField>

          <ConfigToggleRow label="Hidden">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
          </ConfigToggleRow>
        </ConfigFormSection>

        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!id || !name}
            onClick={() => onCreate({ id, name, hidden })}
          >
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
