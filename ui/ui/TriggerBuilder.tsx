import type { BacklogPolicy } from '@/bindings/BacklogPolicy';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { RawRuleOperator } from '@/bindings/RawRuleOperator';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { ScheduleSpec } from '@/bindings/ScheduleSpec';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import { DurationInput, selectClassName } from '@/ui/builder-fields';
import { DeviceSelect, GroupSelect, splitDeviceKey } from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import {
  StatusBadge,
  formatDue,
  formatUnknownReason,
  triggerBadge,
} from '@/ui/routine-runtime';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';

type TriggerKind = TriggerSpec['kind'];

const triggerKindOptions: Array<{ value: TriggerKind; label: string }> = [
  { value: 'schedule', label: 'Schedule (cron or interval)' },
  { value: 'state_change', label: 'Device state change' },
  { value: 'report', label: 'Device report' },
  { value: 'predicate_for', label: 'Predicate held for a duration' },
  { value: 'predicate_transition', label: 'Predicate becomes true' },
  { value: 'timer_fired', label: 'Named timer fires' },
  { value: 'startup', label: 'On startup' },
  { value: 'manual', label: 'Manual only' },
];

const triggerKindLabels: Record<TriggerKind, string> = {
  schedule: 'Schedule',
  state_change: 'State change',
  report: 'Report',
  predicate_for: 'Predicate held',
  predicate_transition: 'Predicate becomes true',
  timer_fired: 'Timer fires',
  startup: 'Startup',
  manual: 'Manual',
};

const operatorOptions: Array<{ value: RawRuleOperator; label: string }> = [
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

const operatorsWithoutValue = new Set<RawRuleOperator>(['exists', 'truthy']);

const sensorPathSuggestions = [
  '/value',
  '/observed',
  '/observed/value',
  '/availability/online',
  '/last_report/value',
  '/name',
];

const controllablePathSuggestions = [
  '/power',
  '/brightness',
  '/color',
  '/scene_id',
  '/observed',
  '/observed/power',
  '/availability/online',
  '/name',
];

const timezoneSuggestions = [
  'UTC',
  'Europe/Helsinki',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Tokyo',
];

function defaultTrigger(kind: TriggerKind, id: string): TriggerSpec {
  const emptyDevice = { integration_id: '', device_id: '' };

  switch (kind) {
    case 'schedule':
      return {
        kind: 'schedule',
        id,
        schedule: { backlog: 'skip' },
      };
    case 'state_change':
      return { kind: 'state_change', id, device: emptyDevice, mode: 'transition' };
    case 'report':
      return { kind: 'report', id, device: emptyDevice };
    case 'predicate_for':
      // u64 fields are bigint in the generated bindings but plain numbers in
      // JSON; the editor keeps numbers and casts so serialization works.
      return {
        kind: 'predicate_for',
        id,
        predicate: { kind: 'literal', value: true },
        duration_ms: 300_000,
      } as unknown as TriggerSpec;
    case 'predicate_transition':
      return {
        kind: 'predicate_transition',
        id,
        predicate: { kind: 'literal', value: true },
      };
    case 'timer_fired':
      return { kind: 'timer_fired', id, timer: 'timer' };
    case 'startup':
      return { kind: 'startup', id };
    case 'manual':
      return { kind: 'manual', id };
  }
}

function ComparisonValueEditor({
  operator,
  value,
  onChange,
}: {
  operator: RawRuleOperator;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (operatorsWithoutValue.has(operator)) {
    return null;
  }

  const valueType =
    typeof value === 'number'
      ? 'number'
      : typeof value === 'boolean'
        ? 'boolean'
        : 'text';

  return (
    <>
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
      <ConfigField label="Value">
        {valueType === 'boolean' ? (
          <select
            className={selectClassName}
            value={value === true ? 'true' : 'false'}
            onChange={(event) => onChange(event.target.value === 'true')}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        ) : valueType === 'number' ? (
          <Input
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
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </ConfigField>
    </>
  );
}

function PredicateEditor({
  predicate,
  onChange,
  devices,
  groups,
  scenes,
}: {
  predicate: ConditionExpr;
  onChange: (predicate: ConditionExpr) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
}) {
  if (predicate.kind === 'group') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <ConfigField label="Group">
          <GroupSelect
            groups={groups}
            value={predicate.group_id}
            onChange={(group_id) => onChange({ ...predicate, group_id })}
          />
        </ConfigField>
        <ConfigField label="Quantifier">
          <select
            className={selectClassName}
            value={predicate.quantifier}
            onChange={(event) =>
              onChange({
                ...predicate,
                quantifier: event.target.value as typeof predicate.quantifier,
              })
            }
          >
            <option value="all">All members</option>
            <option value="any">Any member</option>
            <option value="none">No member</option>
            <option value="partial">Partially</option>
          </select>
        </ConfigField>
        <ConfigField label="Power">
          <select
            className={selectClassName}
            value={
              predicate.power === undefined
                ? 'any'
                : predicate.power
                  ? 'on'
                  : 'off'
            }
            onChange={(event) => {
              const next = event.target.value;
              onChange({
                ...predicate,
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
            value={predicate.scene ?? ''}
            onChange={(event) =>
              onChange({
                ...predicate,
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
    );
  }

  if (predicate.kind === 'comparison' && predicate.source.kind === 'device') {
    const { device, path } = predicate.source;
    const deviceKey =
      device.integration_id && device.device_id
        ? `${device.integration_id}/${device.device_id}`
        : '';
    const deviceData = deviceKey ? devices[deviceKey]?.data : undefined;
    const pathSuggestions = deviceData
      ? 'Sensor' in deviceData
        ? sensorPathSuggestions
        : controllablePathSuggestions
      : sensorPathSuggestions;

    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <ConfigField label="Device">
          <DeviceSelect
            devices={devices}
            value={deviceKey}
            onChange={(key) =>
              onChange({
                ...predicate,
                source: {
                  kind: 'device',
                  device: splitDeviceKey(key) ?? {
                    integration_id: '',
                    device_id: '',
                  },
                  path,
                },
              })
            }
          />
        </ConfigField>
        <ConfigField
          label="Value path"
          description="JSON pointer into the device state, for example /power or /value."
        >
          <Input
            list={
              pathSuggestions === sensorPathSuggestions
                ? 'v2-sensor-paths'
                : 'v2-controllable-paths'
            }
            value={path}
            placeholder="/value"
            onChange={(event) =>
              onChange({
                ...predicate,
                source: {
                  kind: 'device',
                  device,
                  path: event.target.value,
                },
              })
            }
          />
        </ConfigField>
        <ConfigField label="Operator">
          <select
            className={selectClassName}
            value={predicate.operator}
            onChange={(event) =>
              onChange({
                ...predicate,
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
          operator={predicate.operator}
          value={predicate.value}
          onChange={(value) =>
            onChange({ ...predicate, value: value as JsonValue | undefined })
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-border bg-muted/30 p-3">
      <p className="text-sm text-muted-foreground">
        This predicate uses nested logic or a helper/computed source. Edit it
        in the Definition JSON tab, or replace it with a simple condition.
      </p>
      <pre className="overflow-x-auto text-xs">
        {JSON.stringify(predicate, null, 2)}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            kind: 'comparison',
            source: {
              kind: 'device',
              device: { integration_id: '', device_id: '' },
              path: '/value',
            },
            operator: 'eq',
            value: true,
          })
        }
      >
        Replace with a simple condition
      </Button>
    </div>
  );
}

function TriggerFields({
  trigger,
  onChange,
  devices,
  groups,
  scenes,
}: {
  trigger: TriggerSpec;
  onChange: (trigger: TriggerSpec) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
}) {
  switch (trigger.kind) {
    case 'schedule': {
      const schedule = trigger.schedule;
      const mode = schedule.cron !== undefined ? 'cron' : 'every';

      return (
        <div className="space-y-4">
          <ConfigField label="Schedule type">
            <select
              className={selectClassName}
              value={mode}
              onChange={(event) => {
                if (event.target.value === 'cron') {
                  onChange({
                    ...trigger,
                    schedule: { ...schedule, cron: schedule.cron ?? '', every_ms: undefined },
                  });
                } else {
                  onChange({
                    ...trigger,
                    schedule: {
                      ...schedule,
                      every_ms: 3_600_000,
                      cron: undefined,
                    },
                  } as unknown as TriggerSpec);
                }
              }}
            >
              <option value="cron">Calendar (cron)</option>
              <option value="every">Fixed interval</option>
            </select>
          </ConfigField>

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'cron' ? (
              <ConfigField
                label="Cron expression"
                description="Six fields: second minute hour day-of-month month day-of-week."
              >
                <Input
                  className="font-mono"
                  value={schedule.cron ?? ''}
                  placeholder="0 0 8 * * *"
                  onChange={(event) =>
                    onChange({
                      ...trigger,
                      schedule: { ...schedule, cron: event.target.value },
                    })
                  }
                />
              </ConfigField>
            ) : (
              <ConfigField label="Every">
                <DurationInput
                  valueMs={
                    schedule.every_ms === undefined
                      ? undefined
                      : Number(schedule.every_ms)
                  }
                  onChange={(every_ms) =>
                    onChange({
                      ...trigger,
                      schedule: { ...schedule, every_ms },
                    } as unknown as TriggerSpec)
                  }
                />
              </ConfigField>
            )}

            <ConfigField
              label="Timezone"
              description="IANA zone for calendar schedules; intervals ignore it."
            >
              <Input
                list="v2-timezones"
                value={schedule.timezone ?? ''}
                placeholder="Europe/Helsinki"
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    schedule: {
                      ...schedule,
                      timezone: event.target.value || undefined,
                    },
                  })
                }
              />
            </ConfigField>

            <ConfigField label="Missed occurrences">
              <select
                className={selectClassName}
                value={schedule.backlog}
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    schedule: {
                      ...schedule,
                      backlog: event.target.value as BacklogPolicy,
                    },
                  })
                }
              >
                <option value="skip">Skip</option>
                <option value="catch_up_once">Run once on catch-up</option>
              </select>
            </ConfigField>

            {schedule.backlog === 'catch_up_once' ? (
              <ConfigField
                label="Catch-up lateness"
                description="A catch-up older than this is dropped."
              >
                <DurationInput
                  valueMs={
                    schedule.catch_up_lateness_ms === undefined
                      ? undefined
                      : Number(schedule.catch_up_lateness_ms)
                  }
                  onChange={(catch_up_lateness_ms) =>
                    onChange({
                      ...trigger,
                      schedule: { ...schedule, catch_up_lateness_ms },
                    } as unknown as TriggerSpec)
                  }
                />
              </ConfigField>
            ) : null}
          </div>
        </div>
      );
    }

    case 'state_change':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigField label="Device">
            <DeviceSelect
              devices={devices}
              value={
                trigger.device.integration_id && trigger.device.device_id
                  ? `${trigger.device.integration_id}/${trigger.device.device_id}`
                  : ''
              }
              onChange={(key) =>
                onChange({
                  ...trigger,
                  device: splitDeviceKey(key) ?? {
                    integration_id: '',
                    device_id: '',
                  },
                })
              }
            />
          </ConfigField>
          <ConfigField label="Mode">
            <select
              className={selectClassName}
              value={trigger.mode}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  mode: event.target.value as typeof trigger.mode,
                })
              }
            >
              <option value="transition">Transition (false to true)</option>
              <option value="level">Level (while true)</option>
            </select>
          </ConfigField>
        </div>
      );

    case 'report':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigField label="Device">
            <DeviceSelect
              devices={devices}
              value={
                trigger.device.integration_id && trigger.device.device_id
                  ? `${trigger.device.integration_id}/${trigger.device.device_id}`
                  : ''
              }
              onChange={(key) =>
                onChange({
                  ...trigger,
                  device: splitDeviceKey(key) ?? {
                    integration_id: '',
                    device_id: '',
                  },
                })
              }
            />
          </ConfigField>
          <ConfigField
            label="Field"
            description="Optional report field to match; leave empty for any report."
          >
            <Input
              value={trigger.field ?? ''}
              placeholder="temperature"
              onChange={(event) =>
                onChange({
                  ...trigger,
                  field: event.target.value || undefined,
                })
              }
            />
          </ConfigField>
        </div>
      );

    case 'predicate_transition':
    case 'predicate_for':
      return (
        <div className="space-y-4">
          <PredicateEditor
            predicate={trigger.predicate}
            onChange={(predicate) => onChange({ ...trigger, predicate })}
            devices={devices}
            groups={groups}
            scenes={scenes}
          />
          {trigger.kind === 'predicate_for' ? (
            <ConfigField
              label="Held for"
              description="Fires after the predicate stays true this long."
            >
              <DurationInput
                valueMs={Number(trigger.duration_ms)}
                onChange={(duration_ms) =>
                  onChange({ ...trigger, duration_ms } as unknown as TriggerSpec)
                }
              />
            </ConfigField>
          ) : null}
        </div>
      );

    case 'timer_fired':
      return (
        <ConfigField
          label="Timer name"
          description="Fires when this routine's named timer reaches its deadline."
        >
          <Input
            className="font-mono"
            value={trigger.timer}
            placeholder="off"
            onChange={(event) =>
              onChange({ ...trigger, timer: event.target.value })
            }
          />
        </ConfigField>
      );

    case 'startup':
    case 'manual':
      return (
        <p className="text-sm text-muted-foreground">
          {trigger.kind === 'startup'
            ? 'Fires once when the server starts.'
            : 'Fires only from explicit invocations.'}
        </p>
      );
  }
}

export function TriggerBuilder({
  triggers,
  onChange,
  devices,
  groups,
  scenes,
  runtimeStatus,
}: {
  triggers: TriggerSpec[];
  onChange: (triggers: TriggerSpec[]) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  runtimeStatus?: RoutineRuntimeStatus;
}) {
  const [newKind, setNewKind] = useState<TriggerKind>('schedule');
  const [now, setNow] = useState(() => Date.now());
  const liveTriggers = runtimeStatus?.v2?.triggers ?? [];
  const hasArmed = liveTriggers.some(
    (trigger) => trigger.armed && trigger.due_wall_ms !== undefined,
  );
  useInterval(() => setNow(Date.now()), hasArmed ? 15000 : null);

  const addTrigger = () => {
    let index = triggers.length + 1;
    let id = `${newKind}_${index}`;
    while (triggers.some((trigger) => trigger.id === id)) {
      index += 1;
      id = `${newKind}_${index}`;
    }
    onChange([...triggers, defaultTrigger(newKind, id)]);
  };

  return (
    <div className="space-y-4">
      <datalist id="v2-sensor-paths">
        {sensorPathSuggestions.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <datalist id="v2-controllable-paths">
        {controllablePathSuggestions.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <datalist id="v2-timezones">
        {timezoneSuggestions.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-end gap-3">
        <ConfigField label="Add trigger" className="min-w-64">
          <select
            className={selectClassName}
            value={newKind}
            onChange={(event) => setNewKind(event.target.value as TriggerKind)}
          >
            {triggerKindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </ConfigField>
        <Button type="button" variant="outline" size="sm" onClick={addTrigger}>
          Add trigger
        </Button>
      </div>

      {triggers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No triggers yet. Add one above; the routine only runs when a trigger
          fires and its condition holds.
        </div>
      ) : (
        triggers.map((trigger, index) => {
          const live = liveTriggers.find(
            (status) => status.trigger_id === trigger.id,
          );
          const badge = live ? triggerBadge(live) : null;
          const duplicateId =
            triggers.filter((other) => other.id === trigger.id).length > 1;

          return (
            <Card key={`${trigger.id}:${index}`} className="rounded-2xl">
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge kind={trigger.kind} />
                      {badge ? (
                        <StatusBadge label={badge.label} tone={badge.tone} />
                      ) : null}
                      {live?.armed && live.due_wall_ms !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          Next fire {formatDue(Number(live.due_wall_ms), now)}
                        </span>
                      ) : null}
                    </div>
                    <ConfigField label="Trigger ID" className="max-w-md">
                      <Input
                        className="font-mono"
                        value={trigger.id}
                        onChange={(event) =>
                          onChange(
                            triggers.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? ({ ...candidate, id: event.target.value } as TriggerSpec)
                                : candidate,
                            ),
                          )
                        }
                      />
                    </ConfigField>
                    {duplicateId ? (
                      <p className="text-xs text-destructive">
                        Trigger IDs must be unique within the routine.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() =>
                      onChange(
                        triggers.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>

                <TriggerFields
                  trigger={trigger}
                  onChange={(next) =>
                    onChange(
                      triggers.map((candidate, candidateIndex) =>
                        candidateIndex === index ? next : candidate,
                      ),
                    )
                  }
                  devices={devices}
                  groups={groups}
                  scenes={scenes}
                />

                {live?.error ? (
                  <p className="text-sm text-destructive">{live.error}</p>
                ) : null}
                {live?.unknown_reason ? (
                  <p className="text-sm text-muted-foreground">
                    Unknown: {formatUnknownReason(live.unknown_reason)}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Badge({ kind }: { kind: TriggerKind }) {
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {triggerKindLabels[kind]}
    </span>
  );
}
