import { useEffect, useState, useCallback } from 'react';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { Device } from '@/bindings/Device';
import type { RolloutStyle } from '@/bindings/RolloutStyle';

const rolloutStyleOptions: RolloutStyle[] = ['spatial'];
export const DEFAULT_ROLLOUT_DURATION_MS = 1500;
export const TRIGGERING_DEVICE_ROLLOUT_SOURCE =
  '__homectl_runtime__/triggering_device';
export const TRIGGERING_DEVICE_ROLLOUT_SOURCE_LABEL = 'Triggering device';

// Action types matching server types
export interface ActivateSceneAction {
  action: 'ActivateScene';
  scene_id: string;
  mirror_from_group?: string;
  include_source_groups?: boolean;
  device_keys?: string[];
  group_keys?: string[];
  use_scene_transition?: boolean;
  transition?: number;
  rollout?: RolloutStyle;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
}

export interface CycleScenesAction {
  action: 'CycleScenes';
  scenes: {
    scene_id: string;
    mirror_from_group?: string;
    device_keys?: string[];
    group_keys?: string[];
    use_scene_transition?: boolean;
    transition?: number;
  }[];
  nowrap?: boolean;
  include_source_groups?: boolean;
  device_keys?: string[];
  group_keys?: string[];
  rollout?: RolloutStyle;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
}

export interface DimAction {
  action: 'Dim';
  name: string;
  devices?: Record<string, Record<string, unknown>>;
  groups?: Record<string, unknown>;
  hidden?: boolean;
}

export interface ForceTriggerRoutineAction {
  action: 'ForceTriggerRoutine';
  routine_id: string;
}

export interface SetDeviceStateAction {
  action: 'SetDeviceState';
  id: string;
  name: string;
  integration_id: string;
  data: unknown;
}

export interface ToggleDeviceOverrideAction {
  action: 'ToggleDeviceOverride';
  device_keys: string[];
  override_state: boolean;
}

export interface CustomAction {
  action: 'Custom';
  payload: unknown;
}

export interface UiAction {
  action: 'Ui';
  state_key: string;
  state_value: unknown;
}

export type Action =
  | ActivateSceneAction
  | CycleScenesAction
  | DimAction
  | ForceTriggerRoutineAction
  | SetDeviceStateAction
  | ToggleDeviceOverrideAction
  | CustomAction
  | UiAction;

// Helper to detect action type
export function getActionType(action: Action): string {
  return action.action;
}

interface RolloutFields {
  rollout?: RolloutStyle;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
}

export function getRolloutValidationError({
  rollout,
  rollout_source_device_key,
  rollout_duration_ms,
}: RolloutFields): string | null {
  if (!rollout) {
    return null;
  }

  if (!rollout_source_device_key && (!rollout_duration_ms || rollout_duration_ms <= 0)) {
    return 'Spatial rollout requires a source device and a duration greater than 0.';
  }

  if (!rollout_source_device_key) {
    return 'Spatial rollout requires a source device.';
  }

  if (!rollout_duration_ms || rollout_duration_ms <= 0) {
    return 'Spatial rollout requires a duration greater than 0.';
  }

  return null;
}

function isRolloutAction(action: Action): action is ActivateSceneAction | CycleScenesAction {
  return action.action === 'ActivateScene' || action.action === 'CycleScenes';
}

export function validateActions(actions: Action[]): string | null {
  for (const action of actions) {
    if (!isRolloutAction(action)) {
      continue;
    }

    const error = getRolloutValidationError(action);
    if (error) {
      return `${action.action}: ${error}`;
    }
  }

  return null;
}

interface SceneSelectorProps {
  scenes: { id: string; name: string }[];
  value: string;
  onChange: (sceneId: string) => void;
}

function SceneSelector({ scenes, value, onChange }: SceneSelectorProps) {
  return (
    <select
      className="select select-bordered select-sm"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select scene...</option>
      {scenes.map((scene) => (
        <option key={scene.id} value={scene.id}>
          {scene.name}
        </option>
      ))}
    </select>
  );
}

interface RoutineSelectorProps {
  routines: { id: string; name: string }[];
  value: string;
  onChange: (routineId: string) => void;
}

function RoutineSelector({ routines, value, onChange }: RoutineSelectorProps) {
  return (
    <select
      className="select select-bordered select-sm"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select routine...</option>
      {routines.map((routine) => (
        <option key={routine.id} value={routine.id}>
          {routine.name}
        </option>
      ))}
    </select>
  );
}

interface DeviceKeysSelectorProps {
  devices: DevicesState;
  value: string[];
  onChange: (keys: string[]) => void;
}

function DeviceKeysSelector({
  devices,
  value,
  onChange,
}: DeviceKeysSelectorProps) {
  const deviceList = Object.entries(devices).map(([key, device]) => ({
    key,
    device: device as Device,
  }));

  const handleToggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key));
    } else {
      onChange([...value, key]);
    }
  };

  return (
    <div className="max-h-40 overflow-y-auto border border-base-300 rounded-lg p-2">
      {deviceList.map(({ key, device }) => (
        <label
          key={key}
          className="flex items-center gap-2 p-1 hover:bg-base-200 rounded cursor-pointer"
        >
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={value.includes(key)}
            onChange={() => handleToggle(key)}
          />
          <span className="text-sm truncate">
            {device.name}{' '}
            <span className="opacity-60 text-xs">({key})</span>
          </span>
        </label>
      ))}
    </div>
  );
}

interface GroupKeysSelectorProps {
  groups: FlattenedGroupsConfig;
  value: string[];
  onChange: (keys: string[]) => void;
}function GroupKeysSelector({
  groups,
  value,
  onChange,
}: GroupKeysSelectorProps) {
  const groupList = Object.entries(groups);

  const handleToggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key));
    } else {
      onChange([...value, key]);
    }
  };

  return (
    <div className="max-h-40 overflow-y-auto border border-base-300 rounded-lg p-2">
      {groupList.map(([key, group]) => (
        <label
          key={key}
          className="flex items-center gap-2 p-1 hover:bg-base-200 rounded cursor-pointer"
        >
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={value.includes(key)}
            onChange={() => handleToggle(key)}
          />
          <span className="text-sm truncate">{group?.name ?? key}</span>
        </label>
      ))}
    </div>
  );
}

interface GroupSelectorProps {
  groups: FlattenedGroupsConfig;
  value: string;
  onChange: (groupId: string) => void;
}

function GroupSelector({ groups, value, onChange }: GroupSelectorProps) {
  const groupList = Object.entries(groups);
  return (
    <select
      className="select select-bordered select-sm"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select group...</option>
      {groupList.map(([key, group]) => (
        <option key={key} value={key}>
          {group?.name ?? key}
        </option>
      ))}
    </select>
  );
}

interface TargetFilterFields {
  device_keys?: string[];
  group_keys?: string[];
}

interface TargetFiltersEditorProps {
  value: TargetFilterFields;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  resetKey?: number | string;
  onChange: (fields: TargetFilterFields) => void;
}

function TargetFiltersEditor({
  value,
  devices,
  groups,
  resetKey,
  onChange,
}: TargetFiltersEditorProps) {
  const [showDeviceFilter, setShowDeviceFilter] = useState(
    !!value.device_keys?.length,
  );
  const [showGroupFilter, setShowGroupFilter] = useState(
    !!value.group_keys?.length,
  );

  const deviceFilterEnabled = showDeviceFilter || !!value.device_keys?.length;
  const groupFilterEnabled = showGroupFilter || !!value.group_keys?.length;

  useEffect(() => {
    if (resetKey === undefined) {
      return;
    }

    setShowDeviceFilter(!!value.device_keys?.length);
    setShowGroupFilter(!!value.group_keys?.length);
  }, [resetKey, value.device_keys, value.group_keys]);

  return (
    <>
      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={deviceFilterEnabled}
            onChange={(e) => {
              setShowDeviceFilter(e.target.checked);
              if (!e.target.checked) {
                onChange({ device_keys: undefined });
              }
            }}
          />
          <span className="label-text">Filter by Devices</span>
        </label>
        {deviceFilterEnabled && (
          <DeviceKeysSelector
            devices={devices}
            value={value.device_keys || []}
            onChange={(keys) => {
              setShowDeviceFilter(true);
              onChange({
                device_keys: keys.length ? keys : undefined,
              });
            }}
          />
        )}
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={groupFilterEnabled}
            onChange={(e) => {
              setShowGroupFilter(e.target.checked);
              if (!e.target.checked) {
                onChange({ group_keys: undefined });
              }
            }}
          />
          <span className="label-text">Filter by Groups</span>
        </label>
        {groupFilterEnabled && (
          <GroupKeysSelector
            groups={groups}
            value={value.group_keys || []}
            onChange={(keys) => {
              setShowGroupFilter(true);
              onChange({
                group_keys: keys.length ? keys : undefined,
              });
            }}
          />
        )}
      </div>
    </>
  );
}

interface MirrorFromGroupFieldProps {
  scene_id: string;
  mirror_from_group?: string;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  label?: string;
  onChange: (update: { scene_id: string; mirror_from_group?: string }) => void;
}

/**
 * Lets the user pick either a literal scene, or "mirror the currently active
 * scene of some other group" with the literal scene acting as a fallback.
 */
function MirrorFromGroupField({
  scene_id,
  mirror_from_group,
  groups,
  scenes,
  label,
  onChange,
}: MirrorFromGroupFieldProps) {
  const mirrorEnabled = mirror_from_group !== undefined;

  return (
    <div className="space-y-2">
      {label ? (
        <label className="label py-0">
          <span className="label-text">{label}</span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2 items-center">
        <SceneSelector
          scenes={scenes}
          value={scene_id}
          onChange={(id) => onChange({ scene_id: id, mirror_from_group })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={mirrorEnabled}
            onChange={(e) =>
              onChange({
                scene_id,
                mirror_from_group: e.target.checked ? '' : undefined,
              })
            }
          />
          Mirror from group
        </label>
        {mirrorEnabled ? (
          <GroupSelector
            groups={groups}
            value={mirror_from_group ?? ''}
            onChange={(id) =>
              onChange({ scene_id, mirror_from_group: id || '' })
            }
          />
        ) : null}
      </div>
      {mirrorEnabled ? (
        <div className="text-xs opacity-60">
          Uses the scene currently active in the selected group. Falls back to
          the scene above if that group has no single active scene.
        </div>
      ) : null}
    </div>
  );
}

interface RolloutEditorFields {
  rollout?: RolloutStyle;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
}

interface RolloutEditorProps {
  value: RolloutEditorFields;
  devices: DevicesState;
  onChange: (fields: RolloutEditorFields) => void;
}

function RolloutEditor({ value, devices, onChange }: RolloutEditorProps) {
  const deviceList = Object.entries(devices).map(([key, device]) => ({
    key,
    device: device as Device,
  }));
  deviceList.sort((left, right) => {
    const nameComparison = left.device.name.localeCompare(right.device.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.key.localeCompare(right.key);
  });

  const rollout = value.rollout?.trim() ?? '';
  const hasRollout = rollout.length > 0;
  const validationError = getRolloutValidationError(value);

  return (
    <div className="space-y-3 rounded-lg border border-base-300 p-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Rollout Style</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={rollout}
          onChange={(e) => {
            const nextRollout = e.target.value.trim() as RolloutStyle | '';
            onChange({
              rollout: nextRollout || undefined,
              rollout_source_device_key: nextRollout
                ? value.rollout_source_device_key
                : undefined,
              rollout_duration_ms: nextRollout
                ? value.rollout_duration_ms ?? DEFAULT_ROLLOUT_DURATION_MS
                : undefined,
            });
          }}
        >
          <option value="">No rollout</option>
          {rolloutStyleOptions.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>
        <span className="label-text-alt mt-1 opacity-60">
          Select how scene activation should roll out across positioned devices.
        </span>
      </div>

      {hasRollout && (
        <>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Rollout Source Device</span>
            </label>
            <select
              className="select select-bordered select-sm"
              value={value.rollout_source_device_key ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  rollout_source_device_key: e.target.value || undefined,
                })
              }
            >
              <option value="">Select a device...</option>
              <option value={TRIGGERING_DEVICE_ROLLOUT_SOURCE}>
                {TRIGGERING_DEVICE_ROLLOUT_SOURCE_LABEL}
              </option>
              {deviceList.map(({ key, device }) => (
                <option key={key} value={key}>
                  {device.name} ({key})
                </option>
              ))}
            </select>
            <span className="label-text-alt mt-1 opacity-60">
              Use a fixed origin device, or choose the triggering device to
              center the rollout on whichever device fired the routine.
            </span>
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Rollout Duration (ms)</span>
            </label>
            <input
              type="number"
              min="1"
              step="100"
              className="input input-bordered input-sm"
              value={value.rollout_duration_ms ?? ''}
              placeholder={String(DEFAULT_ROLLOUT_DURATION_MS)}
              onChange={(e) => {
                const nextValue = e.target.value.trim();
                onChange({
                  ...value,
                  rollout_duration_ms: nextValue
                    ? Math.max(0, Number(nextValue))
                    : undefined,
                });
              }}
            />
            <span className="label-text-alt mt-1 opacity-60">
              Total time for the rollout to reach the farthest positioned target.
            </span>
          </div>

          {validationError && (
            <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {validationError}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type TransitionBehaviorMode = 'none' | 'scene' | 'fixed';

interface TransitionBehaviorFields {
  use_scene_transition?: boolean;
  transition?: number;
}

function getTransitionBehaviorMode({
  use_scene_transition,
  transition,
}: TransitionBehaviorFields): TransitionBehaviorMode {
  if (transition !== undefined) {
    return 'fixed';
  }

  if (use_scene_transition) {
    return 'scene';
  }

  return 'none';
}

function getTransitionBehaviorUpdate(mode: TransitionBehaviorMode): TransitionBehaviorFields {
  switch (mode) {
    case 'scene':
      return { use_scene_transition: true, transition: undefined };
    case 'fixed':
      return { use_scene_transition: false, transition: 0.4 };
    case 'none':
    default:
      return { use_scene_transition: false, transition: undefined };
  }
}

interface TransitionBehaviorEditorProps {
  value: TransitionBehaviorFields;
  label: string;
  sceneHelpText?: string;
  fixedHelpText?: string;
  onChange: (fields: TransitionBehaviorFields) => void;
}

function TransitionBehaviorEditor({
  value,
  label,
  sceneHelpText,
  fixedHelpText,
  onChange,
}: TransitionBehaviorEditorProps) {
  const mode = getTransitionBehaviorMode(value);

  return (
    <div className="space-y-3 rounded-lg border border-base-300 p-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">{label}</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={mode}
          onChange={(e) =>
            onChange(getTransitionBehaviorUpdate(e.target.value as TransitionBehaviorMode))
          }
        >
          <option value="none">No transition</option>
          <option value="scene">Use scene transitions</option>
          <option value="fixed">Fixed transition</option>
        </select>
      </div>

      {mode === 'scene' && sceneHelpText ? (
        <div className="text-sm opacity-60">{sceneHelpText}</div>
      ) : null}

      {mode === 'fixed' ? (
        <div className="form-control">
          <label className="label">
            <span className="label-text">Fixed Transition (s)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="input input-bordered input-sm"
            value={value.transition ?? ''}
            placeholder="0.4"
            onChange={(e) => {
              const nextValue = e.target.value.trim();
              onChange({
                use_scene_transition: false,
                transition: nextValue ? Math.max(0, Number(nextValue)) : 0,
              });
            }}
          />
          {fixedHelpText ? <span className="label-text-alt mt-1 opacity-60">{fixedHelpText}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

interface ActivateSceneEditorProps {
  action: ActivateSceneAction;
  scenes: { id: string; name: string }[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  onChange: (action: ActivateSceneAction) => void;
}

function ActivateSceneEditor({
  action,
  scenes,
  devices,
  groups,
  onChange,
}: ActivateSceneEditorProps) {
  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Scene</span>
        </label>
        <MirrorFromGroupField
          scene_id={action.scene_id}
          mirror_from_group={action.mirror_from_group}
          groups={groups}
          scenes={scenes}
          onChange={(update) => onChange({ ...action, ...update })}
        />
      </div>

      <TargetFiltersEditor
        value={action}
        devices={devices}
        groups={groups}
        onChange={(fields) => onChange({ ...action, ...fields })}
      />

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={action.include_source_groups ?? false}
            onChange={(e) =>
              onChange({
                ...action,
                include_source_groups: e.target.checked || undefined,
              })
            }
          />
          <span className="label-text">
            Also include groups that contain the triggering device
          </span>
        </label>
      </div>

      <TransitionBehaviorEditor
        value={action}
        label="Transition Behavior"
        sceneHelpText="Preserve transition values resolved from the scene, including scene links and device links."
        fixedHelpText="Force the same transition for every affected device."
        onChange={(fields) => onChange({ ...action, ...fields })}
      />

      <RolloutEditor
        value={action}
        devices={devices}
        onChange={(fields) => onChange({ ...action, ...fields })}
      />
    </div>
  );
}

interface CycleScenesEditorProps {
  action: CycleScenesAction;
  scenes: { id: string; name: string }[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  onChange: (action: CycleScenesAction) => void;
}

type CycleSceneConfig = CycleScenesAction['scenes'][number];

function CycleScenesEditor({
  action,
  scenes,
  devices,
  groups,
  onChange,
}: CycleScenesEditorProps) {
  const handleAddScene = () => {
    onChange({
      ...action,
      scenes: [...action.scenes, { scene_id: '' }],
    });
  };

  const handleRemoveScene = (index: number) => {
    onChange({
      ...action,
      scenes: action.scenes.filter((_, i) => i !== index),
    });
  };

  const handleSceneFieldChange = (
    index: number,
    update: Partial<CycleSceneConfig>,
  ) => {
    onChange({
      ...action,
      scenes: action.scenes.map((scene, sceneIndex) =>
        sceneIndex === index ? { ...scene, ...update } : scene,
      ),
    });
  };

  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Scenes (in order)</span>
        </label>
        <div className="space-y-3">
          {action.scenes.map((s, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-base-300 p-2"
            >
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm opacity-60 w-6">{index + 1}.</span>
                <MirrorFromGroupField
                  scene_id={s.scene_id}
                  mirror_from_group={s.mirror_from_group}
                  groups={groups}
                  scenes={scenes}
                  onChange={(update) => handleSceneFieldChange(index, update)}
                />
                <button
                  className="btn btn-ghost btn-xs btn-error ml-auto"
                  onClick={() => handleRemoveScene(index)}
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="select select-bordered select-sm w-48"
                  value={getTransitionBehaviorMode(s)}
                  onChange={(event) =>
                    handleSceneFieldChange(
                      index,
                      getTransitionBehaviorUpdate(
                        event.target.value as TransitionBehaviorMode,
                      ),
                    )
                  }
                >
                  <option value="none">No transition</option>
                  <option value="scene">Use scene transitions</option>
                  <option value="fixed">Fixed transition</option>
                </select>
                {getTransitionBehaviorMode(s) === 'fixed' ? (
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input input-bordered input-sm w-36"
                    value={s.transition ?? ''}
                    placeholder="0.4s"
                    onChange={(event) => {
                      const nextValue = event.target.value.trim();
                      handleSceneFieldChange(index, {
                        use_scene_transition: false,
                        transition: nextValue
                          ? Math.max(0, Number(nextValue))
                          : 0,
                      });
                    }}
                  />
                ) : null}
              </div>

              <div className="rounded-lg border border-base-300 p-3">
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">
                  Scene Filters
                </div>
                <div className="mt-2 space-y-3">
                  <TargetFiltersEditor
                    resetKey={index}
                    value={s}
                    devices={devices}
                    groups={groups}
                    onChange={(fields) => handleSceneFieldChange(index, fields)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn btn-sm btn-outline mt-2"
          onClick={handleAddScene}
        >
          + Add Scene
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-base-300 p-3">
        <div className="text-sm opacity-70">
          Use these filters to choose which devices and groups are considered
          when determining the current scene before cycling.
        </div>
        <TargetFiltersEditor
          value={action}
          devices={devices}
          groups={groups}
          onChange={(fields) => onChange({ ...action, ...fields })}
        />
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={action.nowrap || false}
            onChange={(e) =>
              onChange({
                ...action,
                nowrap: e.target.checked || undefined,
              })
            }
          />
          <span className="label-text">
            Don't wrap (stop at last scene instead of cycling back)
          </span>
        </label>
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={action.include_source_groups ?? false}
            onChange={(e) =>
              onChange({
                ...action,
                include_source_groups: e.target.checked || undefined,
              })
            }
          />
          <span className="label-text">
            Also include groups that contain the triggering device
          </span>
        </label>
      </div>

      <RolloutEditor
        value={action}
        devices={devices}
        onChange={(fields) => onChange({ ...action, ...fields })}
      />
    </div>
  );
}

interface ForceTriggerRoutineEditorProps {
  action: ForceTriggerRoutineAction;
  routines: { id: string; name: string }[];
  onChange: (action: ForceTriggerRoutineAction) => void;
}

function ForceTriggerRoutineEditor({
  action,
  routines,
  onChange,
}: ForceTriggerRoutineEditorProps) {
  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Routine to Trigger</span>
        </label>
        <RoutineSelector
          routines={routines}
          value={action.routine_id}
          onChange={(id) => onChange({ ...action, routine_id: id })}
        />
        <span className="label-text-alt mt-1 opacity-60">
          Force triggers another routine regardless of its rules
        </span>
      </div>
    </div>
  );
}

interface ToggleOverrideEditorProps {
  action: ToggleDeviceOverrideAction;
  devices: DevicesState;
  onChange: (action: ToggleDeviceOverrideAction) => void;
}

function ToggleOverrideEditor({
  action,
  devices,
  onChange,
}: ToggleOverrideEditorProps) {
  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Devices</span>
        </label>
        <DeviceKeysSelector
          devices={devices}
          value={action.device_keys}
          onChange={(keys) => onChange({ ...action, device_keys: keys })}
        />
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={action.override_state}
            onChange={(e) =>
              onChange({ ...action, override_state: e.target.checked })
            }
          />
          <span className="label-text">
            {action.override_state ? 'Enable Override' : 'Disable Override'}
          </span>
        </label>
      </div>
    </div>
  );
}

interface UiActionEditorProps {
  action: UiAction;
  onChange: (action: UiAction) => void;
}

function UiActionEditor({ action, onChange }: UiActionEditorProps) {
  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">State Key</span>
        </label>
        <input
          type="text"
          className="input input-bordered input-sm"
          value={action.state_key}
          onChange={(e) => onChange({ ...action, state_key: e.target.value })}
          placeholder="ui_state_key"
        />
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">State Value (JSON)</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-24 font-mono text-sm"
          value={
            typeof action.state_value === 'string'
              ? action.state_value
              : JSON.stringify(action.state_value, null, 2)
          }
          onChange={(e) => {
            try {
              onChange({
                ...action,
                state_value: JSON.parse(e.target.value),
              });
            } catch {
              onChange({ ...action, state_value: e.target.value });
            }
          }}
        />
      </div>
    </div>
  );
}

interface JsonActionEditorProps {
  action: Action;
  onChange: (action: Action) => void;
}

function JsonActionEditor({ action, onChange }: JsonActionEditorProps) {
  const [json, setJson] = useState(JSON.stringify(action, null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Action JSON</span>
        </label>
        <textarea
          className={`textarea textarea-bordered h-32 font-mono text-sm ${error ? 'textarea-error' : ''}`}
          value={json}
          onChange={(e) => {
            setJson(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value);
              onChange(parsed);
              setError(null);
            } catch (err) {
              setError('Invalid JSON');
            }
          }}
        />
        {error && <span className="label-text-alt text-error">{error}</span>}
      </div>
    </div>
  );
}

interface ActionEditorProps {
  action: Action;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  onChange: (action: Action) => void;
  onRemove: () => void;
}

export function ActionEditor({
  action,
  devices,
  groups,
  scenes,
  routines,
  onChange,
  onRemove,
}: ActionEditorProps) {
  const actionType = getActionType(action);

  const handleTypeChange = (newType: string) => {
    switch (newType) {
      case 'ActivateScene':
        onChange({ action: 'ActivateScene', scene_id: '' });
        break;
      case 'CycleScenes':
        onChange({ action: 'CycleScenes', scenes: [] });
        break;
      case 'ForceTriggerRoutine':
        onChange({ action: 'ForceTriggerRoutine', routine_id: '' });
        break;
      case 'ToggleDeviceOverride':
        onChange({
          action: 'ToggleDeviceOverride',
          device_keys: [],
          override_state: true,
        });
        break;
      case 'Ui':
        onChange({ action: 'Ui', state_key: '', state_value: null });
        break;
      case 'Dim':
        onChange({ action: 'Dim', name: '' });
        break;
      case 'Custom':
        onChange({ action: 'Custom', payload: {} });
        break;
      case 'SetDeviceState':
        onChange({
          action: 'SetDeviceState',
          id: '',
          name: '',
          integration_id: '',
          data: {},
        });
        break;
    }
  };

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4">
        <div className="flex justify-between items-start mb-2">
          <select
            className="select select-bordered select-sm"
            value={actionType}
            onChange={(e) => handleTypeChange(e.target.value)}
          >
            <option value="ActivateScene">Activate Scene</option>
            <option value="CycleScenes">Cycle Scenes</option>
            <option value="ForceTriggerRoutine">Trigger Routine</option>
            <option value="ToggleDeviceOverride">Toggle Override</option>
            <option value="Ui">UI State</option>
            <option value="Dim">Dim</option>
            <option value="SetDeviceState">Set Device State</option>
            <option value="Custom">Custom</option>
          </select>
          <button
            className="btn btn-ghost btn-xs btn-error"
            onClick={onRemove}
          >
            ✕
          </button>
        </div>

        {actionType === 'ActivateScene' && (
          <ActivateSceneEditor
            action={action as ActivateSceneAction}
            scenes={scenes}
            devices={devices}
            groups={groups}
            onChange={onChange}
          />
        )}
        {actionType === 'CycleScenes' && (
          <CycleScenesEditor
            action={action as CycleScenesAction}
            scenes={scenes}
            devices={devices}
            groups={groups}
            onChange={onChange}
          />
        )}
        {actionType === 'ForceTriggerRoutine' && (
          <ForceTriggerRoutineEditor
            action={action as ForceTriggerRoutineAction}
            routines={routines}
            onChange={onChange}
          />
        )}
        {actionType === 'ToggleDeviceOverride' && (
          <ToggleOverrideEditor
            action={action as ToggleDeviceOverrideAction}
            devices={devices}
            onChange={onChange}
          />
        )}
        {actionType === 'Ui' && (
          <UiActionEditor
            action={action as UiAction}
            onChange={onChange}
          />
        )}
        {['Dim', 'SetDeviceState', 'Custom'].includes(actionType) && (
          <JsonActionEditor action={action} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

interface ActionBuilderProps {
  actions: Action[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  onChange: (actions: Action[]) => void;
}

export function ActionBuilder({
  actions,
  devices,
  groups,
  scenes,
  routines,
  onChange,
}: ActionBuilderProps) {
  const handleAddAction = useCallback(() => {
    onChange([...actions, { action: 'ActivateScene', scene_id: '' }]);
  }, [actions, onChange]);

  const handleActionChange = useCallback(
    (index: number, newAction: Action) => {
      const updated = [...actions];
      updated[index] = newAction;
      onChange(updated);
    },
    [actions, onChange],
  );

  const handleRemoveAction = useCallback(
    (index: number) => {
      onChange(actions.filter((_, i) => i !== index));
    },
    [actions, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">Actions</h4>
        <button className="btn btn-sm btn-primary" onClick={handleAddAction}>
          Add Action
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="text-center py-4 opacity-60">
          No actions configured. Add an action to define what happens when this
          routine triggers.
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((action, index) => (
            <ActionEditor
              key={index}
              action={action}
              devices={devices}
              groups={groups}
              scenes={scenes}
              routines={routines}
              onChange={(a) => handleActionChange(index, a)}
              onRemove={() => handleRemoveAction(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ActionBuilder;
