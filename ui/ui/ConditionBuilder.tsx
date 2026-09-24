import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { RawRuleOperator } from '@/bindings/RawRuleOperator';
import type { ValueSource } from '@/bindings/ValueSource';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useSources } from '@/hooks/useConfig';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import {
  OPERATORS_WITHOUT_VALUE,
  conditionWords,
  fieldLabel,
} from '@/lib/conditionWords';
import { selectClassName } from '@/ui/builder-fields';
import {
  DeviceSelect,
  GroupSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ValuePathPicker } from '@/ui/ValuePathPicker';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { useValueHistory } from '@/hooks/useValueHistory';
import { useState } from 'react';

export type ConditionKind = ConditionExpr['kind'];

export const operatorOptions: Array<{ value: RawRuleOperator; label: string }> =
  [
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

export const operatorsWithoutValue = new Set<RawRuleOperator>([
  'exists',
  'truthy',
]);

const conditionKindOptions: Array<{ value: ConditionKind; label: string }> = [
  { value: 'all', label: 'All conditions hold' },
  { value: 'any', label: 'Any condition holds' },
  { value: 'not', label: 'Condition does not hold' },
  { value: 'comparison', label: 'Value check' },
  { value: 'group', label: 'Group check' },
  { value: 'literal', label: 'Always / never' },
];

const quantifierLabels: Record<string, string> = {
  all: 'all members',
  any: 'any member',
  none: 'no member',
  partial: 'a mix of members',
};

export function defaultCondition(kind: ConditionKind): ConditionExpr {
  switch (kind) {
    case 'literal':
      return { kind: 'literal', value: true };
    case 'comparison':
      return {
        kind: 'comparison',
        source: {
          kind: 'device',
          device: { integration_id: '', device_id: '' },
          path: '/value',
        },
        operator: 'eq',
        value: true,
      };
    case 'group':
      return { kind: 'group', group_id: '', quantifier: 'all' };
    case 'all':
      return { kind: 'all', conditions: [] };
    case 'any':
      return { kind: 'any', conditions: [] };
    case 'not':
      return {
        kind: 'not',
        condition: { kind: 'literal', value: true },
      };
  }
}

function defaultValueSource(kind: ValueSource['kind']): ValueSource {
  switch (kind) {
    case 'device':
      return {
        kind: 'device',
        device: { integration_id: '', device_id: '' },
        path: '/value',
      };
    case 'helper':
      return { kind: 'helper', helper: '' };
    case 'computed_source':
      return { kind: 'computed_source', source: '', path: '/' };
  }
}

function sourceSubject(
  source: ValueSource,
  resolveDevice?: (ref: {
    integration_id: string;
    device_id: string;
  }) => string,
): { subject: string; field: string } {
  switch (source.kind) {
    case 'device':
      return {
        subject:
          (resolveDevice
            ? resolveDevice(source.device)
            : source.device.device_id) || 'device',
        field: fieldLabel(source.path),
      };
    case 'helper':
      return {
        subject: fieldLabel(source.helper || '?'),
        field: 'helper',
      };
    case 'computed_source':
      return {
        subject: `${source.source || 'source'} ·`,
        field: fieldLabel(source.path),
      };
  }
}

function describeSource(
  source: ValueSource,
  resolveDevice?: (ref: {
    integration_id: string;
    device_id: string;
  }) => string,
): string {
  const { subject, field } = sourceSubject(source, resolveDevice);
  return `${subject} ${field}`;
}

export function describeCondition(
  condition: unknown,
  resolveDevice?: (ref: {
    integration_id: string;
    device_id: string;
  }) => string,
): string {
  if (!condition || typeof condition !== 'object') {
    return 'condition';
  }
  const expr = condition as ConditionExpr;
  switch (expr.kind) {
    case 'literal':
      return expr.value ? 'always true' : 'always false';
    case 'all':
      return `all of ${expr.conditions.length} condition(s)`;
    case 'any':
      return `any of ${expr.conditions.length} condition(s)`;
    case 'not':
      return `not (${describeCondition(expr.condition, resolveDevice)})`;
    case 'comparison': {
      // A sentence, not a JSON pointer plus an operator token: "Hallway spot
      // brightness is more than 50%". The raw pointer stays in the editor.
      const { subject, field } = sourceSubject(expr.source, resolveDevice);
      return conditionWords({ subject, field }, expr.operator, expr.value);
    }
    case 'group':
      return `group ${expr.group_id || '?'} (${quantifierLabels[expr.quantifier] ?? expr.quantifier})`;
    default:
      return 'condition';
  }
}

function ComparisonValueEditor({
  operator,
  value,
  onChange,
  fieldType,
  fieldPath,
}: {
  operator: RawRuleOperator;
  value: unknown;
  onChange: (value: unknown) => void;
  fieldType?: string;
  fieldPath?: string;
}) {
  if (operatorsWithoutValue.has(operator)) {
    return null;
  }

  const knownType =
    fieldType === 'boolean' || fieldType === 'number' || fieldType === 'text'
      ? fieldType
      : null;
  const valueType =
    knownType ??
    (typeof value === 'number'
      ? 'number'
      : typeof value === 'boolean'
        ? 'boolean'
        : 'text');
  const isActiveField = /motion|occupancy|active/i.test(fieldPath ?? '');
  const isBrightness = /brightness/i.test(fieldPath ?? '');
  const unit = isBrightness ? '%' : '';

  return (
    <>
      {!knownType ? (
        <ConfigField label="Value type">
          <select
            className={selectClassName}
            value={valueType}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next === 'number' ? 0 : next === 'boolean' ? true : '');
            }}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
          </select>
        </ConfigField>
      ) : null}
      <ConfigField label="Value">
        {valueType === 'boolean' ? (
          <select
            className={selectClassName + ' min-h-11'}
            value={value === true ? 'true' : 'false'}
            onChange={(event) => onChange(event.target.value === 'true')}
          >
            <option value="true">{isActiveField ? 'Active' : 'On'}</option>
            <option value="false">{isActiveField ? 'Inactive' : 'Off'}</option>
          </select>
        ) : valueType === 'number' ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step={isBrightness ? 0.1 : 'any'}
              aria-label={unit ? `Expected value in ${unit}` : 'Expected value'}
              value={
                typeof value === 'number'
                  ? isBrightness
                    ? value * 100
                    : value
                  : ''
              }
              onChange={(event) => {
                const parsed = event.target.valueAsNumber;
                onChange(
                  Number.isNaN(parsed)
                    ? 0
                    : isBrightness
                      ? parsed / 100
                      : parsed,
                );
              }}
            />
            {unit ? (
              <span className="text-sm text-muted-foreground">{unit}</span>
            ) : null}
          </div>
        ) : (
          <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </ConfigField>
    </>
  );
}

function ValueSourceEditor({
  source,
  onChange,
  onChooseValue,
  devices,
  helpers,
  onFieldInfo,
}: {
  source: ValueSource;
  onChange: (source: ValueSource) => void;
  onChooseValue?: (value: unknown) => void;
  devices: DevicesState;
  helpers: HelperRuntimeStatus[];
  onFieldInfo: (info: { path: string; type: string } | null) => void;
}) {
  const sourceKind = source.kind;
  const sources = useSources().data ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConfigField label="Source">
        <select
          className={selectClassName}
          value={sourceKind}
          onChange={(event) => {
            onFieldInfo(null);
            onChange(
              defaultValueSource(event.target.value as ValueSource['kind']),
            );
          }}
        >
          <option value="device">Device value</option>
          <option value="helper">Helper</option>
          <option value="computed_source">Computed source</option>
        </select>
      </ConfigField>

      {source.kind === 'device' ? (
        <>
          <ConfigField label="Device">
            <DeviceSelect
              devices={devices}
              value={
                source.device.integration_id && source.device.device_id
                  ? `${source.device.integration_id}/${source.device.device_id}`
                  : ''
              }
              onChange={(key) => {
                onFieldInfo(null);
                onChange({
                  ...source,
                  device: splitDeviceKey(key) ?? {
                    integration_id: '',
                    device_id: '',
                  },
                  path:
                    devices[key] && 'Controllable' in devices[key]!.data
                      ? '/power'
                      : '/value',
                });
              }}
            />
          </ConfigField>
          <ConfigField
            label="Field"
            description="Search fields on this device by name and current value."
          >
            <ValuePathPicker
              devices={devices}
              deviceKey={`${source.device.integration_id}/${source.device.device_id}`}
              path={source.path}
              onChange={(path) => onChange({ ...source, path })}
              onChooseValue={onChooseValue}
              onFieldInfo={onFieldInfo}
            />
          </ConfigField>
        </>
      ) : null}

      {source.kind === 'helper' ? (
        <ConfigField
          label="Helper"
          description="Read the helper's current value."
        >
          <SearchablePicker
            options={helpers.map((helper) => ({
              value: helper.id,
              label: helper.name,
              detail: helper.id,
            }))}
            value={source.helper}
            onChange={(helper) => onChange({ ...source, helper })}
            placeholder="Select helper…"
          />
          {source.helper && (
            <HelperValuePreview
              id={source.helper}
              value={
                helpers.find((helper) => helper.id === source.helper)?.value
              }
              onChooseValue={onChooseValue}
            />
          )}
        </ConfigField>
      ) : null}

      {source.kind === 'computed_source' ? (
        <>
          <ConfigField
            label="Computed source"
            description="Computed source defined in the server configuration."
          >
            <SearchablePicker
              options={sources.map((item) => ({
                value: item.id,
                label: item.name,
                detail: `${item.id}${item.enabled ? '' : ' · disabled'}`,
              }))}
              value={source.source}
              onChange={(selected) => onChange({ ...source, source: selected })}
              placeholder="Select a source…"
            />
          </ConfigField>
          <ConfigField
            label="Field"
            description="JSON pointer into the source value, for example /brightness or /color/ct."
          >
            <ValuePathPicker
              devices={devices}
              deviceKey={`computed/${source.source}`}
              sourceKind="computed_source"
              path={source.path}
              onChange={(path) => onChange({ ...source, path })}
              onChooseValue={onChooseValue}
              onFieldInfo={onFieldInfo}
            />
          </ConfigField>
        </>
      ) : null}
    </div>
  );
}

function HelperValuePreview({
  id,
  value,
  onChooseValue,
}: {
  id: string;
  value: unknown;
  onChooseValue?: (value: unknown) => void;
}) {
  const { history, error } = useValueHistory(`helper/${id}`, '/value');
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        Current value:{' '}
        <span className="font-mono">
          {value === undefined ? 'Unavailable now' : JSON.stringify(value)}
        </span>{' '}
        {value !== undefined && onChooseValue && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChooseValue(value)}
          >
            Use as expected value
          </button>
        )}
      </p>
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Recent changes ({history.length})
          </summary>
          <div className="max-h-32 overflow-y-auto">
            {history.slice(0, 20).map((entry, index) => (
              <p key={`${entry.changed_at_ms}-${index}`}>
                {JSON.stringify(entry.value)} ·{' '}
                {new Date(Number(entry.changed_at_ms)).toLocaleString()}{' '}
                {onChooseValue && (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onChooseValue(entry.value)}
                  >
                    Use
                  </button>
                )}
              </p>
            ))}
          </div>
        </details>
      )}
      {error && <p>Recent changes are unavailable right now.</p>}
    </div>
  );
}

export function ConditionEditor({
  condition,
  onChange,
  devices,
  groups,
  scenes,
  helpers,
  depth = 0,
}: {
  condition: ConditionExpr;
  onChange: (condition: ConditionExpr) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  depth?: number;
}) {
  const [newChildKind, setNewChildKind] = useState<ConditionKind>('comparison');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // One nested clause is open for editing at a time; the others stay sentences.
  const [openChildIndex, setOpenChildIndex] = useState<number | null>(null);
  const [fieldInfo, setFieldInfo] = useState<{
    path: string;
    type: string;
  } | null>(null);
  const resolveDeviceLabel = (ref: {
    integration_id: string;
    device_id: string;
  }) => {
    const key = `${ref.integration_id}/${ref.device_id}`;
    return getDeviceDisplayLabelFromKey(key, devices[key]?.name ?? key, {});
  };

  const kindSelect = (
    <select
      className={selectClassName}
      value={condition.kind}
      onChange={(event) =>
        onChange(defaultCondition(event.target.value as ConditionKind))
      }
    >
      {conditionKindOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const renderChildren = (
    children: ConditionExpr[],
    update: (next: ConditionExpr[]) => void,
  ) => (
    <div className="space-y-3">
      {children.map((child, index) => {
        const open = openChildIndex === index;
        return (
          <div
            key={index}
            className="flex items-start gap-2 rounded-xl border border-border/70 p-2"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  {describeCondition(child, resolveDeviceLabel)}
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={open}
                    onClick={() => setOpenChildIndex(open ? null : index)}
                  >
                    {open ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label="Remove condition"
                    onClick={() => {
                      if (openChildIndex === index) {
                        setOpenChildIndex(null);
                      }
                      update(
                        children.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      );
                    }}
                  >
                    ✕
                  </Button>
                </span>
              </div>
              {open ? (
                <div className="border-t border-border pt-2">
                  <ConditionEditor
                    condition={child}
                    onChange={(next) =>
                      update(
                        children.map((candidate, candidateIndex) =>
                          candidateIndex === index ? next : candidate,
                        ),
                      )
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes}
                    helpers={helpers}
                    depth={depth + 1}
                  />
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {children.length === 0 ? (
        <p className="text-xs text-destructive">
          Add at least one condition; the server rejects an empty group.
        </p>
      ) : null}
      {/* One chooser instead of a type select plus an Add button: pick the kind
          you want and it lands already open for editing. */}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={addMenuOpen}
          aria-haspopup="menu"
          onClick={() => setAddMenuOpen((open) => !open)}
        >
          Add condition…
        </Button>
        {addMenuOpen
          ? conditionKindOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                role="menuitem"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNewChildKind(option.value);
                  setOpenChildIndex(children.length);
                  update([...children, defaultCondition(option.value)]);
                  setAddMenuOpen(false);
                }}
              >
                {option.label}
              </Button>
            ))
          : null}
      </div>
    </div>
  );

  return (
    <div
      className={
        depth === 0
          ? 'space-y-3'
          : 'space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3'
      }
    >
      <ConfigField label={depth === 0 ? 'Condition type' : 'Type'}>
        {kindSelect}
      </ConfigField>

      {condition.kind === 'literal' ? (
        <ConfigField label="Result">
          <select
            className={selectClassName}
            value={condition.value ? 'true' : 'false'}
            onChange={(event) =>
              onChange({
                kind: 'literal',
                value: event.target.value === 'true',
              })
            }
          >
            <option value="true">Always true</option>
            <option value="false">Always false</option>
          </select>
        </ConfigField>
      ) : null}

      {condition.kind === 'all' || condition.kind === 'any' ? (
        <>
          <p className="text-sm text-muted-foreground">
            {condition.kind === 'all'
              ? 'Every child condition must hold.'
              : 'At least one child condition must hold.'}
          </p>
          {renderChildren(condition.conditions, (conditions) =>
            onChange({ ...condition, conditions }),
          )}
        </>
      ) : null}

      {condition.kind === 'not' ? (
        <>
          <p className="text-sm text-muted-foreground">
            The nested condition must not hold.
          </p>
          <ConditionEditor
            condition={condition.condition}
            onChange={(next) => onChange({ ...condition, condition: next })}
            devices={devices}
            groups={groups}
            scenes={scenes}
            helpers={helpers}
            depth={depth + 1}
          />
        </>
      ) : null}

      {condition.kind === 'comparison' ? (
        <div className="space-y-3">
          <ValueSourceEditor
            source={condition.source}
            onChange={(source) => onChange({ ...condition, source })}
            onChooseValue={(value) =>
              onChange({ ...condition, value: value as JsonValue })
            }
            devices={devices}
            helpers={helpers}
            onFieldInfo={setFieldInfo}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField label="Operator">
              <select
                className={selectClassName}
                value={condition.operator}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    operator: event.target.value as RawRuleOperator,
                  })
                }
              >
                {operatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </ConfigField>
            <ComparisonValueEditor
              operator={condition.operator}
              value={condition.value}
              fieldType={
                condition.source.kind === 'device'
                  ? fieldInfo?.path === condition.source.path
                    ? fieldInfo.type
                    : undefined
                  : undefined
              }
              fieldPath={
                condition.source.kind === 'device'
                  ? condition.source.path
                  : undefined
              }
              onChange={(value) =>
                onChange({
                  ...condition,
                  value: value as JsonValue | undefined,
                })
              }
            />
          </div>
        </div>
      ) : null}

      {condition.kind === 'group' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="Group">
            <GroupSelect
              groups={groups}
              value={condition.group_id}
              onChange={(group_id) => onChange({ ...condition, group_id })}
            />
          </ConfigField>
          <ConfigField label="Quantifier">
            <select
              className={selectClassName}
              value={condition.quantifier}
              onChange={(event) =>
                onChange({
                  ...condition,
                  quantifier: event.target.value as typeof condition.quantifier,
                })
              }
            >
              <option value="all">All members</option>
              <option value="any">Any member</option>
              <option value="none">No member</option>
              <option value="partial">Partially (a mix)</option>
            </select>
          </ConfigField>
          <ConfigField label="Power">
            <select
              className={selectClassName}
              value={
                condition.power === undefined
                  ? 'any'
                  : condition.power
                    ? 'on'
                    : 'off'
              }
              onChange={(event) => {
                const next = event.target.value;
                onChange({
                  ...condition,
                  power: next === 'any' ? undefined : next === 'on',
                });
              }}
            >
              <option value="any">Any</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </ConfigField>
          <ConfigField label="Scene">
            <select
              className={selectClassName}
              value={condition.scene ?? ''}
              onChange={(event) =>
                onChange({
                  ...condition,
                  scene: event.target.value || undefined,
                })
              }
            >
              <option value="">Any scene</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </ConfigField>
        </div>
      ) : null}
    </div>
  );
}

export default ConditionEditor;
