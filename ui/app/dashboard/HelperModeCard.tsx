import { useState } from 'react';

import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
} from '@/hooks/useDashboard';
import { useHelpers, useSetHelperValue } from '@/hooks/useConfig';
import { useHelperStatuses } from '@/hooks/websocket';
import { Button } from '@/ui/primitives/button';
import { CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { DashboardCard } from './WidgetChrome';

function displayValue(value: unknown) {
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
  const { data: definitions } = useHelpers();
  const liveStatuses = useHelperStatuses();
  const setValue = useSetHelperValue();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const helperId = getDashboardWidgetOptionString(widget, 'helperId', '');
  const helper =
    liveStatuses?.find((status) => status.id === helperId) ??
    definitions?.find((status) => status.id === helperId);

  const apply = (value: unknown) => {
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
      <CardHeader className="dashboard-widget-title shrink-0">
        <CardTitle>{widget?.title || 'Mode'}</CardTitle>
      </CardHeader>
      <CardContent className="dashboard-helper-mode-content flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {!helperId ? (
          <p className="text-sm text-muted-foreground">
            Choose a helper in dashboard settings.
          </p>
        ) : !helper ? (
          <p className="text-sm text-muted-foreground">
            Helper <span className="font-mono">{helperId}</span> is not defined.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold leading-tight">
                {displayValue(helper.value)}
              </span>
              <span className="text-xs text-muted-foreground">
                {helper.persistence === 'durable' ? 'durable' : 'session'} · rev{' '}
                {Number(helper.revision)}
              </span>
            </div>
            {helper.kind.kind === 'enum' ? (
              <div className="flex flex-wrap gap-2">
                {helperOptions(helper).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={helper.value === option ? 'default' : 'outline'}
                    disabled={setValue.isPending}
                    onClick={() => apply(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : null}
            {helper.kind.kind === 'boolean' ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={helper.value === true ? 'default' : 'outline'}
                  disabled={setValue.isPending}
                  onClick={() => apply(true)}
                >
                  On
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={helper.value === false ? 'default' : 'outline'}
                  disabled={setValue.isPending}
                  onClick={() => apply(false)}
                >
                  Off
                </Button>
              </div>
            ) : null}
            {helper.kind.kind === 'number' || helper.kind.kind === 'string' ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (helper.kind.kind === 'number') {
                    const parsed = Number(draft);
                    if (draft.trim() === '' || Number.isNaN(parsed)) {
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
                <Button type="submit" size="sm" disabled={setValue.isPending}>
                  Set
                </Button>
              </form>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </>
        )}
      </CardContent>
    </DashboardCard>
  );
};
