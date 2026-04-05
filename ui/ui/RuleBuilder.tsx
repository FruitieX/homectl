'use client';

import { useState, useCallback } from 'react';
import { TriggerMode } from '@/bindings/TriggerMode';
import { SceneId } from '@/bindings/SceneId';
import { GroupId } from '@/bindings/GroupId';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';

// Rule types (matching server types, without ts-rs export issues)
export interface SensorRule {
  state: SensorState;
  trigger_mode: TriggerMode;
  integration_id?: string;
  name?: string;
  id?: string;
}

export interface DeviceRule {
  power?: boolean;
  scene?: SceneId;
  trigger_mode: TriggerMode;
  integration_id?: string;
  name?: string;
  id?: string;
}

export interface GroupRule {
  group_id: GroupId;
  power?: boolean;
  scene?: SceneId;
  trigger_mode: TriggerMode;
}

export interface AnyRule {
  any: Rule[];
}

export interface ScriptRule {
  script: string;
}

export type SensorState =
  | { value: boolean }
  | { value: string }
  | { value: number }
  | { power?: boolean; brightness?: number };

export type Rule =
  | SensorRule
  | DeviceRule
  | GroupRule
  | AnyRule
  | ScriptRule;

// Helper to detect rule type
function getRuleType(
  rule: Rule,
): 'sensor' | 'device' | 'group' | 'any' | 'script' | 'unknown' {
  if ('script' in rule) return 'script';
  if ('any' in rule) return 'any';
  if ('group_id' in rule) return 'group';
  if ('state' in rule) return 'sensor';
  if ('power' in rule || 'scene' in rule) return 'device';
  return 'unknown';
}

interface TriggerModeSelectorProps {
  value: TriggerMode;
  onChange: (mode: TriggerMode) => void;
}

function TriggerModeSelector({ value, onChange }: TriggerModeSelectorProps) {
  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text">Trigger Mode</span>
      </label>
      <select
        className="select select-bordered select-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as TriggerMode)}
      >
        <option value="pulse">Pulse (every update)</option>
        <option value="edge">Edge (on change to match)</option>
        <option value="level">Level (while matching)</option>
      </select>
      <span className="label-text-alt mt-1 opacity-60">
        {value === 'pulse' && 'Triggers on every matching state update'}
        {value === 'edge' &&
          'Triggers only when state changes from non-matching to matching'}
        {value === 'level' &&
          "Triggers when state transitions to matching (won't re-trigger)"}
      </span>
    </div>
  );
}

interface DeviceSelectorProps {
  devices: DevicesState;
  integrationId?: string;
  deviceName?: string;
  deviceId?: string;
  onChange: (ref: {
    integration_id?: string;
    name?: string;
    id?: string;
  }) => void;
}

function DeviceSelector({
  devices,
  integrationId,
  deviceName,
  deviceId,
  onChange,
}: DeviceSelectorProps) {
  const deviceList = Object.entries(devices).map(([key, device]) => ({
    key,
    device: device as Device,
  }));

  const currentValue =
    integrationId && (deviceName ?? deviceId)
      ? `${integrationId}/${deviceName ?? deviceId}`
      : '';

  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text">Device</span>
      </label>
      <select
        className="select select-bordered select-sm"
        value={currentValue}
        onChange={(e) => {
          const [intId, ...nameParts] = e.target.value.split('/');
          const name = nameParts.join('/');
          onChange({ integration_id: intId, name });
        }}
      >
        <option value="">Select device...</option>
        {deviceList.map(({ key, device }) => (
          <option key={key} value={key}>
            {device.name} ({key})
          </option>
        ))}
      </select>
    </div>
  );
}

interface GroupSelectorProps {
  groups: FlattenedGroupsConfig;
  value: GroupId;
  onChange: (groupId: GroupId) => void;
}

function GroupSelector({ groups, value, onChange }: GroupSelectorProps) {
  const groupList = Object.entries(groups);

  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text">Group</span>
      </label>
      <select
        className="select select-bordered select-sm"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select group...</option>
        {groupList.map(([id, group]) => (
          <option key={id} value={id}>
            {group?.name ?? id}
          </option>
        ))}
      </select>
    </div>
  );
}

interface SensorRuleEditorProps {
  rule: SensorRule;
  devices: DevicesState;
  onChange: (rule: SensorRule) => void;
}

function SensorRuleEditor({
  rule,
  devices,
  onChange,
}: SensorRuleEditorProps) {
  const stateType =
    'value' in rule.state
      ? typeof rule.state.value === 'boolean'
        ? 'boolean'
        : typeof rule.state.value === 'number'
          ? 'number'
          : 'string'
      : 'device';

  return (
    <div className="space-y-3">
      <DeviceSelector
        devices={devices}
        integrationId={rule.integration_id}
        deviceName={rule.name}
        deviceId={rule.id}
        onChange={(ref) => onChange({ ...rule, ...ref })}
      />

      <div className="form-control">
        <label className="label">
          <span className="label-text">State Type</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={stateType}
          onChange={(e) => {
            const type = e.target.value;
            if (type === 'boolean') {
              onChange({ ...rule, state: { value: true } });
            } else if (type === 'number') {
              onChange({ ...rule, state: { value: 0 } });
            } else if (type === 'string') {
              onChange({ ...rule, state: { value: '' } });
            } else {
              onChange({ ...rule, state: { power: true } });
            }
          }}
        >
          <option value="boolean">Boolean (on/off)</option>
          <option value="number">Number</option>
          <option value="string">String</option>
          <option value="device">Device State</option>
        </select>
      </div>

      {'value' in rule.state && typeof rule.state.value === 'boolean' && (
        <div className="form-control">
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={rule.state.value}
              onChange={(e) =>
                onChange({ ...rule, state: { value: e.target.checked } })
              }
            />
            <span className="label-text">
              {rule.state.value ? 'On / True' : 'Off / False'}
            </span>
          </label>
        </div>
      )}

      {'value' in rule.state && typeof rule.state.value === 'number' && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">Value</span>
          </label>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={rule.state.value}
            onChange={(e) =>
              onChange({ ...rule, state: { value: Number(e.target.value) } })
            }
          />
        </div>
      )}

      {'value' in rule.state && typeof rule.state.value === 'string' && (
        <div className="form-control">
          <label className="label">
            <span className="label-text">Value</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={rule.state.value}
            onChange={(e) =>
              onChange({ ...rule, state: { value: e.target.value } })
            }
          />
        </div>
      )}

      <TriggerModeSelector
        value={rule.trigger_mode}
        onChange={(mode) => onChange({ ...rule, trigger_mode: mode })}
      />
    </div>
  );
}

interface DeviceRuleEditorProps {
  rule: DeviceRule;
  devices: DevicesState;
  scenes: { id: string; name: string }[];
  onChange: (rule: DeviceRule) => void;
}

function DeviceRuleEditor({
  rule,
  devices,
  scenes,
  onChange,
}: DeviceRuleEditorProps) {
  return (
    <div className="space-y-3">
      <DeviceSelector
        devices={devices}
        integrationId={rule.integration_id}
        deviceName={rule.name}
        deviceId={rule.id}
        onChange={(ref) => onChange({ ...rule, ...ref })}
      />

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={rule.power !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                power: e.target.checked ? true : undefined,
              })
            }
          />
          <span className="label-text">Match Power State</span>
        </label>
        {rule.power !== undefined && (
          <div className="ml-8">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={rule.power}
                onChange={(e) =>
                  onChange({ ...rule, power: e.target.checked })
                }
              />
              <span className="label-text">
                {rule.power ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={rule.scene !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                scene: e.target.checked ? '' : undefined,
              })
            }
          />
          <span className="label-text">Match Scene</span>
        </label>
        {rule.scene !== undefined && (
          <div className="ml-8 mt-1">
            <select
              className="select select-bordered select-sm"
              value={rule.scene || ''}
              onChange={(e) =>
                onChange({ ...rule, scene: e.target.value || undefined })
              }
            >
              <option value="">Select scene...</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <TriggerModeSelector
        value={rule.trigger_mode}
        onChange={(mode) => onChange({ ...rule, trigger_mode: mode })}
      />
    </div>
  );
}

interface GroupRuleEditorProps {
  rule: GroupRule;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  onChange: (rule: GroupRule) => void;
}

function GroupRuleEditor({
  rule,
  groups,
  scenes,
  onChange,
}: GroupRuleEditorProps) {
  return (
    <div className="space-y-3">
      <GroupSelector
        groups={groups}
        value={rule.group_id}
        onChange={(groupId) => onChange({ ...rule, group_id: groupId })}
      />

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={rule.power !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                power: e.target.checked ? true : undefined,
              })
            }
          />
          <span className="label-text">Match Power State</span>
        </label>
        {rule.power !== undefined && (
          <div className="ml-8">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={rule.power}
                onChange={(e) =>
                  onChange({ ...rule, power: e.target.checked })
                }
              />
              <span className="label-text">
                {rule.power ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={rule.scene !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                scene: e.target.checked ? '' : undefined,
              })
            }
          />
          <span className="label-text">Match Scene</span>
        </label>
        {rule.scene !== undefined && (
          <div className="ml-8 mt-1">
            <select
              className="select select-bordered select-sm"
              value={rule.scene || ''}
              onChange={(e) =>
                onChange({ ...rule, scene: e.target.value || undefined })
              }
            >
              <option value="">Select scene...</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <TriggerModeSelector
        value={rule.trigger_mode}
        onChange={(mode) => onChange({ ...rule, trigger_mode: mode })}
      />
    </div>
  );
}

interface ScriptRuleEditorProps {
  rule: ScriptRule;
  onChange: (rule: ScriptRule) => void;
}

function ScriptRuleEditor({ rule, onChange }: ScriptRuleEditorProps) {
  return (
    <div className="space-y-3">
      <div className="form-control">
        <label className="label">
          <span className="label-text">JavaScript Code</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-32 font-mono text-sm"
          value={rule.script}
          onChange={(e) => onChange({ ...rule, script: e.target.value })}
          placeholder={`// Return true to trigger the routine
// Available: devices, groups

const sensor = devices["zigbee/motion-sensor"];
return sensor?.data?.OnOffSensor?.value === true;`}
        />
        <span className="label-text-alt mt-1 opacity-60">
          Script should return a boolean. Available globals: devices, groups
        </span>
      </div>
    </div>
  );
}

interface RuleEditorProps {
  rule: Rule;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  onChange: (rule: Rule) => void;
  onRemove: () => void;
  depth?: number;
}

export function RuleEditor({
  rule,
  devices,
  groups,
  scenes,
  onChange,
  onRemove,
  depth = 0,
}: RuleEditorProps) {
  const ruleType = getRuleType(rule);

  const handleTypeChange = (
    newType: 'sensor' | 'device' | 'group' | 'any' | 'script',
  ) => {
    if (newType === 'sensor') {
      onChange({
        state: { value: true },
        trigger_mode: 'pulse',
      } as SensorRule);
    } else if (newType === 'device') {
      onChange({
        power: true,
        trigger_mode: 'level',
      } as DeviceRule);
    } else if (newType === 'group') {
      onChange({
        group_id: '',
        power: true,
        trigger_mode: 'level',
      } as GroupRule);
    } else if (newType === 'any') {
      onChange({ any: [] } as AnyRule);
    } else if (newType === 'script') {
      onChange({
        script: '// Return true to trigger\nreturn true;',
      } as ScriptRule);
    }
  };

  return (
    <div className={`card bg-base-${depth > 0 ? '300' : '200'} ${depth > 0 ? 'p-3' : ''}`}>
      <div className={depth > 0 ? '' : 'card-body p-4'}>
        <div className="flex justify-between items-start mb-2">
          <select
            className="select select-bordered select-sm"
            value={ruleType}
            onChange={(e) =>
              handleTypeChange(
                e.target.value as 'sensor' | 'device' | 'group' | 'any' | 'script',
              )
            }
          >
            <option value="sensor">Sensor Rule</option>
            <option value="device">Device Rule</option>
            <option value="group">Group Rule</option>
            <option value="any">Any (OR)</option>
            <option value="script">Script Rule</option>
          </select>
          <button
            className="btn btn-ghost btn-xs btn-error"
            onClick={onRemove}
          >
            ✕
          </button>
        </div>

        {ruleType === 'sensor' && (
          <SensorRuleEditor
            rule={rule as SensorRule}
            devices={devices}
            onChange={onChange}
          />
        )}
        {ruleType === 'device' && (
          <DeviceRuleEditor
            rule={rule as DeviceRule}
            devices={devices}
            scenes={scenes}
            onChange={onChange}
          />
        )}
        {ruleType === 'group' && (
          <GroupRuleEditor
            rule={rule as GroupRule}
            groups={groups}
            scenes={scenes}
            onChange={onChange}
          />
        )}
        {ruleType === 'any' && depth < 2 && (
          <AnyRuleEditor
            rule={rule as AnyRule}
            devices={devices}
            groups={groups}
            scenes={scenes}
            onChange={onChange}
            depth={depth}
          />
        )}
        {ruleType === 'script' && (
          <ScriptRuleEditor
            rule={rule as ScriptRule}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
}

interface AnyRuleEditorProps {
  rule: AnyRule;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  onChange: (rule: AnyRule) => void;
  depth: number;
}

function AnyRuleEditor({
  rule,
  devices,
  groups,
  scenes,
  onChange,
  depth,
}: AnyRuleEditorProps) {
  const handleAddRule = () => {
    onChange({
      ...rule,
      any: [...rule.any, { state: { value: true }, trigger_mode: 'pulse' }],
    });
  };

  const handleRuleChange = (index: number, newRule: Rule) => {
    const updated = [...rule.any];
    updated[index] = newRule;
    onChange({ ...rule, any: updated });
  };

  const handleRemoveRule = (index: number) => {
    onChange({ ...rule, any: rule.any.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm opacity-70">
        Any of these rules matching will trigger the routine:
      </p>
      <div className="space-y-2">
        {rule.any.map((subRule, index) => (
          <RuleEditor
            key={index}
            rule={subRule}
            devices={devices}
            groups={groups}
            scenes={scenes}
            onChange={(r) => handleRuleChange(index, r)}
            onRemove={() => handleRemoveRule(index)}
            depth={depth + 1}
          />
        ))}
      </div>
      <button className="btn btn-sm btn-outline" onClick={handleAddRule}>
        + Add OR Rule
      </button>
    </div>
  );
}

interface RuleBuilderProps {
  rules: Rule[];
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: { id: string; name: string }[];
  onChange: (rules: Rule[]) => void;
}

export function RuleBuilder({
  rules,
  devices,
  groups,
  scenes,
  onChange,
}: RuleBuilderProps) {
  const handleAddRule = useCallback(() => {
    onChange([
      ...rules,
      { state: { value: true }, trigger_mode: 'pulse' } as SensorRule,
    ]);
  }, [rules, onChange]);

  const handleRuleChange = useCallback(
    (index: number, newRule: Rule) => {
      const updated = [...rules];
      updated[index] = newRule;
      onChange(updated);
    },
    [rules, onChange],
  );

  const handleRemoveRule = useCallback(
    (index: number) => {
      onChange(rules.filter((_, i) => i !== index));
    },
    [rules, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">
          Rules <span className="opacity-60">(all must match)</span>
        </h4>
        <button className="btn btn-sm btn-primary" onClick={handleAddRule}>
          Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-4 opacity-60">
          No rules configured. Add a rule to define when this routine triggers.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <RuleEditor
              key={index}
              rule={rule}
              devices={devices}
              groups={groups}
              scenes={scenes}
              onChange={(r) => handleRuleChange(index, r)}
              onRemove={() => handleRemoveRule(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default RuleBuilder;
