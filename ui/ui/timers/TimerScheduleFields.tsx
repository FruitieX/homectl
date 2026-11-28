import type { HeatingModel } from '@/bindings/HeatingModel';
import type { ReadyByTemperature } from '@/bindings/ReadyByTemperature';
import type { UserTimerSchedule } from '@/bindings/UserTimerSchedule';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { Field } from './Field';
import { TemperatureFields } from './TemperatureFields';

export { Field };

export function timed(kind: 'scheduled' | 'ready_by'): UserTimerSchedule {
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

export function ScheduleFields({
  schedule: s,
  change,
  heaterKey,
  models = [],
}: {
  schedule: UserTimerSchedule;
  change: (s: UserTimerSchedule) => void;
  /** Device the timer switches on; its learned warm-up is shown. */
  heaterKey?: string;
  models?: HeatingModel[];
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
        <TemperatureFields
          value={s.temperature}
          change={(temperature?: ReadyByTemperature) => {
            const { temperature: _old, ...rest } = s;
            change(temperature ? { ...rest, temperature } : rest);
          }}
          model={models.find(
            (m) =>
              m.device_key === heaterKey &&
              m.sensor_key === s.temperature?.sensor_key &&
              m.reading === s.temperature?.reading,
          )}
        />
      )}
      {s.kind === 'ready_by' && (
        <Field
          label={
            s.temperature
              ? 'Without a reading, warm up for (minutes)'
              : 'Warm up for (minutes)'
          }
        >
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
