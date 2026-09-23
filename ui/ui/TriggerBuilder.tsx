import type { BacklogPolicy } from '@/bindings/BacklogPolicy';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import type { RoutineRuntimeStatus } from '@/bindings/RoutineRuntimeStatus';
import type { ScheduleSpec } from '@/bindings/ScheduleSpec';
import type { TriggerSpec } from '@/bindings/TriggerSpec';
import { useSchedulePreview } from '@/hooks/useConfig';
import { DurationInput, selectClassName } from '@/ui/builder-fields';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { DeviceSelect, splitDeviceKey } from '@/ui/config-selectors';
import { ConfigField } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import {
  StatusBadge,
  formatDue,
  formatUnknownReason,
  triggerBadge,
} from '@/ui/routine-runtime';
import { Plus } from 'lucide-react';
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
            <select
              className={`${selectClassName} w-full`}
              value={mode}
              onChange={(event) => {
                if (event.target.value === 'cron') {
                  onChange({
                    ...trigger,
                    schedule: {
                      ...schedule,
                      cron: schedule.cron ?? '',
                      every_ms: undefined,
                    },
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
                className={`${selectClassName} w-full`}
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
            <select
              className={`${selectClassName} w-full`}
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
function nextTriggerId(kind: TriggerKind, triggers: TriggerSpec[]): string {
  let index = triggers.length + 1;
  let id = `${kind}_${index}`;
  while (triggers.some((trigger) => trigger.id === id)) {
    index += 1;
    id = `${kind}_${index}`;
  }
  return id;
}

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
}) {
  const [draft, setDraft] = useState<TriggerSpec | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const liveTriggers = runtimeStatus?.v2?.triggers ?? [];
  const hasArmed = liveTriggers.some(
    (trigger) => trigger.armed && trigger.due_wall_ms !== undefined,
  );
  useInterval(() => setNow(Date.now()), hasArmed ? 15000 : null);

  const startAdd = () => {
    setDraft(defaultTrigger('schedule', nextTriggerId('schedule', triggers)));
  };

  const changeDraftKind = (kind: TriggerKind) => {
    setDraft(defaultTrigger(kind, nextTriggerId(kind, triggers)));
  };

  const draftIdTaken =
    draft !== null && triggers.some((trigger) => trigger.id === draft.id);

  const confirmAdd = () => {
    if (!draft || !draft.id.trim() || draftIdTaken) {
      return;
    }
    onChange([...triggers, draft]);
    setDraft(null);
  };

  return (
    <div className="space-y-4">
      <datalist id="v2-timezones">
        {timezoneSuggestions.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={startAdd}
      >
        <Plus />
        Add trigger
      </Button>

      <ResponsiveOverlay
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
          }
        }}
        title="Add trigger"
        description="Pick the event that starts this routine, configure it, then add it to the routine."
        presentation="page"
        className="max-w-2xl"
      >
        {draft ? (
          <div className="flex min-h-full flex-col gap-4 px-5 pb-5 md:px-0 md:pb-0">
            <ConfigField
              label="Trigger type"
              description="What kind of event should start this routine?"
            >
              <SearchablePicker
                options={triggerKindOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={draft.kind}
                onChange={(kind) => changeDraftKind(kind as TriggerKind)}
                clearable={false}
              />
            </ConfigField>

            <ConfigField
              label="Trigger ID"
              description="Used by logs and runtime status; keep it short and unique."
            >
              <Input
                className="font-mono"
                value={draft.id}
                onChange={(event) =>
                  setDraft({ ...draft, id: event.target.value } as TriggerSpec)
                }
              />
            </ConfigField>
            {draftIdTaken ? (
              <p className="text-xs text-destructive">
                Trigger IDs must be unique within the routine.
              </p>
            ) : null}

            <TriggerFields
              trigger={draft}
              onChange={setDraft}
              devices={devices}
              groups={groups}
              scenes={scenes}
              helpers={helpers}
            />

            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!draft.id.trim() || draftIdTaken}
                onClick={confirmAdd}
              >
                Add trigger
              </Button>
            </div>
          </div>
        ) : null}
      </ResponsiveOverlay>

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
                                ? ({
                                    ...candidate,
                                    id: event.target.value,
                                  } as TriggerSpec)
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
                  helpers={helpers}
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
