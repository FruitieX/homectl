import { cn } from '@/lib/cn';
import { extractJsonPointers, resolveJsonPointer } from '../utils/jsonPointers';
import { useState, useCallback } from 'react';
import { TriggerMode } from '@/bindings/TriggerMode';
import { SceneId } from '@/bindings/SceneId';
import { GroupId } from '@/bindings/GroupId';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { ConfigField } from '@/ui/config-form';
import {
  DeviceSelect,
  GroupSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const fieldClassName = 'space-y-2';
const fieldLabelClassName = 'text-sm font-medium';
const helpTextClassName = 'text-xs text-muted-foreground';

// Rule types (matching server types, without ts-rs export issues)
export interface SensorRule {
  state: SensorState;
  trigger_mode: TriggerMode;
  integration_id?: string;
  device_id?: string;
}

export interface DeviceRule {
  power?: boolean;
  scene?: SceneId;
  trigger_mode: TriggerMode;
  integration_id?: string;
  device_id?: string;
}

export type RawRuleOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'exists'
  | 'truthy'
  | 'regex';

export interface RawRule {
  path: string;
  operator: RawRuleOperator;
  value?: unknown;
  trigger_mode: TriggerMode;
  integration_id?: string;
  device_id?: string;
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
  | RawRule
  | DeviceRule
  | GroupRule
  | AnyRule
  | ScriptRule;

const rawRuleOperatorOptions: Array<{
  value: RawRuleOperator;
  label: string;
}> = [
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'exists', label: 'Exists' },
  { value: 'truthy', label: 'Truthy' },
  { value: 'regex', label: 'Regex match' },
];

const rawRuleOperatorsWithoutValue = new Set<RawRuleOperator>([
  'exists',
  'truthy',
]);

const rawStringOperators = new Set<RawRuleOperator>([
  'contains',
  'starts_with',
  'regex',
]);

const rawNumericOperators = new Set<RawRuleOperator>([
  'gt',
  'gte',
  'lt',
  'lte',
]);

function getDeviceByRef(
  devices: DevicesState,
  integrationId?: string,
  deviceId?: string,
) {
  if (!integrationId || !deviceId) {
    return undefined;
  }

  return devices[`${integrationId}/${deviceId}`];
}

function getDeviceKeyFromRef(integrationId?: string, deviceId?: string) {
  return integrationId && deviceId ? `${integrationId}/${deviceId}` : '';
}

function getDeviceRefUpdate(deviceKey: string) {
  return (
    splitDeviceKey(deviceKey) ?? {
      integration_id: undefined,
      device_id: undefined,
    }
  );
}

function formatRawPreviewValue(value: unknown) {
  if (value === undefined) {
    return 'No value found at this path.';
  }

  if (typeof value === 'string') {
    return `"${value}"`;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

type RawPreviewState =
  | { kind: 'no-device' }
  | { kind: 'no-raw' }
  | { kind: 'empty-path'; value: unknown }
  | { kind: 'missing-path' }
  | { kind: 'resolved'; value: unknown };

function describeRawPreview(
  selectedDevice: Device | undefined,
  rawPayload: unknown,
  path: string,
  resolved: unknown,
): RawPreviewState {
  if (!selectedDevice) {
    return { kind: 'no-device' };
  }

  if (rawPayload === null || rawPayload === undefined) {
    return { kind: 'no-raw' };
  }

  if (!path) {
    return { kind: 'empty-path', value: rawPayload };
  }

  if (resolved === undefined) {
    return { kind: 'missing-path' };
  }

  return { kind: 'resolved', value: resolved };
}

function getRawRuleValueEditorKind(rule: RawRule, previewValue: unknown) {
  if (rawRuleOperatorsWithoutValue.has(rule.operator)) {
    return 'hidden' as const;
  }

  if (rawNumericOperators.has(rule.operator)) {
    return 'number' as const;
  }

  if (rawStringOperators.has(rule.operator)) {
    return 'string' as const;
  }

  const candidate = rule.value ?? previewValue;

  if (typeof candidate === 'boolean') {
    return 'boolean' as const;
  }

  if (typeof candidate === 'number') {
    return 'number' as const;
  }

  if (typeof candidate === 'string') {
    return 'string' as const;
  }

  return 'unsupported' as const;
}

function getDefaultRawRuleValue(
  operator: RawRuleOperator,
  previewValue: unknown,
  currentValue: unknown,
) {
  if (rawRuleOperatorsWithoutValue.has(operator)) {
    return undefined;
  }

  if (rawNumericOperators.has(operator)) {
    return typeof currentValue === 'number'
      ? currentValue
      : typeof previewValue === 'number'
        ? previewValue
        : 0;
  }

  if (rawStringOperators.has(operator)) {
    return typeof currentValue === 'string'
      ? currentValue
      : typeof previewValue === 'string'
        ? previewValue
        : '';
  }

  if (
    typeof currentValue === 'boolean' ||
    typeof currentValue === 'number' ||
    typeof currentValue === 'string'
  ) {
    return currentValue;
  }

  if (
    typeof previewValue === 'boolean' ||
    typeof previewValue === 'number' ||
    typeof previewValue === 'string'
  ) {
    return previewValue;
  }

  return '';
}

// Helper to detect rule type
export function getRuleType(
  rule: Rule,
): 'sensor' | 'raw' | 'device' | 'group' | 'any' | 'script' | 'unknown' {
  if ('script' in rule) return 'script';
  if ('any' in rule) return 'any';
  if ('group_id' in rule) return 'group';
  if ('path' in rule && 'operator' in rule) return 'raw';
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
    <div className={fieldClassName}>
      <label>
        <span className={fieldLabelClassName}>Trigger Mode</span>
      </label>
      <select
        className={selectClassName}
        value={value}
        onChange={(e) => onChange(e.target.value as TriggerMode)}
      >
        <option value="pulse">Pulse (every update)</option>
        <option value="edge">Edge (on change to match)</option>
        <option value="level">Level (while matching)</option>
      </select>
      <span className={helpTextClassName}>
        {value === 'pulse' && 'Triggers on every matching state update'}
        {value === 'edge' &&
          'Triggers only when state changes from non-matching to matching'}
        {value === 'level' &&
          "Triggers when state transitions to matching (won't re-trigger)"}
      </span>
    </div>
  );
}

interface SensorRuleEditorProps {
  rule: SensorRule;
  devices: DevicesState;
  onChange: (rule: SensorRule) => void;
}

function SensorRuleEditor({ rule, devices, onChange }: SensorRuleEditorProps) {
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
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Device</span>
        </label>
        <DeviceSelect
          devices={devices}
          value={getDeviceKeyFromRef(rule.integration_id, rule.device_id)}
          onChange={(deviceKey) =>
            onChange({ ...rule, ...getDeviceRefUpdate(deviceKey) })
          }
        />
      </div>

      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>State Type</span>
        </label>
        <select
          className={selectClassName}
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
        <div className={fieldClassName}>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={rule.state.value}
              onChange={(e) =>
                onChange({ ...rule, state: { value: e.target.checked } })
              }
            />
            <span className={fieldLabelClassName}>
              {rule.state.value ? 'On / True' : 'Off / False'}
            </span>
          </label>
        </div>
      )}

      {'value' in rule.state && typeof rule.state.value === 'number' && (
        <div className={fieldClassName}>
          <label>
            <span className={fieldLabelClassName}>Value</span>
          </label>
          <Input
            type="number"
            className="h-9"
            value={rule.state.value}
            onChange={(e) =>
              onChange({ ...rule, state: { value: Number(e.target.value) } })
            }
          />
        </div>
      )}

      {'value' in rule.state && typeof rule.state.value === 'string' && (
        <div className={fieldClassName}>
          <label>
            <span className={fieldLabelClassName}>Value</span>
          </label>
          <Input
            type="text"
            className="h-9"
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

interface RawRuleEditorProps {
  rule: RawRule;
  devices: DevicesState;
  onChange: (rule: RawRule) => void;
}

function DeviceRuleEditor({
  rule,
  devices,
  scenes,
  onChange,
}: DeviceRuleEditorProps) {
  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Device</span>
        </label>
        <DeviceSelect
          devices={devices}
          value={getDeviceKeyFromRef(rule.integration_id, rule.device_id)}
          onChange={(deviceKey) =>
            onChange({ ...rule, ...getDeviceRefUpdate(deviceKey) })
          }
        />
      </div>

      <div className={fieldClassName}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={rule.power !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                power: e.target.checked ? true : undefined,
              })
            }
          />
          <span className={fieldLabelClassName}>Match Power State</span>
        </label>
        {rule.power !== undefined && (
          <div className="ml-8">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={rule.power}
                onChange={(e) => onChange({ ...rule, power: e.target.checked })}
              />
              <span className={fieldLabelClassName}>
                {rule.power ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}
      </div>

      <div className={fieldClassName}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={rule.scene !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                scene: e.target.checked ? '' : undefined,
              })
            }
          />
          <span className={fieldLabelClassName}>Match Scene</span>
        </label>
        {rule.scene !== undefined && (
          <div className="ml-8 mt-1">
            <select
              className={selectClassName}
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

function RawRuleEditor({ rule, devices, onChange }: RawRuleEditorProps) {
  const selectedDevice = getDeviceByRef(
    devices,
    rule.integration_id,
    rule.device_id,
  );
  const rawPayload = selectedDevice?.raw ?? null;
  const availablePaths = rawPayload ? extractJsonPointers(rawPayload) : [];
  const previewValue = rawPayload
    ? resolveJsonPointer(rawPayload, rule.path)
    : undefined;
  const previewState = describeRawPreview(
    selectedDevice,
    rawPayload,
    rule.path,
    previewValue,
  );
  const valueEditorKind = getRawRuleValueEditorKind(rule, previewValue);
  const datalistId = `raw-rule-paths-${rule.integration_id ?? 'none'}-${
    rule.device_id ?? 'none'
  }`
    .replaceAll('/', '-')
    .replaceAll(' ', '-');

  const setPath = (nextPath: string) => {
    const nextPreviewValue = rawPayload
      ? resolveJsonPointer(rawPayload, nextPath)
      : undefined;

    onChange({
      ...rule,
      path: nextPath,
      value: getDefaultRawRuleValue(
        rule.operator,
        nextPreviewValue,
        rule.value,
      ),
    });
  };

  const previewBorderClass =
    previewState.kind === 'resolved'
      ? 'border-emerald-500/40'
      : previewState.kind === 'empty-path'
        ? 'border-sky-500/40'
        : previewState.kind === 'missing-path'
          ? 'border-amber-500/40'
          : 'border-border';

  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Device</span>
        </label>
        <DeviceSelect
          devices={devices}
          value={getDeviceKeyFromRef(rule.integration_id, rule.device_id)}
          onChange={(deviceKey) =>
            onChange({ ...rule, ...getDeviceRefUpdate(deviceKey) })
          }
        />
      </div>

      {selectedDevice && rawPayload !== null && (
        <details className="rounded-2xl border border-border bg-muted/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live raw payload ({availablePaths.length} fields)
          </summary>
          <pre className="max-h-60 overflow-auto border-t border-border bg-background px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(rawPayload, null, 2)}
          </pre>
        </details>
      )}

      <div className={fieldClassName}>
        <label className="flex flex-wrap items-center justify-between gap-2">
          <span className={fieldLabelClassName}>JSON Pointer path</span>
          <span className={helpTextClassName}>
            {!selectedDevice
              ? 'Select a device first'
              : availablePaths.length > 0
                ? `${availablePaths.length} discovered fields`
                : 'No raw payload fields to discover'}
          </span>
        </label>
        <Input
          type="text"
          list={availablePaths.length > 0 ? datalistId : undefined}
          className="h-9 font-mono"
          placeholder="/payload/temperature"
          value={rule.path}
          onChange={(e) => setPath(e.target.value)}
        />
        {availablePaths.length > 0 && (
          <datalist id={datalistId}>
            {availablePaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        )}
        <span className={helpTextClassName}>
          Use{' '}
          <a
            href="https://datatracker.ietf.org/doc/html/rfc6901"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            JSON Pointer
          </a>{' '}
          syntax (e.g. <code className="font-mono">/payload/on</code>). Leave
          empty to match against the whole payload.
        </span>
      </div>

      {availablePaths.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {availablePaths.slice(0, 40).map((path) => {
            const tokens = path.split('/').slice(1);
            const resolved = resolveJsonPointer(rawPayload, path);
            const isActive = path === rule.path;
            return (
              <button
                key={path}
                type="button"
                onClick={() => setPath(path)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs transition-colors',
                  isActive
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-accent hover:text-accent-foreground',
                )}
                title={`${path} = ${formatRawPreviewValue(resolved)}`}
              >
                {tokens.join('/') || '/'}
              </button>
            );
          })}
          {availablePaths.length > 40 && (
            <span className="self-center text-xs text-muted-foreground">
              +{availablePaths.length - 40} more…
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl border bg-muted/40 px-3 py-2',
          previewBorderClass,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current value preview
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            live
          </span>
        </div>
        {previewState.kind === 'no-device' && (
          <div className="mt-2 text-sm text-muted-foreground">
            Select a device to see its live raw payload.
          </div>
        )}
        {previewState.kind === 'no-raw' && (
          <div className="mt-2 text-sm text-muted-foreground">
            This device has not published a raw payload yet.
          </div>
        )}
        {previewState.kind === 'missing-path' && (
          <div className="mt-2 text-sm">
            <span className="text-muted-foreground">Path </span>
            <code className="font-mono">{rule.path}</code>
            <span className="text-muted-foreground">
              {' '}
              did not resolve. Pick one of the discovered paths above.
            </span>
          </div>
        )}
        {previewState.kind === 'empty-path' && (
          <>
            <div className="mt-2 text-xs text-muted-foreground">
              Matching against the root payload (no path set):
            </div>
            <pre className="mt-1 max-h-40 overflow-auto text-sm font-mono whitespace-pre-wrap break-all">
              {formatRawPreviewValue(previewState.value)}
            </pre>
          </>
        )}
        {previewState.kind === 'resolved' && (
          <pre className="mt-2 overflow-x-auto text-sm font-mono whitespace-pre-wrap break-all">
            {formatRawPreviewValue(previewState.value)}
          </pre>
        )}
      </div>

      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Operator</span>
        </label>
        <select
          className={selectClassName}
          value={rule.operator}
          onChange={(e) => {
            const nextOperator = e.target.value as RawRuleOperator;
            onChange({
              ...rule,
              operator: nextOperator,
              value: getDefaultRawRuleValue(
                nextOperator,
                previewValue,
                rule.value,
              ),
            });
          }}
        >
          {rawRuleOperatorOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {valueEditorKind === 'boolean' && (
        <div className={fieldClassName}>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={Boolean(rule.value)}
              onChange={(e) => onChange({ ...rule, value: e.target.checked })}
            />
            <span className={fieldLabelClassName}>
              {Boolean(rule.value) ? 'True' : 'False'}
            </span>
          </label>
        </div>
      )}

      {valueEditorKind === 'number' && (
        <div className={fieldClassName}>
          <label>
            <span className={fieldLabelClassName}>Expected value</span>
          </label>
          <Input
            type="number"
            className="h-9"
            value={typeof rule.value === 'number' ? rule.value : 0}
            onChange={(e) =>
              onChange({ ...rule, value: Number(e.target.value) })
            }
          />
        </div>
      )}

      {valueEditorKind === 'string' && (
        <div className={fieldClassName}>
          <label>
            <span className={fieldLabelClassName}>Expected value</span>
          </label>
          <Input
            type="text"
            className="h-9 font-mono"
            value={typeof rule.value === 'string' ? rule.value : ''}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          />
        </div>
      )}

      {valueEditorKind === 'unsupported' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          This visual editor currently supports scalar comparison values. Switch
          to JSON edit mode for array or object comparisons.
        </div>
      )}

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
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Group</span>
        </label>
        <GroupSelect
          groups={groups}
          value={rule.group_id}
          onChange={(groupId) => onChange({ ...rule, group_id: groupId })}
        />
      </div>

      <div className={fieldClassName}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={rule.power !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                power: e.target.checked ? true : undefined,
              })
            }
          />
          <span className={fieldLabelClassName}>Match Power State</span>
        </label>
        {rule.power !== undefined && (
          <div className="ml-8">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={rule.power}
                onChange={(e) => onChange({ ...rule, power: e.target.checked })}
              />
              <span className={fieldLabelClassName}>
                {rule.power ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}
      </div>

      <div className={fieldClassName}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={rule.scene !== undefined}
            onChange={(e) =>
              onChange({
                ...rule,
                scene: e.target.checked ? '' : undefined,
              })
            }
          />
          <span className={fieldLabelClassName}>Match Scene</span>
        </label>
        {rule.scene !== undefined && (
          <div className="ml-8 mt-1">
            <select
              className={selectClassName}
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
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>JavaScript Code</span>
        </label>
        <Textarea
          className="h-32 font-mono text-sm"
          value={rule.script}
          onChange={(e) => onChange({ ...rule, script: e.target.value })}
          placeholder={`// Return true to trigger the routine
// Available: devices, groups

const sensor = devices["zigbee/motion-sensor"];
return sensor?.data?.OnOffSensor?.value === true;`}
        />
        <span className={helpTextClassName}>
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
    newType: 'sensor' | 'raw' | 'device' | 'group' | 'any' | 'script',
  ) => {
    if (newType === 'sensor') {
      onChange({
        state: { value: true },
        trigger_mode: 'pulse',
      } as SensorRule);
    } else if (newType === 'raw') {
      onChange({
        path: '',
        operator: 'exists',
        trigger_mode: 'pulse',
      } as RawRule);
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
    <Card
      className={cn('rounded-2xl bg-muted/30', depth > 0 && 'bg-muted/50 p-3')}
    >
      <CardContent className={depth > 0 ? 'space-y-4 p-0' : 'space-y-4 p-4'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <ConfigField
            label="Rule type"
            description="Choose the condition this rule evaluates."
            className="w-full max-w-sm"
          >
            <select
              className={selectClassName}
              value={ruleType}
              onChange={(e) =>
                handleTypeChange(
                  e.target.value as
                    | 'sensor'
                    | 'raw'
                    | 'device'
                    | 'group'
                    | 'any'
                    | 'script',
                )
              }
            >
              <option value="sensor">Sensor Rule</option>
              <option value="raw">Raw JSON Rule</option>
              <option value="device">Device Rule</option>
              <option value="group">Group Rule</option>
              <option value="any">Any (OR)</option>
              <option value="script">Script Rule</option>
            </select>
          </ConfigField>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            ✕
          </Button>
        </div>

        {ruleType === 'sensor' && (
          <SensorRuleEditor
            rule={rule as SensorRule}
            devices={devices}
            onChange={onChange}
          />
        )}
        {ruleType === 'raw' && (
          <RawRuleEditor
            rule={rule as RawRule}
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
          <ScriptRuleEditor rule={rule as ScriptRule} onChange={onChange} />
        )}
      </CardContent>
    </Card>
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
      <p className="text-sm text-muted-foreground">
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
      <Button variant="outline" size="sm" onClick={handleAddRule}>
        + Add OR Rule
      </Button>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-medium">Rules</h4>
          <p className="text-sm text-muted-foreground">
            All rules must match before actions run.
          </p>
        </div>
        <Button size="sm" onClick={handleAddRule}>
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 py-4 text-center text-sm text-muted-foreground">
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
