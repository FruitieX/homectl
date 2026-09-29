import { Clock, Radio, Timer, Hand, Zap } from 'lucide-react';
import {
  FlowBlock,
  AddFlowBlock,
  UnknownFlowValue,
  useRoutineAuthoring,
} from '@/ui/settings/FlowBlock';
import { createUuid } from '@/lib/uuid';
import { moveSibling } from '@/lib/routineDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import type { BacklogPolicy } from '@/bindings/BacklogPolicy';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { ScheduleSpec } from '@/bindings/ScheduleSpec';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import { useSchedulePreview } from '@/hooks/useConfig';
import { DurationInput } from '@/ui/builder-fields';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { DeviceSelect, splitDeviceKey } from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import {
  StatusBadge,
  triggerBadge,
  triggerStateSentence,
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
      return {
        kind: 'state_change',
        id,
        device: emptyDevice,
        mode: 'transition',
      };
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

function occurrenceFormatter(zone: string) {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return (wallMs: number) => formatter.format(new Date(wallMs));
  } catch {
    return (wallMs: number) => new Date(wallMs).toLocaleString();
  }
}

function SchedulePreviewPanel({
  schedule,
  occurrences,
  error,
  pending,
}: {
  schedule: ScheduleSpec;
  occurrences: number[] | null;
  error: string | null;
  pending: boolean;
}) {
  const zone = schedule.timezone || 'UTC';
  const format = occurrenceFormatter(zone);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (occurrences === null) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {pending
          ? 'Checking schedule...'
          : 'Set a cron expression or interval to preview fire times.'}
      </div>
    );
  }

  if (occurrences.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No upcoming occurrences.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
      <p className="font-medium text-muted-foreground">
        Next occurrences ({zone}){pending ? ' - updating...' : ''}
      </p>
      <ul className="mt-1 space-y-0.5">
        {occurrences.map((occurrence) => (
          <li key={occurrence} className="font-mono">
            {format(occurrence)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TriggerFields({
  trigger,
  onChange,
  devices,
  groups,
  scenes,
  helpers,
}: {
  trigger: TriggerSpec;
  onChange: (trigger: TriggerSpec) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
}) {
  const { draftKey } = useRoutineAuthoring();
  const schedulePreview = useSchedulePreview(
    trigger.kind === 'schedule'
      ? {
          cron: trigger.schedule.cron,
          every_ms:
            trigger.schedule.every_ms === undefined
              ? undefined
              : Number(trigger.schedule.every_ms),
          timezone: trigger.schedule.timezone,
          backlog: trigger.schedule.backlog,
          catch_up_lateness_ms:
            trigger.schedule.catch_up_lateness_ms === undefined
              ? undefined
              : Number(trigger.schedule.catch_up_lateness_ms),
        }
      : null,
  );

  switch (trigger.kind) {
    case 'schedule': {
      const schedule = trigger.schedule;
      const mode = schedule.cron !== undefined ? 'cron' : 'every';

      return (
        <div className="space-y-4">
          <ConfigField label="Schedule type">
            <SettingsSelect
              aria-label="Schedule type"
              value={mode}
              options={[
                { value: 'cron', label: 'Calendar (cron)' },
                { value: 'every', label: 'Fixed interval' },
              ]}
              onValueChange={(next) => {
                const fallback = {
                  ...schedule,
                  cron: next === 'cron' ? '' : undefined,
                  every_ms: next === 'every' ? 3_600_000 : undefined,
                  backlog: 'skip',
                  catch_up_lateness_ms: undefined,
                } as unknown as ScheduleSpec;
                onChange({
                  ...trigger,
                  schedule: draftKey
                    ? entityDraftStore.switchVariant(
                        draftKey,
                        `trigger/${trigger.id}/schedule`,
                        mode,
                        schedule,
                        next,
                        fallback,
                      )
                    : fallback,
                });
              }}
            />
          </ConfigField>

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'cron' ? (
              <ConfigField
                label="Cron expression"
                description="Six fields: second minute hour day-of-month month day-of-week."
              >
                <Input
                  aria-label="Cron expression"
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
                  label="Interval"
                  draftKey={draftKey}
                  path={`trigger/${trigger.id}/schedule/every/duration`}
                  required
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
                aria-label="Schedule timezone"
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

            {mode === 'cron' && (
              <ConfigField label="Missed occurrences">
                <SettingsSelect
                  aria-label="Missed occurrences"
                  value={schedule.backlog}
                  options={[
                    { value: 'skip', label: 'Skip' },
                    { value: 'catch_up_once', label: 'Run once on catch-up' },
                  ]}
                  onValueChange={(next) => {
                    const fallback = {
                      backlog: next as BacklogPolicy,
                      catch_up_lateness_ms: undefined,
                    };
                    const policy = draftKey
                      ? entityDraftStore.switchVariant(
                          draftKey,
                          `trigger/${trigger.id}/schedule/cron/backlog`,
                          schedule.backlog,
                          {
                            backlog: schedule.backlog,
                            catch_up_lateness_ms: schedule.catch_up_lateness_ms,
                          },
                          next,
                          fallback,
                        )
                      : fallback;
                    onChange({
                      ...trigger,
                      schedule: {
                        ...schedule,
                        ...policy,
                      },
                    });
                  }}
                />
              </ConfigField>
            )}

            {mode === 'cron' && schedule.backlog === 'catch_up_once' ? (
              <ConfigField
                label="Catch-up lateness"
                description="A catch-up older than this is dropped."
              >
                <DurationInput
                  label="Catch-up lateness"
                  draftKey={draftKey}
                  path={`trigger/${trigger.id}/schedule/cron/backlog/duration`}
                  required
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

          <SchedulePreviewPanel
            schedule={schedule}
            occurrences={schedulePreview.occurrences}
            error={schedulePreview.error}
            pending={schedulePreview.pending}
          />
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
            <SettingsSelect
              aria-label="State change mode"
              value={trigger.mode}
              options={[
                { value: 'transition', label: 'Transition (false to true)' },
                { value: 'level', label: 'Level (while true)' },
              ]}
              onValueChange={(mode) =>
                onChange({
                  ...trigger,
                  mode: mode as typeof trigger.mode,
                })
              }
            />
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
              aria-label="Report field"
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
          <ConditionEditor
            condition={trigger.predicate}
            onChange={(predicate) => onChange({ ...trigger, predicate })}
            devices={devices}
            groups={groups}
            scenes={scenes}
            helpers={helpers}
          />
          {trigger.kind === 'predicate_for' ? (
            <ConfigField
              label="Held for"
              description="Fires after the predicate stays true this long."
            >
              <DurationInput
                label="Held for"
                draftKey={draftKey}
                path={`trigger/${trigger.id}/predicate_for/duration`}
                required
                valueMs={Number(trigger.duration_ms)}
                onChange={(duration_ms) =>
                  onChange({
                    ...trigger,
                    duration_ms,
                  } as unknown as TriggerSpec)
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
            aria-label="Timer name"
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

/** Unique default id for a new trigger of the given kind. */
export function TriggerBuilder({
  triggers,
  onChange,
  devices,
  groups,
  scenes,
  helpers,
  runtimeStatus,
}: {
  triggers: TriggerSpec[];
  onChange: (triggers: TriggerSpec[]) => void;
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
  runtimeStatus?: RoutineRuntimeStatus;
  deviceDisplayNameMap?: Record<string, string>;
}) {
  const { draftKey } = useRoutineAuthoring();
  const [now, setNow] = useState(() => Date.now());
  const liveTriggers = runtimeStatus?.v2?.triggers ?? [];
  useInterval(
    () => setNow(Date.now()),
    liveTriggers.some((trigger) => trigger.armed) ? 15000 : null,
  );
  if (!Array.isArray(triggers)) return <UnknownFlowValue value={triggers} />;
  return (
    <div className="flow-sequence">
      <datalist id="v2-timezones">
        {timezoneSuggestions.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {triggers.map((trigger, index) => {
        if (!trigger || typeof trigger !== 'object')
          return <UnknownFlowValue key={index} value={trigger} />;
        const live = liveTriggers.find(
          (status) => status.trigger_id === trigger.id,
        );
        const badge = live ? triggerBadge(live) : null;
        const known =
          triggerKindOptions.some((option) => option.value === trigger.kind) &&
          (trigger.kind !== 'schedule' || Boolean(trigger.schedule)) &&
          (!['state_change', 'report'].includes(trigger.kind) ||
            Boolean((trigger as { device?: unknown }).device));
        const update = (next: TriggerSpec) =>
          onChange(triggers.map((entry, i) => (i === index ? next : entry)));
        return (
          <FlowBlock
            key={trigger.id || index}
            id={trigger.id}
            icon={
              trigger.kind === 'schedule' ? (
                <Clock className="size-4" />
              ) : trigger.kind === 'timer_fired' ? (
                <Timer className="size-4" />
              ) : trigger.kind === 'manual' ? (
                <Hand className="size-4" />
              ) : trigger.kind === 'report' ? (
                <Radio className="size-4" />
              ) : (
                <Zap className="size-4" />
              )
            }
            title={
              known ? (
                <SettingsSelect
                  className="settings-select w-full"
                  aria-label="Trigger type"
                  value={trigger.kind}
                  options={triggerKindOptions}
                  onValueChange={(selected) => {
                    const kind = selected as TriggerKind,
                      fallback = defaultTrigger(kind, trigger.id);
                    update(
                      draftKey
                        ? entityDraftStore.switchVariant(
                            draftKey,
                            'trigger/' + trigger.id,
                            trigger.kind,
                            trigger,
                            kind,
                            fallback,
                          )
                        : fallback,
                    );
                  }}
                />
              ) : (
                'Unrecognized trigger'
              )
            }
            index={index}
            total={triggers.length}
            onMove={(offset) => onChange(moveSibling(triggers, index, offset))}
            onRemove={() => {
              if (draftKey)
                entityDraftStore.remapEditorPaths(draftKey, (path) =>
                  path === `trigger/${trigger.id}` ||
                  path.startsWith(`trigger/${trigger.id}/`)
                    ? null
                    : path,
                );
              onChange(triggers.filter((_, i) => i !== index));
            }}
          >
            {known ? (
              <>
                <TriggerFields
                  trigger={trigger}
                  onChange={update}
                  devices={devices}
                  groups={groups}
                  scenes={scenes}
                  helpers={helpers}
                />
                {live && (
                  <div className="flow-live text-xs text-muted-foreground">
                    {badge && (
                      <StatusBadge label={badge.label} tone={badge.tone} />
                    )}
                    <p className="mt-1">
                      Saved routine: {triggerStateSentence(live, now)}
                    </p>
                    {live.error && (
                      <p className="text-destructive">{live.error}</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <UnknownFlowValue value={trigger} />
            )}
          </FlowBlock>
        );
      })}
      {!triggers.length && (
        <p className="text-xs text-muted-foreground">
          Choose what starts this routine. Multiple starts are alternatives.
        </p>
      )}
      <AddFlowBlock
        label="Add start"
        options={triggerKindOptions}
        onAdd={(kind) =>
          onChange([...triggers, defaultTrigger(kind, createUuid())])
        }
      />
    </div>
  );
}
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
