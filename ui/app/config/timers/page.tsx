import { ConfigPageHeader } from '../page-header';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { UserTimerDefinition } from '@/bindings/UserTimerDefinition';
import type { UserTimerAction } from '@/bindings/UserTimerAction';
import type { UserTimerSchedule } from '@/bindings/UserTimerSchedule';
import { useUserTimers } from '@/hooks/useUserTimers';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import {
  useDevicesState,
  useGroupsState,
  useScenesState,
} from '@/hooks/websocket';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { configItemHref } from '@/lib/configItemHref';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { TimerIcon, timerIcons } from '@/ui/TimerIcon';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { TimerSummary } from '../../dashboard/TimersCard';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
function newTimer(deviceKey = ''): UserTimerDefinition {
  return {
    id: crypto.randomUUID(),
    name: 'New timer',
    icon: 'timer',
    enabled: false,
    schedule: { kind: 'countdown', minutes: 20 },
    action: { kind: 'device', device_key: deviceKey, power: false },
    finish_action: null,
  };
}
function timed(kind: 'scheduled' | 'ready_by'): UserTimerSchedule {
  const fields = {
    time: '08:00',
    timezone: 'Europe/Helsinki',
    date: null,
    weekdays: [1, 2, 3, 4, 5],
  };
  return kind === 'scheduled'
    ? { kind, ...fields, duration_minutes: null }
    : { kind, ...fields, warmup_minutes: 40 };
}
function validate(timers: UserTimerDefinition[]) {
  return timers.flatMap((t) => {
    const errors: { field: string; message: string }[] = [];
    const add = (message: string) =>
      errors.push({ field: t.id, message: `${t.name || 'Timer'}: ${message}` });
    if (!t.name.trim()) add('Enter a name.');
    for (const a of [t.action, t.finish_action]) {
      if (
        a &&
        !(a.kind === 'device'
          ? a.device_key
          : a.kind === 'group'
            ? a.group_id
            : a.scene_id)
      )
        add('Choose each action target.');
    }
    const s = t.schedule;
    if (s.kind !== 'countdown') {
      if (!/^\d{2}:\d{2}$/.test(s.time)) add('Choose a time.');
      if (!s.date && !s.weekdays.length) add('Choose a date or repeat days.');
      try {
        new Intl.DateTimeFormat('en', { timeZone: s.timezone });
      } catch {
        add('Choose a valid IANA time zone.');
      }
    }
    const minutes =
      s.kind === 'countdown'
        ? s.minutes
        : s.kind === 'ready_by'
          ? s.warmup_minutes
          : s.duration_minutes;
    if (
      minutes !== null &&
      (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
    )
      add('Duration must be 1–10080 minutes.');
    return errors;
  });
}

export default function TimersPage() {
  const api = useUserTimers();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState('');
  const [commandPending, setCommandPending] = useState(false);
  const initial = useMemo(
    () =>
      api.data
        ? { timers: api.data.timers.map((t) => t.definition) }
        : undefined,
    [api.data],
  );
  const draft = useEntityDraft({
    key: `${api.apiEndpoint}/user-timers`,
    item: initial,
    label: 'Timers',
    href: params.get('timer')
      ? `/config/timers?timer=${encodeURIComponent(params.get('timer')!)}`
      : '/config/timers',
    validate: (v) => validate(v.timers),
    save: async (v, expected) => ({
      timers: (await api.save(v.timers, expected.timers)).timers.map(
        (t) => t.definition,
      ),
    }),
  });
  const timers = draft.value?.timers ?? [];
  const selected =
    timers.find((t) => t.id === params.get('timer')) ?? timers[0];
  const savedEntry = api.data?.timers.find(
    (t) => t.definition.id === selected?.id,
  );
  const runtime = savedEntry?.runtime;
  const running = !!(runtime?.active || runtime?.pending);
  const change = (next: UserTimerDefinition) =>
    draft.patch({ timers: timers.map((t) => (t.id === next.id ? next : t)) });
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Timers"
        description="Countdowns, schedules and ready-by times. Run by the server, even when your browser is closed."
        actions={
          <Button
            onClick={() => {
              const t = newTimer(params.get('device') ?? '');
              draft.patch({ timers: [...timers, t] });
              setParams({ timer: t.id });
            }}
            disabled={!draft.value || draft.saving}
          >
            <Plus />
            Add timer
          </Button>
        }
      />
      {api.isPending && <p role="status">Loading timers…</p>}
      {api.isError && (
        <div role="alert">
          Could not load timers.{' '}
          <Button variant="outline" onClick={() => void api.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {api.data?.storage_available === false && (
        <p role="alert" className="text-destructive">
          Timer storage is unavailable. Scheduling is paused until the database
          returns.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {draft.value && !timers.length && (
        <section className="settings-section">
          <h2>No timers yet</h2>
          <p>Add a timer, choose its action and save when it is ready.</p>
        </section>
      )}
      {!!timers.length && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
          <nav aria-label="Timers" className="grid gap-2">
            {timers.map((t) => (
              <button
                key={t.id}
                data-field={t.id}
                onClick={() => setParams({ timer: t.id })}
                aria-current={selected?.id === t.id ? 'true' : undefined}
                className={`flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left ${selected?.id === t.id ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
              >
                <TimerIcon name={t.icon} />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {t.name || 'Unnamed timer'}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {t.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                    {t.schedule.kind === 'ready_by'
                      ? 'Ready by'
                      : t.schedule.kind === 'countdown'
                        ? 'Countdown'
                        : 'Scheduled'}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          {selected && (
            <section className="settings-section space-y-4">
              {savedEntry && <TimerSummary entry={savedEntry} />}
              {running && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  <span className="flex-1">
                    Stop this running timer before editing. Its end action will
                    run.
                  </span>
                  <Button
                    variant="outline"
                    disabled={commandPending}
                    onClick={async () => {
                      try {
                        setError('');
                        setCommandPending(true);
                        await api.stop(selected.id);
                      } catch (e) {
                        setError(String(e));
                      } finally {
                        setCommandPending(false);
                      }
                    }}
                  >
                    {commandPending ? 'Stopping…' : 'Stop timer'}
                  </Button>
                </div>
              )}
              {running &&
                runtime?.last_message?.startsWith('Action failed') && (
                  <div role="alert" className="space-y-2 text-sm">
                    <p>
                      The end action could not run. It will retry every 30
                      seconds. You can cancel the remaining actions to repair
                      the timer; this does not turn devices off.
                    </p>
                    <Button
                      variant="outline"
                      disabled={commandPending}
                      onClick={async () => {
                        setCommandPending(true);
                        try {
                          setError('');
                          await api.cancel(selected.id);
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setCommandPending(false);
                        }
                      }}
                    >
                      Cancel without end action
                    </Button>
                  </div>
                )}
              <fieldset
                disabled={running || draft.saving}
                className="space-y-5 disabled:opacity-70"
              >
                <div className="grid gap-4 grid-cols-[minmax(0,1fr)_120px]">
                  <Field label="Name">
                    <Input
                      value={selected.name}
                      onChange={(e) =>
                        change({ ...selected, name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Icon">
                    <SettingsSelect
                      aria-label="Icon"
                      value={selected.icon}
                      onValueChange={(value) =>
                        change({ ...selected, icon: value })
                      }
                      options={Object.keys(timerIcons).map((icon) => ({
                        value: icon,
                        label: icon[0].toUpperCase() + icon.slice(1),
                      }))}
                    />
                  </Field>
                </div>
                <Field label="Timer mode">
                  <SettingsSelect
                    aria-label="Timer mode"
                    value={selected.schedule.kind}
                    onValueChange={(value) => {
                      const kind = value as UserTimerSchedule['kind'];
                      change({
                        ...selected,
                        schedule:
                          kind === 'countdown'
                            ? { kind, minutes: 20 }
                            : timed(kind),
                        action:
                          selected.action.kind === 'scene'
                            ? selected.action
                            : {
                                ...selected.action,
                                power: kind !== 'countdown',
                              },
                        finish_action:
                          kind === 'ready_by'
                            ? {
                                kind: 'device',
                                device_key:
                                  selected.action.kind === 'device'
                                    ? selected.action.device_key
                                    : '',
                                power: false,
                              }
                            : null,
                      });
                    }}
                    options={[
                      { value: 'countdown', label: 'Countdown' },
                      { value: 'scheduled', label: 'Scheduled' },
                      { value: 'ready_by', label: 'Ready by' },
                    ]}
                  />
                </Field>
                <ScheduleFields
                  schedule={selected.schedule}
                  change={(s) => change({ ...selected, schedule: s })}
                />
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <h2 className="mb-3 text-sm font-semibold">
                    {selected.schedule.kind === 'countdown'
                      ? 'When the countdown ends'
                      : 'At the start'}
                  </h2>
                  <ActionFields
                    action={selected.action}
                    change={(action) => change({ ...selected, action })}
                  />
                </div>
                {selected.schedule.kind === 'scheduled' && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.finish_action !== null}
                      onChange={(e) => {
                        const s = selected.schedule;
                        if (s.kind !== 'scheduled') return;
                        change({
                          ...selected,
                          schedule: {
                            ...s,
                            duration_minutes: e.target.checked ? 30 : null,
                          },
                          finish_action: e.target.checked
                            ? {
                                kind: 'device',
                                device_key:
                                  selected.action.kind === 'device'
                                    ? selected.action.device_key
                                    : '',
                                power: false,
                              }
                            : null,
                        });
                      }}
                    />
                    Run an end action after a duration
                  </label>
                )}
                {selected.finish_action && (
                  <div className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                    <h2 className="text-sm font-semibold">At the end</h2>
                    {selected.schedule.kind === 'scheduled' && (
                      <Field label="Run for (minutes)">
                        <Input
                          type="number"
                          min={1}
                          max={10080}
                          value={selected.schedule.duration_minutes || ''}
                          onChange={(e) => {
                            const s = selected.schedule;
                            if (s.kind === 'scheduled')
                              change({
                                ...selected,
                                schedule: {
                                  ...s,
                                  duration_minutes: Number(e.target.value),
                                },
                              });
                          }}
                        />
                      </Field>
                    )}
                    <ActionFields
                      action={selected.finish_action}
                      change={(finish_action) =>
                        change({ ...selected, finish_action })
                      }
                    />
                  </div>
                )}
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) =>
                      change({ ...selected, enabled: e.target.checked })
                    }
                  />
                  Enable after saving
                  {selected.schedule.kind === 'countdown'
                    ? ' · starts the countdown on save'
                    : ''}
                </label>
                <p className="text-xs text-muted-foreground">
                  {selected.schedule.kind === 'countdown'
                    ? 'An overdue countdown runs when the server returns.'
                    : 'Missed starts are skipped after one minute. A started timer’s end action resumes after a restart. Repeated hours run once; times skipped by daylight saving are skipped.'}{' '}
                  Action results confirm runtime application, not physical
                  delivery.
                </p>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() =>
                    draft.patch({
                      timers: timers.filter((t) => t.id !== selected.id),
                    })
                  }
                >
                  <Trash2 />
                  Remove timer
                </Button>
              </fieldset>
            </section>
          )}
        </div>
      )}
      <EntitySaveBar draft={draft} />
    </div>
  );
}

function ScheduleFields({
  schedule: s,
  change,
}: {
  schedule: UserTimerSchedule;
  change: (s: UserTimerSchedule) => void;
}) {
  if (s.kind === 'countdown')
    return (
      <Field label="Wait for (minutes)">
        <Input
          type="number"
          min={1}
          max={10080}
          value={s.minutes || ''}
          onChange={(e) => change({ ...s, minutes: Number(e.target.value) })}
        />
      </Field>
    );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={s.kind === 'ready_by' ? 'Ready by' : 'Start time'}>
          <Input
            type="time"
            value={s.time}
            onChange={(e) => change({ ...s, time: e.target.value })}
          />
        </Field>
        <Field label="Time zone">
          <Input
            value={s.timezone}
            placeholder="Europe/Helsinki"
            onChange={(e) => change({ ...s, timezone: e.target.value })}
          />
        </Field>
      </div>
      {s.kind === 'ready_by' && (
        <Field label="Warm up for (minutes)">
          <Input
            type="number"
            min={1}
            max={10080}
            value={s.warmup_minutes || ''}
            onChange={(e) =>
              change({ ...s, warmup_minutes: Number(e.target.value) })
            }
          />
        </Field>
      )}
      <Field label="Repeat">
        <SettingsSelect
          aria-label="Repeat"
          value={s.date !== null ? 'once' : 'days'}
          onValueChange={(value) =>
            change({
              ...s,
              date:
                value === 'once'
                  ? new Date(Date.now() + 86400000).toLocaleDateString('en-CA')
                  : null,
              weekdays: value === 'once' ? [] : [1, 2, 3, 4, 5],
            })
          }
          options={[
            { value: 'days', label: 'On selected days' },
            { value: 'once', label: 'Once, on a date' },
          ]}
        />
      </Field>
      {s.date !== null ? (
        <Field label="Date">
          <Input
            type="date"
            value={s.date}
            onChange={(e) => change({ ...s, date: e.target.value })}
          />
        </Field>
      ) : (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Repeat days"
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
            <Button
              key={day}
              size="sm"
              variant={s.weekdays.includes(i + 1) ? 'default' : 'outline'}
              aria-pressed={s.weekdays.includes(i + 1)}
              onClick={() =>
                change({
                  ...s,
                  weekdays: s.weekdays.includes(i + 1)
                    ? s.weekdays.filter((d) => d !== i + 1)
                    : [...s.weekdays, i + 1].sort(),
                })
              }
            >
              {day}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
function ActionFields({
  action: a,
  change,
}: {
  action: UserTimerAction;
  change: (a: UserTimerAction) => void;
}) {
  const devices = useDevicesState();
  const groups = useGroupsState();
  const scenes = useScenesState();
  const selected =
    a.kind === 'device'
      ? a.device_key
      : a.kind === 'group'
        ? a.group_id
        : a.scene_id;
  const options =
    a.kind === 'device'
      ? Object.entries(devices ?? {})
          .filter(
            ([, d]) => d && 'Controllable' in d.data && !isDeviceReadOnly(d),
          )
          .map(([id, d]) => ({ id, name: d!.name }))
      : Object.entries(
          a.kind === 'group' ? (groups ?? {}) : (scenes ?? {}),
        ).map(([id, item]) => ({ id, name: item?.name || id }));
  const href = selected
    ? configItemHref(
        a.kind === 'group' ? 'group' : a.kind === 'scene' ? 'scene' : 'device',
        selected,
      )
    : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Target type">
        <SettingsSelect
          aria-label="Target type"
          value={a.kind}
          onValueChange={(value) =>
            change(
              value === 'device'
                ? { kind: 'device', device_key: '', power: true }
                : value === 'group'
                  ? { kind: 'group', group_id: '', power: true }
                  : { kind: 'scene', scene_id: '' },
            )
          }
          options={[
            { value: 'device', label: 'Device' },
            { value: 'group', label: 'Room or group' },
            { value: 'scene', label: 'Scene' },
          ]}
        />
      </Field>
      <Field label="Target">
        <SettingsSelect
          aria-label="Target"
          value={selected}
          onValueChange={(value) =>
            change(
              a.kind === 'device'
                ? { ...a, device_key: value }
                : a.kind === 'group'
                  ? { ...a, group_id: value }
                  : { ...a, scene_id: value },
            )
          }
          options={[
            ...(selected && !options.some((o) => o.id === selected)
              ? [{ value: selected, label: `Unavailable · ${selected}` }]
              : []),
            ...options.map((o) => ({ value: o.id, label: o.name })),
          ]}
          placeholder="Choose a target"
        />
      </Field>
      {a.kind !== 'scene' && (
        <Field label="Action">
          <SettingsSelect
            aria-label="Action"
            value={a.power ? 'on' : 'off'}
            onValueChange={(value) => change({ ...a, power: value === 'on' })}
            options={[
              { value: 'on', label: 'Turn on' },
              { value: 'off', label: 'Turn off' },
            ]}
          />
        </Field>
      )}
      {href && (
        <Link
          className="flex min-h-11 items-center text-sm text-primary underline"
          to={href}
        >
          Open target details
        </Link>
      )}
      {a.kind === 'scene' && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Activates the scene on its configured devices.
        </p>
      )}
    </div>
  );
}
