'use client';

import dynamicImport from 'next/dynamic';
import {
  useGroups,
  useScenes,
  Scene,
  SceneDeviceConfig,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useMemo, useState } from 'react';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
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

const NoSSRSceneScriptEditor = dynamicImport(
  () => import('@/ui/SceneScriptEditor'),
  {
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-xl border border-base-300 bg-base-100/50 text-sm opacity-70">
        Loading script editor...
      </div>
    ),
    ssr: false,
  },
);

const getSceneSearchValues = (scene: Scene) => [
  scene.id,
  scene.name,
  scene.hidden ? 'hidden' : 'visible',
  scene.script ?? '',
  Object.keys(scene.device_states ?? {}),
  Object.keys(scene.group_states ?? {}),
];

function getSceneActivationErrorMessage(responseBody: string, sceneId: string) {
  if (!responseBody.trim()) {
    return `Failed to activate scene "${sceneId}".`;
  }

  try {
    const parsed = JSON.parse(responseBody) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof parsed.error === 'string'
    ) {
      return parsed.error;
    }
  } catch {
    return responseBody;
  }

  return responseBody;
}

async function triggerScene(apiEndpoint: string, sceneId: string) {
  const response = await fetch(`${apiEndpoint}/api/v1/actions/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'ActivateScene',
      scene_id: sceneId,
    }),
  });

  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(getSceneActivationErrorMessage(responseBody, sceneId));
}

export default function ScenesPage() {
  const { apiEndpoint } = useAppConfig();
  const { data: scenes, loading, error, create, update, remove } = useScenes();
  const { data: groups } = useGroups();
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationNotice, setActivationNotice] = useState<string | null>(null);
  const [activatingSceneId, setActivatingSceneId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { devicesState: devices } = useDevicesApi();
  const deviceOptions = useMemo(
    () =>
      Object.entries(devices)
        .filter((entry): entry is [string, NonNullable<(typeof devices)[string]>] => entry[1] !== undefined)
        .map(([key, device]) => ({
          key,
          label: device.name,
        }))
        .sort(
          (left, right) =>
            left.label.localeCompare(right.label) || left.key.localeCompare(right.key),
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
            left.label.localeCompare(right.label) || left.key.localeCompare(right.key),
        ),
    [groups],
  );
  const visibleScenes = scenes.filter((scene) =>
    matchesConfigSearch(search, ...getSceneSearchValues(scene)),
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

    setActivationNotice(`Activated scene "${scene.name}".`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error loading scenes: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Scenes</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Add Scene
        </button>
      </div>

      {activationError && (
        <div className="alert alert-warning">
          <span>{activationError}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setActivationError(null)}>
            ✕
          </button>
        </div>
      )}

      {activationNotice && (
        <div className="alert alert-success">
          <span>{activationNotice}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setActivationNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="space-y-4">
        <ConfigListSearchBar
          filteredCount={visibleScenes.length}
          onChange={setSearch}
          placeholder="Search by name, id, script, or targets"
          totalCount={scenes.length}
          value={search}
        />

        {visibleScenes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-base-300 bg-base-200/50 p-6 text-center text-sm opacity-70">
            No scenes match the current search.
          </div>
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
                isEditing={editingId === scene.id}
                onActivate={() => {
                  void activateScene(scene);
                }}
                onEdit={() => setEditingId(scene.id)}
                onSave={async (updated) => {
                  await update(scene.id, updated);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
                onDelete={async () => {
                  if (confirm(`Delete scene "${scene.name}"?`)) {
                    await remove(scene.id);
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
      scope.push(`${config.device_keys.length} device${config.device_keys.length === 1 ? '' : 's'}`);
    }
    if (config.group_keys?.length) {
      scope.push(`${config.group_keys.length} group${config.group_keys.length === 1 ? '' : 's'}`);
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
}: {
  emptyMessage: string;
  items: Record<string, SceneDeviceConfig>;
  scenes: Scene[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  options: SceneTargetOption[];
  targetKind: SceneTargetKind;
  title: string;
}) {
  const optionLabelByKey = Object.fromEntries(
    options.map((option) => [option.key, option.label]),
  );
  const entries = Object.entries(items);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-sm opacity-60">{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-base-300 bg-base-100/40 p-4 text-sm opacity-70">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {entries.map(([targetKey, config]) => (
            <div key={targetKey} className="rounded-lg border border-base-300 bg-base-100/70 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">{optionLabelByKey[targetKey] ?? targetKey}</div>
                  <div className="text-xs opacity-60">{targetKey}</div>
                </div>
                <span className="badge badge-ghost">{getSceneConfigTypeLabel(config)}</span>
              </div>
              <p className="mt-2 text-sm opacity-80">{getSceneConfigSummary(config)}</p>
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
      const resolved = resolveSceneColor(config, 'device', targetKey, scenes, devices);
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
      const resolved = resolveSceneColor(config, 'group', targetKey, scenes, devices);
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
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-base-300 bg-base-100/60 px-3 py-1 text-xs opacity-85"
        >
          <ResolvedColorDot
            className="inline-flex h-3 w-3 shrink-0 rounded-full border border-base-content/15 shadow-inner"
            color={resolved.color}
            isPowered={resolved.isPowered}
          />
          <span className="max-w-36 truncate">{label}</span>
        </span>
      ))}
      {resolvedTargets.length > visibleTargets.length && (
        <span className="badge badge-ghost badge-sm">+{resolvedTargets.length - visibleTargets.length} more</span>
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
}: {
  scene: Scene;
  scenes: Scene[];
  devices: ReturnType<typeof useDevicesApi>['devicesState'];
  deviceOptions: SceneTargetOption[];
  groupOptions: SceneTargetOption[];
  onSave: (scene: Partial<Scene>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(scene.name);
  const [hidden, setHidden] = useState(scene.hidden);
  const [script, setScript] = useState(scene.script || '');
  const [deviceStates, setDeviceStates] = useState(scene.device_states || {});
  const [groupStates, setGroupStates] = useState(scene.group_states || {});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const otherScenes = scenes.filter((candidate) => candidate.id !== scene.id);

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
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save scene.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="space-y-4">
          <input
            type="text"
            className="input input-bordered font-bold text-lg w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle"
                checked={hidden}
                onChange={(event) => setHidden(event.target.checked)}
              />
              <span className="label-text">Hidden</span>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-base-300 bg-base-100/60 px-4 py-3 text-sm opacity-75">
          Scene scripts evaluate a JavaScript expression. Use
          {' '}defineSceneScript(() =&gt; {'{'} ... {'}'}){' '}
          for typed autocomplete, plus bindings like
          {' '}devices["integration/device"]{' '}and{' '}groups["group-id"].
        </div>
      </div>

      <div className="space-y-2">
        <label className="label px-0">
          <span className="label-text font-medium">Script (JavaScript)</span>
        </label>
        <NoSSRSceneScriptEditor
          deviceOptions={deviceOptions}
          groupOptions={groupOptions}
          sceneIds={otherScenes.map((candidate) => candidate.id)}
          value={script}
          onChange={setScript}
        />
      </div>

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
      />

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
        onChange={setGroupStates}
      />

      {saveError && (
        <div className="alert alert-error">
          <span>{saveError}</span>
        </div>
      )}

      <div className="card-actions justify-end gap-2 pt-4 border-t border-base-300">
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={isSaving}
          onClick={() => {
            void handleSave();
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
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
  isEditing,
  onActivate,
  onEdit,
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
  isEditing: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onSave: (scene: Partial<Scene>) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const deviceStateCount = Object.keys(scene.device_states || {}).length;
  const groupStateCount = Object.keys(scene.group_states || {}).length;

  return (
    <div className="collapse collapse-arrow bg-base-200 shadow-xl">
      <input type="checkbox" defaultChecked={isEditing} />
      <div className="collapse-title space-y-3 pr-14">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="card-title">{scene.name}</h2>
            <div className="text-sm opacity-70">{scene.id}</div>
          </div>
          <div className="flex flex-wrap gap-2 items-center justify-end">
            {scene.hidden && <div className="badge badge-ghost">Hidden</div>}
            {scene.script && <div className="badge badge-info">Script</div>}
            {deviceStateCount > 0 && (
              <div className="badge badge-secondary">
                {deviceStateCount} device{deviceStateCount !== 1 ? 's' : ''}
              </div>
            )}
            {groupStateCount > 0 && (
              <div className="badge badge-accent">
                {groupStateCount} group{groupStateCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        <div className="text-sm opacity-80">
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

      <div className="collapse-content px-6 pb-6">
        {isEditing ? (
          <SceneEditorForm
            scene={scene}
            scenes={scenes}
            devices={devices}
            deviceOptions={deviceOptions}
            groupOptions={groupOptions}
            onSave={onSave}
            onCancel={onCancel}
          />
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Script</h3>
                <span className="text-sm opacity-60">
                  {scene.script ? 'Enabled' : 'Not configured'}
                </span>
              </div>
              {scene.script ? (
                <pre className="overflow-x-auto rounded-lg border border-base-300 bg-base-100/70 p-4 text-sm leading-6">
                  <code>{scene.script}</code>
                </pre>
              ) : (
                <div className="rounded-lg border border-dashed border-base-300 bg-base-100/40 p-4 text-sm opacity-70">
                  No scene script configured.
                </div>
              )}
            </section>

            <SceneTargetsSummary
              emptyMessage="No device targets configured."
              items={scene.device_states || {}}
              scenes={scenes}
              devices={devices}
              options={deviceOptions}
              targetKind="device"
              title="Device Targets"
            />

            <SceneTargetsSummary
              emptyMessage="No group targets configured."
              items={scene.group_states || {}}
              scenes={scenes}
              devices={devices}
              options={groupOptions}
              targetKind="group"
              title="Group Targets"
            />

            <div className="card-actions justify-end mt-2 gap-2">
              <button
                className="btn btn-sm btn-secondary"
                disabled={isActivating}
                onClick={onActivate}
                type="button"
              >
                {isActivating ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    Activating
                  </>
                ) : (
                  'Activate'
                )}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onEdit}>
                Edit
              </button>
              <button className="btn btn-sm btn-error btn-ghost" onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Scene</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Scene ID</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="evening-relax"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Name</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Evening Relax"
          />
        </div>

        <div className="form-control mt-4">
          <label className="label cursor-pointer">
            <span className="label-text">Hidden</span>
            <input
              type="checkbox"
              className="toggle"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
          </label>
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!id || !name}
            onClick={() => onCreate({ id, name, hidden })}
          >
            Create
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
