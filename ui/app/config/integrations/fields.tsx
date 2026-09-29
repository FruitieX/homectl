import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { IntegrationConfigFieldSchema } from '@/hooks/useConfig';
import type { DeviceColor } from '@/bindings/DeviceColor';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { JsonValueEditor } from '@/ui/settings/JsonValueEditor';
import { SceneColorControl } from '@/ui/settings/SceneColorControl';
import {
  readConfigPath,
  writeConfigPath,
  integrationMode,
  integrationFieldVisible,
} from '@/lib/integrationDraft';
import { entityDraftStore } from '@/lib/entityDraft';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function StringEntries({
  value,
  onChange,
  label,
  draftKey,
  path,
}: {
  draftKey: string;
  path: string;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  if (
    value !== undefined &&
    value !== null &&
    (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
  )
    return (
      <JsonValueEditor
        value={value}
        onChange={onChange}
        label={label}
        draftKey={draftKey}
        path={path}
        allowUnset
      />
    );
  const entries = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <div className="flex min-w-0 items-center gap-1" key={index}>
          <Input
            aria-label={`${label} ${index + 1}`}
            className="min-w-0 flex-1"
            value={entry}
            onChange={(event) =>
              onChange(
                entries.map((item, i) =>
                  i === index ? event.target.value : item,
                ),
              )
            }
          />
          {[-1, 1].map((offset) => (
            <Button
              key={offset}
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index + offset < 0 || index + offset >= entries.length}
              aria-label={`${offset < 0 ? 'Move earlier' : 'Move later'} ${label} ${index + 1}`}
              onClick={() => {
                const next = [...entries];
                [next[index], next[index + offset]] = [
                  next[index + offset],
                  next[index],
                ];
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
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(entries.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, ''])}
      >
        <Plus className="size-3" />
        Add entry
      </Button>
    </div>
  );
}
export function CapabilitiesFields({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const data = record(value),
    temperature = record(data.ct);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['brightness', 'Dimming'],
          ['hs', 'Hue & saturation'],
          ['xy', 'XY color'],
          ['rgb', 'RGB color'],
        ].map(([key, label]) => (
          <label className="grid gap-2 text-xs" key={key}>
            {label}
            <select
              className="settings-select"
              value={data[key] == null ? 'default' : String(data[key])}
              onChange={(event) =>
                onChange(
                  writeConfigPath(
                    data,
                    key,
                    event.target.value === 'default'
                      ? undefined
                      : event.target.value === 'true',
                  ),
                )
              }
            >
              <option value="default">Not specified</option>
              <option value="true">Supported</option>
              <option value="false">Not supported</option>
            </select>
          </label>
        ))}
      </div>
      <label className="grid gap-2 text-xs">
        Color temperature
        <select
          className="settings-select"
          value={
            data.ct === undefined
              ? 'default'
              : data.ct === null
                ? 'none'
                : 'range'
          }
          onChange={(event) =>
            onChange({
              ...data,
              ct:
                event.target.value === 'default'
                  ? undefined
                  : event.target.value === 'none'
                    ? null
                    : { start: 2000, end: 6500 },
            })
          }
        >
          <option value="default">Not specified</option>
          <option value="none">Not supported</option>
          <option value="range">Supported range</option>
        </select>
      </label>
      {data.ct != null && (
        <div className="grid grid-cols-2 gap-3">
          {[
            ['start', 'Minimum kelvin'],
            ['end', 'Maximum kelvin'],
          ].map(([key, label]) => (
            <label className="grid gap-2 text-xs" key={key}>
              {label}
              <Input
                type="number"
                min={1}
                value={
                  typeof temperature[key] === 'number' ? temperature[key] : ''
                }
                onChange={(event) =>
                  onChange({
                    ...data,
                    ct: { ...temperature, [key]: Number(event.target.value) },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function DummyDevices({
  value,
  onChange,
  draftKey,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  draftKey: string;
}) {
  const [id, setId] = useState(''),
    data = record(value);
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([id, value]) => {
        const slot = `dummy/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        const entry = record(value),
          initial = record(entry.init_state),
          controllable = record(initial.Controllable),
          sensor = record(initial.Sensor),
          state = record(controllable.state);
        const kind =
          entry.init_state === undefined
            ? 'default'
            : Object.hasOwn(initial, 'Controllable')
              ? 'controllable'
              : Object.hasOwn(initial, 'Sensor')
                ? 'sensor'
                : 'unknown';
        const patch = (next: Record<string, unknown>) =>
          onChange({ ...data, [id]: { ...entry, ...next } });
        return (
          <article
            className="space-y-3 rounded-md border border-border p-3"
            key={id}
          >
            <header className="flex items-center justify-between gap-2">
              <code className="min-w-0 break-all text-xs">{id}</code>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove device ${id}`}
                onClick={() => {
                  entityDraftStore.remapEditorPaths(draftKey, (path) =>
                    path === slot || path.startsWith(slot + '/') ? null : path,
                  );
                  onChange(
                    Object.fromEntries(
                      Object.entries(data).filter(([key]) => key !== id),
                    ),
                  );
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </header>
            <label className="grid gap-2 text-xs">
              Device name
              <Input
                value={typeof entry.name === 'string' ? entry.name : ''}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="grid gap-2 text-xs">
              Initial device type
              <select
                className="settings-select"
                value={kind}
                onChange={(event) => {
                  const next = event.target.value;
                  patch({
                    init_state: entityDraftStore.switchVariant(
                      draftKey,
                      slot,
                      kind,
                      entry.init_state,
                      next,
                      next === 'default'
                        ? undefined
                        : next === 'sensor'
                          ? { Sensor: { value: false } }
                          : {
                              Controllable: {
                                state: { power: false },
                                capabilities: {},
                                managed: 'Full',
                              },
                            },
                    ),
                  });
                }}
              >
                <option value="default">Default light</option>
                <option value="controllable">
                  Configured light or control
                </option>
                <option value="sensor">Sensor</option>
                {kind === 'unknown' && (
                  <option value="unknown">Unrecognized type</option>
                )}
              </select>
            </label>
            {kind === 'controllable' ? (
              <>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={state.power === true}
                    onChange={(event) =>
                      patch({
                        init_state: {
                          ...initial,
                          Controllable: {
                            ...controllable,
                            state: { ...state, power: event.target.checked },
                          },
                        },
                      })
                    }
                  />
                  Initially on
                </label>
                <label className="grid gap-2 text-xs">
                  Initial brightness (%)
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      typeof state.brightness === 'number'
                        ? state.brightness * 100
                        : ''
                    }
                    placeholder="Not specified"
                    onChange={(event) =>
                      patch({
                        init_state: {
                          ...initial,
                          Controllable: {
                            ...controllable,
                            state: {
                              ...state,
                              brightness:
                                event.target.value === ''
                                  ? undefined
                                  : Number(event.target.value) / 100,
                            },
                          },
                        },
                      })
                    }
                  />
                </label>
                <SceneColorControl
                  color={state.color as DeviceColor | undefined}
                  brightness={state.brightness as number | undefined}
                  field={`config.devices.${id}.color`}
                  onChange={(color) =>
                    patch({
                      init_state: {
                        ...initial,
                        Controllable: {
                          ...controllable,
                          state: { ...state, color },
                        },
                      },
                    })
                  }
                />
                <CapabilitiesFields
                  value={controllable.capabilities}
                  onChange={(capabilities) =>
                    patch({
                      init_state: {
                        ...initial,
                        Controllable: { ...controllable, capabilities },
                      },
                    })
                  }
                />
                <details className="text-xs">
                  <summary className="cursor-pointer">
                    Other initial state fields
                  </summary>
                  <JsonValueEditor
                    value={controllable}
                    label="Controllable device"
                    draftKey={draftKey}
                    path={`${slot}/data`}
                    onChange={(Controllable) =>
                      patch({ init_state: { ...initial, Controllable } })
                    }
                  />
                </details>
              </>
            ) : kind === 'sensor' ? (
              <JsonValueEditor
                value={sensor}
                label="Initial sensor fields"
                draftKey={draftKey}
                path={`${slot}/sensor`}
                onChange={(Sensor) =>
                  patch({ init_state: { ...initial, Sensor } })
                }
              />
            ) : kind === 'unknown' ? (
              <JsonValueEditor
                value={entry.init_state}
                label="Initial state"
                draftKey={draftKey}
                path={`${slot}/initial`}
                onChange={(init_state) => patch({ init_state })}
              />
            ) : null}
          </article>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="New device ID"
          value={id}
          placeholder="Device ID"
          className="min-w-0 flex-1"
          onChange={(event) => setId(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!id.trim() || Object.hasOwn(data, id)}
          onClick={() => {
            onChange({ ...data, [id]: { name: id } });
            setId('');
          }}
        >
          <Plus className="size-4" />
          Add device
        </Button>
      </div>
      {Object.hasOwn(data, id) && (
        <p className="text-xs text-destructive">
          This device ID already exists.
        </p>
      )}
    </div>
  );
}
export function IntegrationField({
  field,
  config,
  onChange,
  draftKey,
  plugin,
  storedSecret,
}: {
  field: IntegrationConfigFieldSchema;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  draftKey: string;
  plugin: string;
  storedSecret: boolean;
}) {
  const value = readConfigPath(config, field.key),
    update = (value: unknown) =>
      onChange(writeConfigPath(config, field.key, value));
  let control;
  if (
    field.key === 'sensor_value_fields' ||
    field.key === 'disabled_device_ids'
  )
    control = (
      <StringEntries
        draftKey={draftKey}
        path={`config/${field.key}`}
        value={value}
        onChange={update}
        label={field.label}
      />
    );
  else if (field.key === 'brightness_range' || field.key === 'transition_range')
    control = (
      <div className="grid grid-cols-2 gap-3">
        {['Minimum', 'Maximum'].map((label, index) => (
          <label key={label} className="grid gap-2 text-xs">
            {label}
            <Input
              type="number"
              step="any"
              value={Array.isArray(value) ? (value[index] ?? '') : ''}
              placeholder={
                Array.isArray(field.default_value)
                  ? String(field.default_value[index])
                  : ''
              }
              onChange={(event) => {
                const next = Array.isArray(value)
                  ? [...value]
                  : [undefined, undefined];
                next[index] =
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value);
                update(next);
              }}
            />
          </label>
        ))}
      </div>
    );
  else if (field.key === 'capabilities_override')
    control = <CapabilitiesFields value={value} onChange={update} />;
  else if (field.key === 'devices' && plugin === 'dummy')
    control = (
      <DummyDevices value={value} onChange={update} draftKey={draftKey} />
    );
  else if (field.kind === 'json')
    control = (
      <JsonValueEditor
        value={value}
        label={field.label}
        onChange={update}
        draftKey={draftKey}
        path={`config/${field.key}`}
        allowUnset={!field.required}
      />
    );
  else if (field.kind === 'color')
    control = (
      <SceneColorControl
        color={value as DeviceColor | undefined}
        field={`config.${field.key}`}
        onChange={update}
      />
    );
  else if (field.kind === 'select') {
    const options = field.options ?? [],
      effective =
        field.key === 'mode' && plugin === 'mqtt'
          ? integrationMode(config)
          : value;
    const index = options.findIndex(
      (option) => JSON.stringify(option.value) === JSON.stringify(effective),
    );
    control = (
      <>
        <select
          className="settings-select"
          aria-label={field.label}
          value={
            effective === undefined
              ? 'unset'
              : field.key === 'managed' &&
                  effective !== null &&
                  typeof effective === 'object' &&
                  'Partial' in effective
                ? 'partial'
                : index < 0
                  ? 'unknown'
                  : String(index)
          }
          onChange={(event) => {
            if (event.target.value === 'unset') update(undefined);
            else if (event.target.value === 'partial')
              update({ Partial: { prev_change_committed: true } });
            else update(options[Number(event.target.value)].value);
          }}
        >
          {!field.required && <option value="unset">Use default</option>}
          {field.required && effective === undefined && (
            <option value="unset">Choose…</option>
          )}
          {options.map((option, index) => (
            <option key={index} value={index}>
              {option.label}
            </option>
          ))}
          {field.key === 'managed' && (
            <option value="partial">Partial management</option>
          )}
          {effective !== undefined && index < 0 && (
            <option value="unknown">
              {typeof effective === 'string' ? effective : 'Custom setting'}
            </option>
          )}
        </select>
        {field.key === 'managed' &&
          typeof value === 'object' &&
          value !== null &&
          'Partial' in value && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={
                  record(record(value).Partial).prev_change_committed === true
                }
                onChange={(event) =>
                  update({
                    ...record(value),
                    Partial: {
                      ...record(record(value).Partial),
                      prev_change_committed: event.target.checked,
                    },
                  })
                }
              />
              Previous change committed
            </label>
          )}
      </>
    );
  } else if (field.kind === 'boolean')
    control = (
      <select
        aria-label={field.label}
        className="settings-select"
        value={
          value === undefined
            ? 'unset'
            : value === null
              ? 'null'
              : String(value)
        }
        onChange={(event) =>
          update(
            event.target.value === 'unset'
              ? undefined
              : event.target.value === 'true',
          )
        }
      >
        <option value="unset">
          Use default
          {field.default_value != null
            ? ` (${field.default_value ? 'on' : 'off'})`
            : ''}
        </option>
        {value === null && <option value="null">None (stored)</option>}
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  else if (field.kind === 'password')
    control = (
      <div className="space-y-2">
        <Input
          aria-label={field.label}
          type="password"
          autoComplete="new-password"
          value={typeof value === 'string' ? value : ''}
          placeholder={storedSecret ? 'Stored · enter to replace' : 'Not set'}
          onChange={(event) => update(event.target.value || undefined)}
        />
        <p className="text-xs text-muted-foreground">
          {value === ''
            ? 'Stored password will be cleared when you save.'
            : value === undefined
              ? storedSecret
                ? 'Stored password is kept unless replaced or cleared.'
                : 'No password stored.'
              : 'Replacement will be used when you save.'}
        </p>
        {storedSecret && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void confirmDialog({
                title: 'Clear the stored password?',
                description:
                  'The password will be removed when you save this integration.',
                confirmLabel: 'Clear password',
              }).then((confirmed) => {
                if (confirmed) update('');
              })
            }
          >
            Clear stored password
          </Button>
        )}
      </div>
    );
  else
    control = (
      <Input
        aria-label={field.label}
        type={field.kind === 'number' ? 'number' : 'text'}
        step={field.step ?? undefined}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        value={
          typeof value === 'string' || typeof value === 'number' ? value : ''
        }
        placeholder={
          field.placeholder ??
          (field.default_value != null
            ? String(field.default_value)
            : undefined)
        }
        onChange={(event) =>
          update(
            event.target.value === ''
              ? undefined
              : field.kind === 'number'
                ? Number(event.target.value)
                : event.target.value,
          )
        }
      />
    );
  return (
    <div
      className={`min-w-0 space-y-2 ${field.kind === 'json' ? 'sm:col-span-2' : ''}`}
      data-field={`config.${field.key}`}
      tabIndex={-1}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium">
          {field.label}
          {field.required ? ' *' : ''}
        </h3>
        {!field.required &&
          value !== undefined &&
          field.kind !== 'password' && (
            <Button
              className="ml-auto h-7 px-2 text-xs"
              size="sm"
              variant="ghost"
              onClick={() => update(undefined)}
            >
              Use default
            </Button>
          )}
      </div>
      {control}
      {!integrationFieldVisible(field, config) && (
        <p className="text-xs text-amber-700">
          Stored for another MQTT profile. Changing the profile keeps this
          value.
        </p>
      )}
      {field.description && (
        <p className="text-xs text-muted-foreground">
          {field.description
            .replace(/^JSON (array|object) /, '')
            .replace('JSON pointer', 'Value path')}
        </p>
      )}
    </div>
  );
}
