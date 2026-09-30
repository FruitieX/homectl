import type { ConditionExpr } from '../bindings/ConditionExpr';
import type { ValueSource } from '../bindings/ValueSource';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const conditionOperators = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'exists',
  'truthy',
  'regex',
];
export function editableValueSource(value: unknown): value is ValueSource {
  if (!record(value)) return false;
  if (value.kind === 'helper') return typeof value.helper === 'string';
  if (value.kind === 'computed_source')
    return typeof value.source === 'string' && typeof value.path === 'string';
  return (
    value.kind === 'device' &&
    record(value.device) &&
    typeof value.device.integration_id === 'string' &&
    typeof value.device.device_id === 'string' &&
    typeof value.path === 'string'
  );
}
/** Validate only this node; children render their own preserved, unsupported values. */
export function editableCondition(value: unknown): value is ConditionExpr {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'block':
      return (
        typeof value.block_id === 'string' &&
        (value.inputs === undefined || record(value.inputs))
      );
    case 'literal':
      return typeof value.value === 'boolean';
    case 'all':
    case 'any':
      return Array.isArray(value.conditions);
    case 'not':
      return Object.hasOwn(value, 'condition');
    case 'comparison':
      return (
        editableValueSource(value.source) &&
        conditionOperators.includes(value.operator as string)
      );
    case 'group':
      return (
        typeof value.group_id === 'string' &&
        ['all', 'any', 'none', 'partial'].includes(
          value.quantifier as string,
        ) &&
        (value.power === undefined || typeof value.power === 'boolean') &&
        (value.scene === undefined || typeof value.scene === 'string')
      );
    default:
      return false;
  }
}
export function valueSourceKey(source: ValueSource): string {
  return (
    source.kind +
    ':' +
    (source.kind === 'device'
      ? source.device.integration_id + '/' + source.device.device_id
      : source.kind === 'helper'
        ? source.helper
        : source.source)
  );
}
