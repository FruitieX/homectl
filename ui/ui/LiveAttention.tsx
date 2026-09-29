import { Link } from 'react-router-dom';
import { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDeviceHealth } from '@/hooks/useDeviceHealth';
import { configItemHref } from '@/lib/configItemHref';
import { Button } from '@/ui/primitives/button';

/** The server is the sole evaluator; this view only scopes its attention list. */
export function LiveAttention({
  deviceKeys,
}: {
  deviceKeys?: readonly string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const health = useDeviceHealth();
  if (health.isError)
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        Device reporting status is unavailable.
        <Button
          size="sm"
          variant="outline"
          onClick={() => void health.refetch()}
        >
          Retry
        </Button>
      </p>
    );
  const selected = deviceKeys ? new Set(deviceKeys) : null;
  const keys = (health.data?.attention_device_keys ?? []).filter(
    (key) => !selected || selected.has(key),
  );
  if (!keys.length) return null;
  return (
    <section
      aria-label="Devices needing attention"
      className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3"
    >
      <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span className="flex-1">
          {keys.length} {keys.length === 1 ? 'device needs' : 'devices need'}{' '}
          attention
        </span>
        {keys.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 h-auto shrink-0 py-1 text-xs"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show fewer' : `${keys.length - 1} more`}
          </Button>
        )}
      </div>
      <ul id={listId} className="mt-2 space-y-2 pl-6">
        {keys.slice(0, expanded ? undefined : 1).map((key) => {
          const item = health.data?.devices[key];
          return (
            <li key={key} className="text-xs">
              <Link
                className="text-primary underline underline-offset-2"
                to={configItemHref('device', key)}
              >
                {item?.name ?? key}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {item?.issues[0]?.message ?? 'Review device status'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
