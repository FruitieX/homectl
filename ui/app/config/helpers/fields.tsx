import type { HelperDefinition } from '@/bindings/HelperDefinition';
import type { HelperKind } from '@/bindings/HelperKind';
import { ConfigField, ConfigFormGrid, ConfigToggleRow } from '@/ui/config-form';
import { checkboxClassName } from '@/ui/form-styles';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

import {
  KIND_OPTIONS,
  ValueControl,
  defaultKind,
  invalidHelperValue,
  defaultValueForKind,
} from './shared';

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
      {isNew && (
        <ConfigField
          label="Id"
          description="The stable reference routines and scripts use; fixed once the helper exists."
        >
          <Input
            data-field="id"
            aria-label="Helper ID"
            disabled={!isNew}
            placeholder="staircase_mode"
            type="text"
            value={draft.id}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
          />
        </ConfigField>
      )}
      <ConfigField label="Name">
        <Input
          data-field="name"
          aria-label="Helper name"
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
  onKindChange,
}: {
  draft: HelperDefinition;
  setDraft: (draft: HelperDefinition) => void;
  onKindChange?: (
    next: Pick<HelperDefinition, 'kind' | 'initial_value'>,
  ) => void;
}) {
  const kind = draft.kind;

  const changeKind = (next: HelperKind['kind']) => {
    const nextKind = defaultKind(next);
    if (onKindChange) {
      onKindChange({
        kind: nextKind,
        initial_value: defaultValueForKind(nextKind),
      });
      return;
    }
    setDraft({
      ...draft,
      kind: nextKind,
      initial_value: defaultValueForKind(nextKind),
    });
  };

  const updateEnumOptions = (options: string[]) => {
    const nextKind: HelperKind =
      kind.kind === 'enum' ? { ...kind, options } : kind;
    setDraft({
      ...draft,
      kind: nextKind,
    });
  };

  return (
    <div className="space-y-4">
      <ConfigField
        label="Type"
        description="The declared type constrains every write; the server rejects values outside it."
      >
        <SettingsSelect
          data-field="kind"
          aria-label="Helper type"
          value={kind.kind}
          onValueChange={(next) => changeKind(next as HelperKind['kind'])}
          options={KIND_OPTIONS}
        />
      </ConfigField>

      {kind.kind === 'enum' ? (
        <ConfigField
          label="Options"
          description="Ordered choices. Choose the initial value below."
        >
          <div className="space-y-2">
            {kind.options.map((option, index) => (
              <div key={index} className="flex min-w-0 items-center gap-1">
                <Input
                  className="min-w-0 flex-1"
                  aria-label={`Option ${index + 1}`}
                  type="text"
                  value={option}
                  onChange={(event) => {
                    const options = [...kind.options];
                    options[index] = event.target.value;
                    updateEnumOptions(options);
                  }}
                />
                {[-1, 1].map((offset) => (
                  <Button
                    key={offset}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 md:size-8"
                    disabled={
                      index + offset < 0 ||
                      index + offset >= kind.options.length
                    }
                    aria-label={`Move option ${index + 1} ${offset < 0 ? 'up' : 'down'}`}
                    onClick={() => {
                      const options = [...kind.options];
                      [options[index], options[index + offset]] = [
                        options[index + offset],
                        options[index],
                      ];
                      updateEnumOptions(options);
                    }}
                  >
                    {offset < 0 ? <ArrowUp /> : <ArrowDown />}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive hover:text-destructive md:size-8"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() =>
                    updateEnumOptions(
                      kind.options.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    )
                  }
                >
                  <Trash2 />
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
              aria-label="Minimum"
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
                    ...kind,
                    min: Number.isFinite(parsed) ? parsed : undefined,
                    max: kind.max,
                  },
                });
              }}
            />
          </ConfigField>
          <ConfigField label="Maximum" description="Optional upper bound.">
            <Input
              aria-label="Maximum"
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
                    ...kind,
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
      description="Used when there is no stored value, or after a restart for session helpers."
    >
      <div data-field="initial_value" tabIndex={-1}>
        <ValueControl
          kind={draft.kind}
          ariaLabel="Initial value"
          value={draft.initial_value}
          onChange={(initial_value) => setDraft({ ...draft, initial_value })}
        />
        {invalidHelperValue(draft.kind, draft.initial_value) && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {invalidHelperValue(draft.kind, draft.initial_value)}
          </p>
        )}
      </div>
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
        <SettingsSelect
          aria-label="Persistence"
          value={draft.persistence}
          onValueChange={(next) =>
            setDraft({
              ...draft,
              persistence: next as HelperDefinition['persistence'],
            })
          }
          options={[
            { value: 'durable', label: 'Durable (stored in the database)' },
            { value: 'session', label: 'Session — resets on restart' },
          ]}
        />
      </ConfigField>
      <ConfigToggleRow
        label="Hidden"
        description="Hidden helpers stay usable. New widgets won’t offer them; existing selections are kept."
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
