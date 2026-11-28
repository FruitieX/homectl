import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle, Plus, Square, Trash2 } from 'lucide-react';
import type { UserTimerDefinition } from '@/bindings/UserTimerDefinition';
import type { UserTimerEntry } from '@/bindings/UserTimerEntry';
import type { UserTimers } from '@/bindings/UserTimers';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
} from '@/hooks/useDashboard';
import { useLiveDeviceControls } from '@/hooks/useLiveDeviceControls';
import { useLongPress } from '@/hooks/useLongPress';
import { useUserTimers } from '@/hooks/useUserTimers';
import { useDevicesState } from '@/hooks/websocket';
import { cn } from '@/lib/cn';
import { createUuid } from '@/lib/uuid';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { TimerIcon } from '@/ui/TimerIcon';
import { Field } from '@/ui/timers/Field';
import { readingValue } from '@/ui/timers/TemperatureFields';
import { ScheduleFields, timed } from '@/ui/timers/TimerScheduleFields';
import { TimerSummary } from './TimersCard';
import { DashboardCard } from './WidgetChrome';

function targetsDevice(d: UserTimerDefinition, deviceKey: string) {
  return d.action.kind === 'device' && d.action.device_key === deviceKey;
}

/** The temperature sensor shown on the tile: the widget's own, or the one a timer warms up to. */
function sensorFor(
  widget: DashboardWidget,
  timers: UserTimerEntry[],
): { sensor_key: string; reading: string } | undefined {
  const own = getDashboardWidgetOptionString(widget, 'sensorKey', '');
  if (own)
    return {
      sensor_key: own,
      reading: getDashboardWidgetOptionString(
        widget,
        'sensorReading',
        'temperature',
      ),
    };
  for (const t of timers) {
    const s = t.definition.schedule;
    if (s.kind === 'ready_by' && s.temperature) return s.temperature;
  }
  return undefined;
}

function clock(ms: number, zone?: string) {
  const at = new Date(ms);
  const today = new Date().toDateString() === at.toDateString();
  return at.toLocaleString(undefined, {
    timeZone: zone,
    weekday: today ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The soonest thing the device's timers will do, in a few words. */
function nextUp(timers: UserTimerEntry[]) {
  const running = timers.find((t) => t.runtime.active && t.runtime.finish_ms);
  if (running)
    return `${running.definition.name} · until ${clock(running.runtime.finish_ms!)}`;
  const next = timers
    .filter((t) => t.definition.enabled && t.runtime.next_start_ms)
    .sort((a, b) => a.runtime.next_start_ms! - b.runtime.next_start_ms!)[0];
  if (!next) return 'No timer set · hold for timers';
  const { definition: d, runtime: r } = next;
  return d.schedule.kind === 'ready_by' && r.finish_ms
    ? `Ready ${clock(r.finish_ms)} · starts ${clock(r.next_start_ms!)}`
    : `${d.name} · ${clock(r.next_start_ms!)}`;
}

export function DeviceTimersCard({ widget }: { widget: DashboardWidget }) {
  const deviceKey = getDashboardWidgetOptionString(widget, 'deviceKey', '');
  const devices = useDevicesState();
  const device = devices?.[deviceKey];
  const api = useUserTimers();
  const control = useLiveDeviceControls();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { longPressProps, consumeLongPress } = useLongPress({
    onLongPress: () => setOpen(true),
    enabled: !!deviceKey,
  });
  const timers = (api.data?.timers ?? []).filter((t) =>
    targetsDevice(t.definition, deviceKey),
  );
  const sensor = sensorFor(widget, timers);
  const temperature = sensor ? readingValue(devices, sensor) : undefined;
  const controllable =
    device && 'Controllable' in device.data ? device.data.Controllable : null;
  const on = !!controllable?.state.power;
  const icon = timers[0]?.definition.icon ?? 'plug';
  const title = widget.title || device?.name || 'Device';

  if (!deviceKey)
    return (
      <DashboardCard className="p-4 text-sm text-muted-foreground">
        Choose a device in widget settings.
      </DashboardCard>
    );

  return (
    <DashboardCard>
      <button
        type="button"
        {...longPressProps}
        onClick={async () => {
          if (consumeLongPress() || !device || pending) return;
          setPending(true);
          try {
            await control(device, !on);
          } finally {
            setPending(false);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          longPressProps.onContextMenu(e);
          setOpen(true);
        }}
        disabled={!controllable}
        aria-label={`${title}: ${on ? 'on' : 'off'}. Tap to turn ${on ? 'off' : 'on'}, hold for timers.`}
        className={cn(
          'flex h-full min-h-0 w-full select-none items-center gap-3 p-4 text-left transition-colors',
          on ? 'bg-primary/15' : 'hover:bg-muted/50',
        )}
      >
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            on ? 'bg-primary text-primary-foreground' : 'bg-muted',
          )}
        >
          {pending ? (
            <LoaderCircle className="size-6 animate-spin" />
          ) : (
            <TimerIcon name={icon} className="size-6" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm">
            {!device ? 'Unavailable' : on ? 'On' : 'Off'}
            {temperature !== undefined && ` · ${temperature} °C`}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {api.isPending ? 'Loading timers…' : nextUp(timers)}
          </span>
        </span>
      </button>
      {open && (
        <DeviceTimersDialog
          title={title}
          deviceKey={deviceKey}
          sensor={sensor}
          catalog={api.data}
          onClose={() => setOpen(false)}
        />
      )}
    </DashboardCard>
  );
}

function DeviceTimersDialog({
  title,
  deviceKey,
  sensor,
  catalog,
  onClose,
}: {
  title: string;
  deviceKey: string;
  sensor?: { sensor_key: string; reading: string };
  catalog?: UserTimers & { storage_available: boolean };
  onClose: () => void;
}) {
  const api = useUserTimers();
  const saved = useMemo(
    () => catalog?.timers.map((t) => t.definition) ?? [],
    [catalog],
  );
  const [draft, setDraft] = useState<UserTimerDefinition[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [draft]);
  const current = draft ?? saved;
  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const mine = current.filter((d) => targetsDevice(d, deviceKey));
  const edit = (next: UserTimerDefinition) =>
    setDraft(current.map((d) => (d.id === next.id ? next : d)));
  const add = () => {
    const schedule = timed('ready_by');
    setDraft([
      ...current,
      {
        id: createUuid(),
        name: `${title} ready`,
        icon: 'car',
        enabled: true,
        schedule:
          schedule.kind === 'ready_by' && sensor
            ? {
                ...schedule,
                temperature: {
                  ...sensor,
                  target: 5,
                  max_warmup_minutes: 150,
                },
              }
            : schedule,
        action: { kind: 'device', device_key: deviceKey, power: true },
        finish_action: { kind: 'device', device_key: deviceKey, power: false },
      },
    ]);
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveOverlay
      open
      onOpenChange={(next) => !next && onClose()}
      title={`${title} timers`}
      description="Ready-by times run on the server. With a target temperature, the start follows the sensor and the learned warm-up rate."
      className="max-w-2xl"
      guard={{ dirty }}
    >
      <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
        {!catalog && <p role="status">Loading timers…</p>}
        {catalog && !mine.length && (
          <p className="text-sm text-muted-foreground">
            No timers for this device yet.
          </p>
        )}
        {mine.map((d) => {
          const entry = catalog?.timers.find((t) => t.definition.id === d.id);
          const running = !!(entry?.runtime.active || entry?.runtime.pending);
          return (
            <section
              key={d.id}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <label className="flex min-h-11 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    disabled={running || busy}
                    onChange={(e) => edit({ ...d, enabled: e.target.checked })}
                    aria-label={`Enable ${d.name}`}
                  />
                  <Input
                    value={d.name}
                    disabled={running || busy}
                    onChange={(e) => edit({ ...d, name: e.target.value })}
                    aria-label="Timer name"
                  />
                </label>
                {running ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => api.stop(d.id))}
                  >
                    <Square />
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${d.name}`}
                    disabled={busy}
                    onClick={() =>
                      setDraft(current.filter((t) => t.id !== d.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {entry && <TimerSummary entry={entry} />}
              {d.schedule.kind === 'countdown' ? (
                <Field label="Countdown">
                  <Link
                    className="text-sm text-primary underline"
                    to={`/config/timers?timer=${encodeURIComponent(d.id)}`}
                  >
                    Edit in timer settings
                  </Link>
                </Field>
              ) : (
                <fieldset disabled={running || busy}>
                  <ScheduleFields
                    schedule={d.schedule}
                    change={(schedule) => edit({ ...d, schedule })}
                    heaterKey={deviceKey}
                    models={catalog?.heating_models}
                  />
                </fieldset>
              )}
            </section>
          );
        })}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={add} disabled={!catalog || busy}>
            <Plus />
            Add ready-by time
          </Button>
          <Link
            to={`/config/timers?device=${encodeURIComponent(deviceKey)}`}
            className="text-sm text-primary underline"
          >
            All timer settings
          </Link>
          <span className="flex-1" />
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Discard
            </Button>
          )}
          <Button
            disabled={!dirty || busy}
            onClick={async () => {
              if (await run(() => api.save(current, saved))) setDraft(null);
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}
