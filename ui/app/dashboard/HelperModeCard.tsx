import { House } from 'lucide-react';
import { Link } from 'react-router-dom';
import { configItemHref } from '@/lib/configItemHref';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { WidgetRecovery } from './WidgetRecovery';
import { useState } from 'react';

import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
} from '@/hooks/useDashboard';
import { useHelpers, useSetHelperValue } from '@/hooks/useConfig';
import { useHelperStatuses, useConnectionStatus } from '@/hooks/websocket';
import { Button } from '@/ui/primitives/button';
import { CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { DashboardCard, WidgetHeading } from './WidgetChrome';

function displayValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '—';
  }
  return JSON.stringify(value);
}

function helperOptions(helper: HelperRuntimeStatus) {
  return helper.kind.kind === 'enum' ? helper.kind.options : [];
}

export const HelperModeCard = ({ widget }: { widget?: DashboardWidget }) => {
  const {
    data: definitions,
    loading,
    error: loadError,
    refetch,
  } = useHelpers();
  const { advanced } = useSettingsPreferences();
  const connected = useConnectionStatus() === 'connected';
  const liveStatuses = useHelperStatuses();
  const setValue = useSetHelperValue();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const helperId = getDashboardWidgetOptionString(widget, 'helperId', '');
  const helper =
    liveStatuses?.find((status) => status.id === helperId) ??
    definitions?.find((status) => status.id === helperId);

  const apply = (value: unknown) => {
    if (!connected || setValue.isPending || helper?.compute) return;
    setError(null);
    setValue.mutate(
      { id: helperId, value },
      {
        onError: (mutationError) => {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : 'Failed to set helper value',
          );
        },
      },
    );
  };

  return (
    <DashboardCard className="dashboard-helper-mode-card">
      <div className="dashboard-widget-title shrink-0 px-4 pb-3 pt-4">
        <WidgetHeading icon={<House />} label={widget?.title || 'Mode'} />
      </div>
      <CardContent className="dashboard-helper-mode-content flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-4">
        {loading && !helper ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading helper…
          </p>
        ) : loadError && !helper ? (
          <div role="alert" className="text-sm">
            Helper unavailable.{' '}
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : !helperId ? (
          <WidgetRecovery
            widget={widget}
            message="Choose a helper for this widget."
          />
        ) : !helper ? (
          <WidgetRecovery
            widget={widget}
            message={`Helper ${helperId} is no longer available.`}
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold leading-tight">
                {displayValue(helper.value)}
              </span>
              {helper.compute && (
                <p className="text-xs text-muted-foreground">
                  Computed · {helper.compute_status?.state ?? 'pending'}
                  {helper.compute_status?.error
                    ? ` · ${helper.compute_status.error}`
                    : ''}
                </p>
              )}
              {advanced && (
                <span className="text-xs text-muted-foreground">
                  {helper.persistence === 'durable' ? 'durable' : 'session'} ·
                  rev {Number(helper.revision)}
                </span>
              )}
            </div>
            {!helper.compute && helper.kind.kind === 'enum' ? (
              <div className="flex flex-wrap gap-1 rounded-lg bg-muted/65 p-1">
                {helperOptions(helper).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    className={
                      helper.value === option
                        ? 'flex-1 bg-background shadow-sm'
                        : 'flex-1'
                    }
                    aria-pressed={helper.value === option}
                    variant="ghost"
                    disabled={setValue.isPending || !connected}
                    onClick={() => apply(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : null}
            {!helper.compute && helper.kind.kind === 'boolean' ? (
              <div className="flex flex-wrap gap-1 rounded-lg bg-muted/65 p-1">
                <Button
                  type="button"
                  size="sm"
                  className={
                    helper.value === true
                      ? 'flex-1 bg-background shadow-sm'
                      : 'flex-1'
                  }
                  aria-pressed={helper.value === true}
                  variant="ghost"
                  disabled={setValue.isPending || !connected}
                  onClick={() => apply(true)}
                >
                  On
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={
                    helper.value === false
                      ? 'flex-1 bg-background shadow-sm'
                      : 'flex-1'
                  }
                  aria-pressed={helper.value === false}
                  variant="ghost"
                  disabled={setValue.isPending || !connected}
                  onClick={() => apply(false)}
                >
                  Off
                </Button>
              </div>
            ) : null}
            {!helper.compute &&
            (helper.kind.kind === 'number' || helper.kind.kind === 'string') ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (helper.kind.kind === 'number') {
                    const parsed = Number(draft);
                    if (draft.trim() === '' || !Number.isFinite(parsed)) {
                      setError('Enter a number.');
                      return;
                    }
                    apply(parsed);
                  } else {
                    apply(draft);
                  }
                }}
              >
                <Input
                  type={helper.kind.kind === 'number' ? 'number' : 'text'}
                  value={draft}
                  min={
                    helper.kind.kind === 'number' ? helper.kind.min : undefined
                  }
                  max={
                    helper.kind.kind === 'number' ? helper.kind.max : undefined
                  }
                  placeholder={
                    helper.kind.kind === 'number'
                      ? 'New value'
                      : 'New text value'
                  }
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={setValue.isPending || !connected}
                >
                  Set
                </Button>
              </form>
            ) : null}
            {!connected && (
              <p role="status" className="text-xs text-muted-foreground">
                Disconnected · waiting for live state
              </p>
            )}
            <Link
              className="text-xs text-primary underline"
              to={configItemHref('helper', helperId)}
            >
              Helper details
            </Link>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </DashboardCard>
  );
};
