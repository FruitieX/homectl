import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square, LoaderCircle } from 'lucide-react';
import type { UserTimerEntry } from '@/bindings/UserTimerEntry';
import type { DashboardWidget } from '@/hooks/useDashboard';
import { getDashboardWidgetOptionStringArray } from '@/hooks/useDashboard';
import { useUserTimers } from '@/hooks/useUserTimers';
import { TimerIcon } from '@/ui/TimerIcon';
import { Button } from '@/ui/primitives/button';
import { DashboardCard } from './WidgetChrome';

export function TimerSummary({ entry }: { entry: UserTimerEntry }) {
  const { definition: d, runtime: r } = entry;
  const zone =
    d.schedule.kind === 'countdown' ? undefined : d.schedule.timezone;
  const format = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {r.pending
          ? `Applying ${r.pending === 'start' ? 'start' : 'end'} action…`
          : r.active && r.finish_ms
            ? `Running · ends ${format(r.finish_ms)}`
            : d.enabled && r.next_start_ms
              ? `${d.schedule.kind === 'countdown' ? 'Runs' : 'Starts'} ${format(r.next_start_ms)}`
              : 'Not scheduled'}
        {zone ? ` · ${zone}` : ''}
      </p>
      {!r.active && d.enabled && r.finish_ms && (
        <p>Ends {format(r.finish_ms)}</p>
      )}
      {r.last_message && (
        <p
          className={
            r.last_message.startsWith('Action failed')
              ? 'text-destructive'
              : undefined
          }
        >
          {r.last_message}
        </p>
      )}
    </div>
  );
}
export function TimersCard({ widget }: { widget: DashboardWidget }) {
  const api = useUserTimers();
  const selected = getDashboardWidgetOptionStringArray(widget, 'timerIds');
  const all = api.data?.timers ?? [];
  const entries =
    widget.options.timerSelection === 'selected'
      ? selected.map((id) => all.find((t) => t.definition.id === id) ?? id)
      : all;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function toggle(entry: UserTimerEntry) {
    const d = entry.definition;
    setPending(d.id);
    setError('');
    try {
      if (d.enabled || entry.runtime.active || entry.runtime.pending)
        await api.stop(d.id);
      else {
        const expected = all.map((t) => t.definition);
        await api.save(
          expected.map((t) => (t.id === d.id ? { ...t, enabled: true } : t)),
          expected,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer');
    } finally {
      setPending(null);
    }
  }
  return (
    <DashboardCard>
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-4 pt-3">
        <h2 className="truncate text-sm font-semibold">
          {widget.title || 'Timers'}
        </h2>
        <Link to="/config/timers" className="text-xs text-primary underline">
          Manage timers
        </Link>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4 pt-2">
        {api.isPending ? (
          <p className="text-sm" role="status">
            Loading timers…
          </p>
        ) : api.isError ? (
          <div role="alert" className="text-sm">
            Timers unavailable.{' '}
            <Button variant="outline" onClick={() => void api.refetch()}>
              Retry
            </Button>
          </div>
        ) : !entries.length ? (
          <p className="text-sm text-muted-foreground">
            {widget.options.timerSelection === 'selected'
              ? 'No timers selected. Choose timers in widget settings.'
              : 'No timers yet. Add a countdown or schedule to get started.'}
          </p>
        ) : (
          entries.map((entry) =>
            typeof entry === 'string' ? (
              <p key={entry} className="text-sm">
                Timer unavailable · {entry}
              </p>
            ) : (
              <div
                key={entry.definition.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <TimerIcon name={entry.definition.icon} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/config/timers?timer=${encodeURIComponent(entry.definition.id)}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {entry.definition.name}
                  </Link>
                  <TimerSummary entry={entry} />
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  disabled={pending !== null || !!entry.runtime.pending}
                  aria-label={`${entry.definition.enabled || entry.runtime.active ? 'Stop' : 'Start'} ${entry.definition.name}`}
                  onClick={() => void toggle(entry)}
                >
                  {pending === entry.definition.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : entry.definition.enabled || entry.runtime.active ? (
                    <Square />
                  ) : (
                    <Play />
                  )}
                </Button>
              </div>
            ),
          )
        )}
        {api.data?.storage_available === false && (
          <p role="alert" className="text-sm text-destructive">
            Timer storage is unavailable. Scheduling is paused.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </DashboardCard>
  );
}
