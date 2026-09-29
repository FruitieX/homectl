import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { entityDraftStore, remapArrayEditorPath } from '@/lib/entityDraft';
function typeOf(value: unknown) {
  return value === null
    ? 'null'
    : value === undefined
      ? 'unset'
      : Array.isArray(value)
        ? 'array'
        : typeof value;
}
const empty: Record<string, unknown> = {
  unset: undefined,
  null: null,
  string: '',
  number: 0,
  boolean: false,
  array: [],
  object: {},
};
/** Direct controls for JSON-shaped extension values. Field names, nulls and
 * array order are preserved; known domain collections use their own controls. */
export function JsonValueEditor({
  value,
  onChange,
  label = 'Value',
  draftKey,
  path = 'json',
  allowUnset = false,
  fixedType,
  depth = 0,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
  draftKey: string;
  path?: string;
  allowUnset?: boolean;
  fixedType?: 'object' | 'array';
  depth?: number;
}) {
  const [newKey, setNewKey] = useState('');
  const kind = typeOf(value);
  const input = entityDraftStore.get(draftKey)?.inputs?.[path];
  const removeEditorPath = (removed: string) =>
    entityDraftStore.remapEditorPaths(draftKey, (slot) =>
      slot === removed || slot.startsWith(removed + '/') ? null : slot,
    );
  const reorderEditors = (order: number[]) =>
    entityDraftStore.remapEditorPaths(draftKey, (slot) =>
      remapArrayEditorPath(slot, path + '/array', order),
    );
  const record = kind === 'object' ? (value as Record<string, unknown>) : {};
  const options = [
    ...(allowUnset || kind === 'unset' ? ['unset'] : []),
    'string',
    'number',
    'boolean',
    'null',
    'array',
    'object',
  ];
  if (depth > 12)
    return (
      <p className="text-xs text-muted-foreground">
        This deeply nested value is preserved. Download the definition to
        inspect it.
      </p>
    );
  return (
    <div className="json-value-editor min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-xs font-medium">{label}</span>
        {!fixedType && (
          <SettingsSelect
            aria-label={`${label} value type`}
            className="ml-auto w-auto max-w-full"
            value={kind}
            onValueChange={(next) =>
              onChange(
                entityDraftStore.switchVariant(
                  draftKey,
                  path,
                  kind,
                  value,
                  next,
                  structuredClone(empty[next]),
                ),
              )
            }
            options={options.map((option) => ({
              value: option,
              label: (
                {
                  unset: 'Use default',
                  string: 'Text',
                  number: 'Number',
                  boolean: 'True / false',
                  null: 'None (null)',
                  array: 'List',
                  object: 'Fields',
                } as Record<string, string>
              )[option],
            }))}
          />
        )}
      </div>
      {kind === 'string' ? (
        <Input
          aria-label={label}
          value={value as string}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : kind === 'number' ? (
        <div className="space-y-1">
          <Input
            aria-label={label}
            data-field={path}
            inputMode="decimal"
            aria-invalid={Boolean(input?.error)}
            aria-describedby={
              input?.error
                ? `number-error-${encodeURIComponent(path)}`
                : undefined
            }
            value={input?.raw ?? String(value)}
            onChange={(event) => {
              const raw = event.target.value;
              const valid =
                /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) &&
                Number.isFinite(Number(raw));
              entityDraftStore.stageInput(draftKey, path, {
                raw,
                error: valid
                  ? undefined
                  : `${label}: enter a complete, finite number.`,
              });
              if (valid) onChange(Number(raw));
            }}
          />
          {input?.error && (
            <p
              id={`number-error-${encodeURIComponent(path)}`}
              className="text-xs text-destructive"
            >
              {input.error}
            </p>
          )}
        </div>
      ) : kind === 'boolean' ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(event) => onChange(event.target.checked)}
          />
          {value ? 'True' : 'False'}
        </label>
      ) : kind === 'array' ? (
        <div className="space-y-2">
          {(value as unknown[]).map((item, index, items) => (
            <div key={index} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-1">
                <span className="mr-auto text-xs text-muted-foreground">
                  Item {index + 1}
                </span>
                {[-1, 1].map((offset) => (
                  <Button
                    key={offset}
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`${offset < 0 ? 'Move earlier' : 'Move later'} item ${index + 1}`}
                    disabled={
                      index + offset < 0 || index + offset >= items.length
                    }
                    onClick={() => {
                      const next = [...items];
                      [next[index], next[index + offset]] = [
                        next[index + offset],
                        next[index],
                      ];
                      const order = items.map((_, i) => i);
                      [order[index], order[index + offset]] = [
                        order[index + offset],
                        order[index],
                      ];
                      reorderEditors(order);
                      onChange(next);
                    }}
                  >
                    {offset < 0 ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )}
                  </Button>
                ))}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => {
                    reorderEditors(
                      items.map((_, i) => i).filter((i) => i !== index),
                    );
                    onChange(items.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <JsonValueEditor
                value={item}
                label={`${label} ${index + 1}`}
                depth={depth + 1}
                path={`${path}/array/${index}`}
                draftKey={draftKey}
                onChange={(next) =>
                  onChange(
                    items.map((entry, i) => (i === index ? next : entry)),
                  )
                }
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...(value as unknown[]), ''])}
          >
            <Plus className="size-3" />
            Add item
          </Button>
        </div>
      ) : kind === 'object' ? (
        <div className="space-y-3">
          {Object.entries(record).map(([key, item]) => (
            <div key={key} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <code className="min-w-0 break-all text-xs">{key}</code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Remove ${key}`}
                  onClick={() => {
                    removeEditorPath(
                      `${path}/object/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
                    );
                    onChange(
                      Object.fromEntries(
                        Object.entries(record).filter(([name]) => name !== key),
                      ),
                    );
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <JsonValueEditor
                value={item}
                label={key}
                depth={depth + 1}
                path={`${path}/object/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`}
                draftKey={draftKey}
                onChange={(next) => onChange({ ...record, [key]: next })}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={`New ${label} field name`}
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="Field name"
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!newKey || Object.hasOwn(record, newKey)}
              onClick={() => {
                onChange({ ...record, [newKey]: '' });
                setNewKey('');
              }}
            >
              <Plus className="size-3" />
              Add field
            </Button>
          </div>
          {newKey && Object.hasOwn(record, newKey) && (
            <p className="text-xs text-destructive">
              This field already exists.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
