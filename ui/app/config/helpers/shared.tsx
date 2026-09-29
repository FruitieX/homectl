import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperKind } from '@/bindings/HelperKind';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { Input } from '@/ui/primitives/input';
import { SearchablePicker } from '@/ui/SearchablePicker';
const selectClassName = 'settings-select';
export const KIND_OPTIONS: Array<{ value: HelperKind['kind']; label: string }> =
  [
    { value: 'boolean', label: 'Boolean' },
    { value: 'enum', label: 'Enum (fixed options)' },
    { value: 'number', label: 'Number (bounded)' },
    { value: 'string', label: 'String' },
  ];

export function kindLabel(kind: HelperKind) {
  switch (kind.kind) {
    case 'boolean':
      return 'Boolean';
    case 'enum':
      return `Enum (${kind.options.length})`;
    case 'number':
      return 'Number';
    case 'string':
      return 'String';
  }
}

export function defaultKind(kind: HelperKind['kind']): HelperKind {
  switch (kind) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'enum':
      return { kind: 'enum', options: ['on', 'off'] };
    case 'number':
      return { kind: 'number' };
    case 'string':
      return { kind: 'string' };
  }
}

export function defaultValueForKind(kind: HelperKind): JsonValue {
  switch (kind.kind) {
    case 'boolean':
      return false;
    case 'enum':
      return kind.options[0] ?? '';
    case 'number':
      return kind.min ?? 0;
    case 'string':
      return '';
  }
}

export function formatValue(value: JsonValue) {
  if (typeof value === 'string') {
    return value === '' ? '(empty)' : value;
  }
  // Booleans read as words, not as JSON: “Off”, never “false”.
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  return JSON.stringify(value);
}

export function newHelperDraft(): HelperDefinition {
  const kind: HelperKind = { kind: 'boolean' };
  return {
    id: '',
    name: '',
    kind,
    initial_value: defaultValueForKind(kind),
    persistence: 'durable',
  };
}

export function validateDraft(draft: HelperDefinition): string | null {
  if (!draft.id.trim()) {
    return 'Helper id must not be empty.';
  }
  if (!draft.name.trim()) {
    return 'Helper name must not be empty.';
  }
  if (draft.kind.kind === 'enum') {
    if (draft.kind.options.length === 0) {
      return 'Enum helpers need at least one option.';
    }
    if (draft.kind.options.some((option) => !option.trim())) {
      return 'Enum options must not be empty.';
    }
    if (new Set(draft.kind.options).size !== draft.kind.options.length) {
      return 'Enum options must be unique.';
    }
  }
  if (
    draft.kind.kind === 'number' &&
    draft.kind.min !== undefined &&
    draft.kind.max !== undefined &&
    draft.kind.min > draft.kind.max
  ) {
    return 'Number minimum exceeds its maximum.';
  }
  if (
    draft.kind.kind === 'number' &&
    [draft.kind.min, draft.kind.max].some(
      (bound) => bound !== undefined && !Number.isFinite(bound),
    )
  )
    return 'Number bounds must be finite.';
  return null;
}

export function ValueControl({
  kind,
  value,
  onChange,
}: {
  kind: HelperKind;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  switch (kind.kind) {
    case 'boolean':
      return (
        <select
          className={selectClassName}
          value={value === true ? 'true' : 'false'}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="true">On / true</option>
          <option value="false">Off / false</option>
        </select>
      );
    case 'enum':
      return (
        <SearchablePicker
          options={kind.options.map((option) => ({
            value: option,
            label: option,
          }))}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          clearable={false}
        />
      );
    case 'number':
      return (
        <Input
          max={kind.max}
          min={kind.min}
          step="any"
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(
              event.target.value !== '' && Number.isFinite(parsed)
                ? parsed
                : null,
            );
          }}
        />
      );
    case 'string':
      return (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

export function helperDefinition(
  status: HelperRuntimeStatus | HelperDefinition,
): HelperDefinition {
  const { id, name, kind, initial_value, persistence, hidden } = status;
  return {
    id,
    name,
    kind,
    initial_value,
    persistence,
    ...(hidden === undefined ? {} : { hidden }),
  };
}
export function invalidHelperValue(
  kind: HelperKind,
  value: JsonValue,
): string | null {
  switch (kind.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Choose On or Off.';
    case 'string':
      return typeof value === 'string' ? null : 'Enter a text value.';
    case 'enum':
      return typeof value === 'string' && kind.options.includes(value)
        ? null
        : 'Choose one of the available options.';
    case 'number':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        (kind.min === undefined || value >= kind.min) &&
        (kind.max === undefined || value <= kind.max)
        ? null
        : 'Enter a number within the configured bounds.';
  }
}
