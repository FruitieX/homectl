import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperKind } from '@/bindings/HelperKind';
import { ConfigField, ConfigFormGrid, ConfigToggleRow } from '@/ui/config-form';
import { checkboxClassName, selectClassName } from '@/ui/form-styles';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

import {
  KIND_OPTIONS,
  ValueControl,
  defaultKind,
  defaultValueForKind,
} from './page';

/**
 * The helper's editable field groups, one component per section, so a detail
 * page can put each behind its own Change action instead of showing one long
 * form. The list page's inline editor uses the same components.
 */

export function HelperNameFields({
  draft,
  setDraft,
  isNew,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
  isNew: boolean;
}) {
  return (
    <ConfigFormGrid>
      <ConfigField
        label="Id"
        description="The stable reference routines and scripts use; fixed once the helper exists."
      >
        <Input
          disabled={!isNew}
          placeholder="staircase_mode"
          type="text"
          value={draft.id}
          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
        />
      </ConfigField>
      <ConfigField label="Name">
        <Input
          placeholder="Staircase mode"
          type="text"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </ConfigField>
    </ConfigFormGrid>
  );
}

export function HelperKindFields({
  draft,
  setDraft,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
}) {
  const kind = draft.kind;

  const changeKind = (next: HelperKind['kind']) => {
    const nextKind = defaultKind(next);
    setDraft({
      ...draft,
      kind: nextKind,
      initial_value: defaultValueForKind(nextKind),
    });
  };

  const updateEnumOptions = (options: string[]) => {
    const nextKind: HelperKind =
      kind.kind === 'enum' ? { kind: 'enum', options } : kind;
    setDraft({
      ...draft,
      kind: nextKind,
      initial_value:
        kind.kind === 'enum' && typeof draft.initial_value === 'string'
          ? options.includes(draft.initial_value)
            ? draft.initial_value
            : (options[0] ?? '')
          : draft.initial_value,
    });
  };

  return (
    <div className="space-y-4">
      <ConfigField
        label="Type"
        description="The declared type constrains every write; the server rejects values outside it."
      >
        <select
          className={selectClassName}
          value={kind.kind}
          onChange={(event) =>
            changeKind(event.target.value as HelperKind['kind'])
          }
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ConfigField>

      {kind.kind === 'enum' ? (
        <ConfigField
          label="Options"
          description="Ordered options; the first is the default value."
        >
          <div className="space-y-2">
            {kind.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="text"
                  value={option}
                  onChange={(event) => {
                    const options = [...kind.options];
                    options[index] = event.target.value;
                    updateEnumOptions(options);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={kind.options.length <= 1}
                  onClick={() =>
                    updateEnumOptions(
                      kind.options.filter(
                        (_candidate, candidate) => candidate !== index,
                      ),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => updateEnumOptions([...kind.options, ''])}
            >
              Add option
            </Button>
          </div>
        </ConfigField>
      ) : null}

      {kind.kind === 'number' ? (
        <ConfigFormGrid>
          <ConfigField label="Minimum" description="Optional lower bound.">
            <Input
              step="any"
              type="number"
              value={kind.min ?? ''}
              onChange={(event) => {
                const parsed =
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value);
                setDraft({
                  ...draft,
                  kind: {
                    kind: 'number',
                    min: Number.isFinite(parsed) ? parsed : undefined,
                    max: kind.max,
                  },
                });
              }}
            />
          </ConfigField>
          <ConfigField label="Maximum" description="Optional upper bound.">
            <Input
              step="any"
              type="number"
              value={kind.max ?? ''}
              onChange={(event) => {
                const parsed =
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value);
                setDraft({
                  ...draft,
                  kind: {
                    kind: 'number',
                    min: kind.min,
                    max: Number.isFinite(parsed) ? parsed : undefined,
                  },
                });
              }}
            />
          </ConfigField>
        </ConfigFormGrid>
      ) : null}
    </div>
  );
}

export function HelperInitialValueField({
  draft,
  setDraft,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
}) {
  return (
    <ConfigField
      label="Initial value"
      description="Used at initialization and after a restart. The current value is what routines read while the app runs."
    >
      <ValueControl
        kind={draft.kind}
        value={draft.initial_value}
        onChange={(initial_value) => setDraft({ ...draft, initial_value })}
      />
    </ConfigField>
  );
}

export function HelperPersistenceFields({
  draft,
  setDraft,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
}) {
  return (
    <div className="space-y-4">
      <ConfigField
        label="Persistence"
        description="Durable values are stored in the database and survive restarts; session values reset to the initial value."
      >
        <select
          className={selectClassName}
          value={draft.persistence}
          onChange={(event) =>
            setDraft({
              ...draft,
              persistence: event.target
                .value as HelperDefinition['persistence'],
            })
          }
        >
          <option value="durable">Durable (stored in the database)</option>
          <option value="session">Session — resets on restart</option>
        </select>
      </ConfigField>
      <ConfigToggleRow
        label="Hidden"
        description="Hidden helpers stay usable but are omitted from widget pickers."
      >
        <input
          type="checkbox"
          className={checkboxClassName}
          checked={draft.hidden ?? false}
          onChange={(event) =>
            setDraft({ ...draft, hidden: event.target.checked || undefined })
          }
        />
      </ConfigToggleRow>
    </div>
  );
}
