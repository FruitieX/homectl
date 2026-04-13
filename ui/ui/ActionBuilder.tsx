'use client';

import { useState, useCallback } from 'react';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { Device } from '@/bindings/Device';
import type { RolloutStyle } from '@/bindings/RolloutStyle';

const rolloutStyleOptions: RolloutStyle[] = ['spatial'];

// Action types matching server types
export interface ActivateSceneAction {
  action: 'ActivateScene';
  scene_id: string;
  device_keys?: string[];
  group_keys?: string[];
  rollout?: string;
  rollout_source_device_key?: string;
  rollout_duration_ms?: number;
}

export interface CycleScenesAction {
  action: 'CycleScenes';
  scenes: { scene_id: string; device_keys?: string[]; group_keys?: string[] }[];
  nowrap?: boolean;
  device_keys?: string[];
  group_keys?: string[];
  rollout?: string;
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
}

function GroupKeysSelector({
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

interface RolloutEditorFields {
  rollout?: string;
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
            const nextRollout = e.target.value.trim();
            onChange({
              rollout: nextRollout || undefined,
              rollout_source_device_key: nextRollout
                ? value.rollout_source_device_key
                : undefined,
              rollout_duration_ms: nextRollout
                ? value.rollout_duration_ms
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
              {deviceList.map(({ key, device }) => (
                <option key={key} value={key}>
                  {device.name} ({key})
                </option>
              ))}
            </select>
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Rollout Duration (ms)</span>
            </label>
            <input
              type="number"
              min="0"
              step="100"
              className="input input-bordered input-sm"
              value={value.rollout_duration_ms ?? ''}
              placeholder="1500"
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
        </>
      )}
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
  const [showDeviceFilter, setShowDeviceFilter] = useState(
    !!action.device_keys?.length,
  );
  const [showGroupFilter, setShowGroupFilter] = useState(
    !!action.group_keys?.length,
  );

  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Scene</span>
        </label>
        <SceneSelector
          scenes={scenes}
          value={action.scene_id}
          onChange={(id) => onChange({ ...action, scene_id: id })}
        />
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={showDeviceFilter}
            onChange={(e) => {
              setShowDeviceFilter(e.target.checked);
              if (!e.target.checked) {
                onChange({ ...action, device_keys: undefined });
              }
            }}
          />
          <span className="label-text">Filter by Devices</span>
        </label>
        {showDeviceFilter && (
          <DeviceKeysSelector
            devices={devices}
            value={action.device_keys || []}
            onChange={(keys) =>
              onChange({
                ...action,
                device_keys: keys.length ? keys : undefined,
              })
            }
          />
        )}
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={showGroupFilter}
            onChange={(e) => {
              setShowGroupFilter(e.target.checked);
              if (!e.target.checked) {
                onChange({ ...action, group_keys: undefined });
              }
            }}
          />
          <span className="label-text">Filter by Groups</span>
        </label>
        {showGroupFilter && (
          <GroupKeysSelector
            groups={groups}
            value={action.group_keys || []}
            onChange={(keys) =>
              onChange({
                ...action,
                group_keys: keys.length ? keys : undefined,
              })
            }
          />
        )}
      </div>

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
  onChange: (action: CycleScenesAction) => void;
}

function CycleScenesEditor({
  action,
  scenes,
  devices,
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

  const handleSceneChange = (index: number, sceneId: string) => {
    const updated = [...action.scenes];
    updated[index] = { ...updated[index], scene_id: sceneId };
    onChange({ ...action, scenes: updated });
  };

  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Scenes (in order)</span>
        </label>
        <div className="space-y-2">
          {action.scenes.map((s, index) => (
            <div key={index} className="flex gap-2 items-center">
              <span className="text-sm opacity-60 w-6">{index + 1}.</span>
              <SceneSelector
                scenes={scenes}
                value={s.scene_id}
                onChange={(id) => handleSceneChange(index, id)}
              />
              <button
                className="btn btn-ghost btn-xs btn-error"
                onClick={() => handleRemoveScene(index)}
              >
                ✕
              </button>
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
