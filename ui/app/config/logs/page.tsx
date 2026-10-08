import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { configItemHref } from '@/lib/configItemHref';
import { Copy, Pause, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { type LogLevel, type UiLogEntry, useLogs } from '@/hooks/useConfig';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/primitives/dialog';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';
const levels: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
const shortTime = (timestamp: string) => {
  const time = new Date(timestamp);
  return Number.isNaN(time.valueOf())
    ? timestamp
    : time.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
};
export default function LogsPage() {
  const opener = useRef<HTMLButtonElement | null>(null);
  const [paused, setPaused] = useState(false),
    [frozen, setFrozen] = useState<UiLogEntry[]>([]);
  const { data, loading, error, refetch, lastUpdated } = useLogs(5000, paused);
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(200),
    [selected, setSelected] = useState<UiLogEntry | null>(null);
  const search = params.get('q') ?? '',
    level = params.get('level') ?? '',
    target = params.get('source') ?? '';
  const rows = paused ? frozen : data;
  const visible = [...rows]
    .reverse()
    .filter(
      (row) =>
        (!level || row.level === level) &&
        (!target || row.target === target) &&
        (!params.get('device') ||
          (row.references ?? []).some(
            (reference) =>
              reference.entity === 'device' &&
              reference.entity_id === params.get('device'),
          )) &&
        `${row.level} ${row.target} ${row.message}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    );
  const patch = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(200);
  };
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Logs"
        description="Recent events from the server."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!paused) setFrozen(data);
                setPaused(!paused);
              }}
            >
              {paused ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh logs"
              disabled={loading || paused}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={`size-4 ${loading ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        }
      />
      <ConfigSectionTabs />
      {params.get('device') && (
        <div className="flex items-center gap-2 text-xs">
          Logs linked to {params.get('device')}
          <Button variant="ghost" size="sm" onClick={() => patch('device', '')}>
            Clear device filter
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search logs"
          placeholder="Search messages or sources"
          className="min-w-48 flex-1"
          value={search}
          onChange={(event) => patch('q', event.target.value)}
        />
        <SettingsSelect
          aria-label="Log level"
          className="w-auto min-w-32"
          value={level || 'all'}
          onValueChange={(value) =>
            patch('level', value === 'all' ? '' : value)
          }
          options={[
            { value: 'all', label: 'All levels' },
            ...levels.map((value) => ({ value, label: value })),
          ]}
        />
        <SettingsSelect
          aria-label="Log source"
          className="w-auto max-w-full sm:max-w-64"
          value={target ? `source:${target}` : 'all'}
          onValueChange={(value) =>
            patch('source', value === 'all' ? '' : value.slice(7))
          }
          options={[
            { value: 'all', label: 'All sources' },
            ...[
              ...new Set([
                ...rows.map((row) => row.target),
                ...(target ? [target] : []),
              ]),
            ]
              .sort()
              .map((value) => ({ value: `source:${value}`, label: value })),
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visible.length} of {rows.length} buffered events
          {paused ? ' · Updates paused' : ' · Newest first'}
        </span>
        <span>
          {lastUpdated
            ? `Updated ${shortTime(lastUpdated)}`
            : 'Waiting for events'}
        </span>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs text-destructive"
        >
          {error}
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}
      {loading && !data.length ? (
        <p className="text-sm text-muted-foreground">Loading logs…</p>
      ) : !visible.length ? (
        <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
          {search || level || target
            ? 'No events match these filters.'
            : 'No buffered events yet.'}
        </p>
      ) : (
        <div
          className={`settings-log-list ${advanced ? 'show-source' : ''}`}
          aria-label="Log events"
        >
          {visible.slice(0, limit).map((entry, index) => (
            <button
              key={`${entry.timestamp}-${entry.target}-${index}`}
              type="button"
              className="settings-log-row"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(entry);
              }}
              aria-label={`${shortTime(entry.timestamp)} ${entry.level}: ${entry.message}`}
            >
              <time
                dateTime={entry.timestamp}
                className="log-time"
                title={new Date(entry.timestamp).toLocaleString()}
              >
                {shortTime(entry.timestamp)}
              </time>
              <span className={`log-level log-${entry.level.toLowerCase()}`}>
                {entry.level}
              </span>
              {advanced && (
                <span className="log-source" title={entry.target}>
                  {entry.target.split('::').at(-1)}
                </span>
              )}
              <span className="log-message">{entry.message}</span>
            </button>
          ))}
        </div>
      )}
      {visible.length > limit && (
        <Button
          variant="outline"
          onClick={() => setLimit((value) => value + 200)}
        >
          Show more ({visible.length - limit} remaining)
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="max-w-3xl"
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Event details</DialogTitle>
            <DialogDescription>
              {selected
                ? `${new Date(selected.timestamp).toLocaleString()} · ${selected.level}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {selected.target}
              </p>
              <pre className="max-h-[55dvh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs leading-5">
                {selected.message}
              </pre>
              {(selected.references ?? []).length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {(selected.references ?? []).map((reference) => (
                    <Link
                      onClick={() => setSelected(null)}
                      key={`${reference.entity}/${reference.entity_id}`}
                      className="text-sm text-primary underline"
                      to={configItemHref(reference.entity, reference.entity_id)}
                    >
                      Open {reference.entity}: {reference.entity_id}
                    </Link>
                  ))}
                </div>
              )}
              {advanced && selected.details && (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(selected.details, null, 2)}
                </pre>
              )}
              <Button
                variant="outline"
                className="w-fit"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      `${selected.timestamp} ${selected.level} ${selected.target}\n${selected.message}`,
                    )
                    .then(() => toast.success('Event copied'))
                    .catch(() => toast.error('Could not copy this event.'))
                }
              >
                <Copy className="size-4" />
                Copy event
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
