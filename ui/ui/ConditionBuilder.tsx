import { BlockCallEditor } from '@/ui/BlockCallEditor';
import { JsonValueControl } from '@/ui/settings/JsonValueControl';
import {
  FlowBlock,
  AddFlowBlock,
  UnknownFlowValue,
  useRoutineAuthoring,
} from '@/ui/settings/FlowBlock';
import { entityDraftStore, remapArrayEditorPath } from '@/lib/entityDraft';
import { editableCondition, valueSourceKey } from '@/lib/conditionEditing';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { moveSibling } from '@/lib/routineDraft';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { RawRuleOperator } from '@/bindings/RawRuleOperator';
import type { ValueSource } from '@/bindings/ValueSource';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { useSources, useDeviceDisplayNames } from '@/hooks/useConfig';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { getDeviceDisplayLabelFromKey } from '@/lib/deviceLabel';
import { conditionWords, fieldLabel } from '@/lib/conditionWords';
import {
  ReferenceField,
  GroupSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import { ValuePathPicker } from '@/ui/ValuePathPicker';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { useValueHistory } from '@/hooks/useValueHistory';

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
  { value: 'block', label: 'Reusable condition' },
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
    case 'block':
      return { kind: 'block', block_id: '', inputs: {} };
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

export function describeCondition(
  condition: unknown,
  resolveDevice?: (ref: {
    integration_id: string;
    device_id: string;
  }) => string,
): string {
  if (!editableCondition(condition)) {
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
    case 'block':
      return `block ${expr.block_id || '?'}`;
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
  path,
}: {
  operator: RawRuleOperator;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  if (operatorsWithoutValue.has(operator)) {
    return null;
  }

  const valueType =
    value !== undefined && typeof value === 'object'
      ? 'json'
      : typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : 'text';

  return (
    <div className="condition-value grid content-start gap-2">
      <div className="condition-value-heading flex min-h-4 items-center justify-between gap-2">
        <span className="text-xs font-medium">Value</span>
        <SettingsSelect
          aria-label="Value type"
          className="condition-value-type"
          value={valueType}
          options={[
            { value: 'boolean', label: 'Boolean' },
            { value: 'number', label: 'Number' },
            { value: 'text', label: 'Text' },
            { value: 'json', label: 'JSON' },
          ]}
          onValueChange={(next) => {
            const fallback =
              next === 'json'
                ? []
                : next === 'number'
                  ? 0
                  : next === 'boolean'
                    ? true
                    : '';
            onChange(
              draftKey
                ? entityDraftStore.switchVariant(
                    draftKey,
                    path,
                    valueType,
                    value,
                    next,
                    fallback,
                  )
                : fallback,
            );
          }}
        />
      </div>
      {valueType === 'json' ? (
        <JsonValueControl value={value} onChange={onChange} />
      ) : valueType === 'boolean' ? (
        <SettingsSelect
          aria-label="Expected value"
          value={value === true ? 'true' : 'false'}
          options={[
            { value: 'true', label: 'True' },
            { value: 'false', label: 'False' },
          ]}
          onValueChange={(next) => onChange(next === 'true')}
        />
      ) : valueType === 'number' && draftKey ? (
        <DraftNumberInput
          aria-label="Expected value"
          draftKey={draftKey}
          path={`${path}/number`}
          value={typeof value === 'number' ? value : undefined}
          onValueChange={onChange}
        />
      ) : valueType === 'number' ? (
        <Input
          aria-label="Expected value"
          type="number"
          step="any"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            onChange(Number.isNaN(parsed) ? 0 : parsed);
          }}
        />
      ) : (
        <Input
          aria-label="Expected value"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

function ValueSourceEditor({
  source,
  onChange,
  onChooseValue,
  devices,
  helpers,
  path,
}: {
  source: ValueSource;
  onChange: (source: ValueSource) => void;
  onChooseValue?: (value: unknown) => void;
  devices: DevicesState;
  helpers: HelperRuntimeStatus[];
  path: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  const sources = useSources().data ?? [];
  const names = useDeviceDisplayNames().data;
  const displayNames = Object.fromEntries(
    names.map((row) => [row.device_key, row.display_name]),
  );
  const selectedId =
    source.kind === 'device'
      ? source.device.integration_id + '/' + source.device.device_id
      : source.kind === 'helper'
        ? source.helper
        : source.source;
  const sourceOptions = [
    ...Object.entries(devices).flatMap(([key, device]) =>
      device
        ? [
            {
              value: 'device:' + key,
              label: getDeviceDisplayLabelFromKey(
                key,
                device.name,
                displayNames,
              ),
              detail: 'Device · ' + key,
            },
          ]
        : [],
    ),
    ...helpers.map((helper) => ({
      value: 'helper:' + helper.id,
      label: helper.name,
      detail: 'Helper · ' + helper.id,
    })),
    ...sources.map((item) => ({
      value: 'computed_source:' + item.id,
      label: item.name,
      detail: 'Computed source · ' + item.id,
    })),
  ];
  return (
    <div
      className="condition-source grid gap-3"
      style={
        source.kind === 'helper'
          ? { gridTemplateColumns: 'minmax(0, 1fr)' }
          : undefined
      }
    >
      <ConfigField label="Read value from">
        <ReferenceField
          kind={source.kind === 'computed_source' ? 'source' : source.kind}
          value={selectedId}
        >
          <SearchablePicker
            options={sourceOptions}
            value={source.kind + ':' + selectedId}
            clearable={false}
            placeholder="Choose a device, helper or source…"
            onChange={(selected) => {
              const split = selected.indexOf(':');
              const kind = selected.slice(0, split);
              const id = selected.slice(split + 1);
              let next: ValueSource | undefined;
              if (kind === 'device')
                next = {
                  ...(source.kind === 'device' ? source : {}),
                  kind: 'device',
                  device: splitDeviceKey(id) ?? {
                    integration_id: '',
                    device_id: '',
                  },
                  path:
                    source.kind === 'device'
                      ? source.path
                      : devices[id] && 'Controllable' in devices[id]!.data
                        ? '/power'
                        : '/value',
                };
              else if (kind === 'helper')
                next = {
                  ...(source.kind === 'helper' ? source : {}),
                  kind: 'helper',
                  helper: id,
                };
              else if (kind === 'computed_source')
                next = {
                  ...(source.kind === 'computed_source' ? source : {}),
                  kind: 'computed_source',
                  source: id,
                  path: source.kind === 'computed_source' ? source.path : '/',
                };
              if (next)
                onChange(
                  draftKey
                    ? entityDraftStore.switchVariant(
                        draftKey,
                        path,
                        valueSourceKey(source),
                        source,
                        selected,
                        next,
                      )
                    : next,
                );
            }}
          />
        </ReferenceField>
      </ConfigField>
      {source.kind === 'helper' ? (
        <HelperValuePreview
          id={source.helper}
          value={helpers.find((helper) => helper.id === source.helper)?.value}
          onChooseValue={onChooseValue}
        />
      ) : (
        <ConfigField label="Field">
          <ValuePathPicker
            key={valueSourceKey(source)}
            devices={devices}
            deviceKey={
              source.kind === 'device' ? selectedId : 'computed/' + selectedId
            }
            sourceKind={source.kind === 'device' ? 'device' : 'computed_source'}
            path={source.path ?? '/'}
            onChange={(path) => onChange({ ...source, path })}
            onChooseValue={onChooseValue}
          />
        </ConfigField>
      )}
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
  hideKind = false,
  path = 'condition',
}: {
  condition: ConditionExpr;
  onChange: (condition: ConditionExpr) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  depth?: number;
  hideKind?: boolean;
  path?: string;
}) {
  const { draftKey } = useRoutineAuthoring();
  if (!editableCondition(condition))
    return <UnknownFlowValue value={condition} />;
  const kindSelect = (
    <SettingsSelect
      aria-label="Condition type"
      value={condition.kind}
      onValueChange={(kind) =>
        onChange(
          draftKey
            ? entityDraftStore.switchVariant(
                draftKey,
                path,
                condition.kind,
                condition,
                kind,
                defaultCondition(kind as ConditionKind),
              )
            : defaultCondition(kind as ConditionKind),
        )
      }
      options={conditionKindOptions}
    />
  );

  const renderChildren = (
    children: ConditionExpr[],
    update: (next: ConditionExpr[]) => void,
  ) => {
    const arrayPath = `${path}/${condition.kind}/conditions`;
    const reorder = (order: number[]) => {
      if (draftKey)
        entityDraftStore.remapEditorPaths(draftKey, (slot) =>
          remapArrayEditorPath(slot, arrayPath, order),
        );
      update(order.map((index) => children[index]));
    };
    return (
      <div className="flow-conditions">
        {children.map((child, index) => (
          <FlowBlock
            key={index}
            className="flow-condition-node"
            title={
              editableCondition(child) ? (
                <SettingsSelect
                  className="w-full"
                  aria-label="Condition type"
                  value={child.kind}
                  options={conditionKindOptions}
                  onValueChange={(kind) =>
                    update(
                      children.map((entry, i) =>
                        i === index
                          ? draftKey
                            ? entityDraftStore.switchVariant(
                                draftKey,
                                `${arrayPath}/${index}`,
                                child.kind,
                                child,
                                kind,
                                defaultCondition(kind as ConditionKind),
                              )
                            : defaultCondition(kind as ConditionKind)
                          : entry,
                      ),
                    )
                  }
                />
              ) : (
                'Unsupported condition'
              )
            }
            index={index}
            total={children.length}
            onMove={(offset) =>
              reorder(
                moveSibling(
                  children.map((_, i) => i),
                  index,
                  offset,
                ),
              )
            }
            onRemove={() =>
              reorder(children.map((_, i) => i).filter((i) => i !== index))
            }
          >
            <ConditionEditor
              condition={child}
              path={`${arrayPath}/${index}`}
              onChange={(next) =>
                update(children.map((entry, i) => (i === index ? next : entry)))
              }
              devices={devices}
              groups={groups}
              scenes={scenes}
              helpers={helpers}
              depth={depth + 1}
              hideKind
            />
          </FlowBlock>
        ))}
        {!children.length && (
          <p className="text-xs text-destructive">
            Add a condition or remove this empty group.
          </p>
        )}
        <AddFlowBlock
          label="Add condition"
          options={conditionKindOptions}
          onAdd={(kind) => update([...children, defaultCondition(kind)])}
        />
      </div>
    );
  };
  if (!conditionKindOptions.some((option) => option.value === condition.kind))
    return <UnknownFlowValue value={condition} />;

  return (
    <div className={'flow-condition space-y-3'} data-condition-path={path}>
      {!hideKind && <ConfigField label="Match">{kindSelect}</ConfigField>}

      {condition.kind === 'block' && (
        <BlockCallEditor
          path={`${path}/block`}
          kind="condition"
          blockId={condition.block_id}
          inputs={condition.inputs}
          onChange={(block_id, inputs) =>
            onChange({ ...condition, block_id, inputs })
          }
          devices={devices}
          groups={groups}
          scenes={scenes}
          helpers={helpers}
        />
      )}
      {condition.kind === 'literal' ? (
        <ConfigField label="Result">
          <SettingsSelect
            aria-label="Condition result"
            value={condition.value ? 'true' : 'false'}
            onValueChange={(value) =>
              onChange({
                ...condition,
                kind: 'literal',
                value: value === 'true',
              })
            }
            options={[
              { value: 'true', label: 'Always true' },
              { value: 'false', label: 'Always false' },
            ]}
          />
        </ConfigField>
      ) : null}

      {condition.kind === 'all' || condition.kind === 'any' ? (
        <>
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
            path={`${path}/not/condition`}
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
            path={`${path}/comparison/source`}
            onChange={(source) => onChange({ ...condition, source })}
            onChooseValue={
              operatorsWithoutValue.has(condition.operator)
                ? undefined
                : (value) => {
                    if (draftKey)
                      entityDraftStore.remapEditorPaths(draftKey, (slot) =>
                        slot.startsWith(`${path}/comparison/value/`)
                          ? null
                          : slot,
                      );
                    onChange({ ...condition, value: value as JsonValue });
                  }
            }
            devices={devices}
            helpers={helpers}
          />
          <div className="condition-comparison grid gap-3">
            <ConfigField label="Operator">
              <SettingsSelect
                aria-label="Comparison operator"
                value={condition.operator}
                onValueChange={(operator) => {
                  const from = operatorsWithoutValue.has(condition.operator)
                    ? 'none'
                    : 'value';
                  const to = operatorsWithoutValue.has(
                    operator as RawRuleOperator,
                  )
                    ? 'none'
                    : 'value';
                  const value =
                    from === to
                      ? condition.value
                      : draftKey
                        ? entityDraftStore.switchVariant(
                            draftKey,
                            `${path}/comparison/value`,
                            from,
                            condition.value,
                            to,
                            to === 'none' ? undefined : true,
                          )
                        : to === 'none'
                          ? undefined
                          : true;
                  onChange({
                    ...condition,
                    operator: operator as RawRuleOperator,
                    value,
                  });
                }}
                options={operatorOptions}
              />
            </ConfigField>
            <ComparisonValueEditor
              operator={condition.operator}
              value={condition.value}
              path={`${path}/comparison/value/typed`}
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
            <SettingsSelect
              aria-label="Group match"
              value={condition.quantifier}
              onValueChange={(quantifier) =>
                onChange({
                  ...condition,
                  quantifier: quantifier as typeof condition.quantifier,
                })
              }
              options={[
                { value: 'all', label: 'All members' },
                { value: 'any', label: 'Any member' },
                { value: 'none', label: 'No member' },
                { value: 'partial', label: 'Partially (a mix)' },
              ]}
            />
          </ConfigField>
          <ConfigField label="Power">
            <SettingsSelect
              aria-label="Group power"
              value={
                condition.power === undefined
                  ? 'any'
                  : condition.power
                    ? 'on'
                    : 'off'
              }
              onValueChange={(next) => {
                onChange({
                  ...condition,
                  power: next === 'any' ? undefined : next === 'on',
                });
              }}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </ConfigField>
          <ConfigField label="Scene">
            <ReferenceField kind="scene" value={condition.scene ?? ''}>
              <SettingsSelect
                aria-label="Group scene"
                value={
                  condition.scene === undefined
                    ? 'any'
                    : `scene:${condition.scene}`
                }
                onValueChange={(scene) =>
                  onChange({
                    ...condition,
                    scene: scene === 'any' ? undefined : scene.slice(6),
                  })
                }
                options={[
                  { value: 'any', label: 'Any scene' },
                  ...(condition.scene &&
                  !scenes.some((scene) => scene.id === condition.scene)
                    ? [
                        {
                          value: `scene:${condition.scene}`,
                          label: `Unavailable scene: ${condition.scene}`,
                        },
                      ]
                    : []),
                  ...scenes.map((scene) => ({
                    value: `scene:${scene.id}`,
                    label: scene.name,
                  })),
                ]}
              />
            </ReferenceField>
          </ConfigField>
        </div>
      ) : null}
    </div>
  );
}

export default ConditionEditor;
