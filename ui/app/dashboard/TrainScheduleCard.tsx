import clsx from 'clsx';
import { useState } from 'react';
import { useInterval, useTimeout } from 'usehooks-ts';
import { Clock3, TrainFront } from 'lucide-react';
import useIdle from '@/hooks/useIdle';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionNumber,
  getDashboardWidgetOptionBoolean,
  getDashboardWidgetOptionString,
  resolveDashboardWidgetUrl,
} from '@/hooks/useDashboard';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { useWidgetResource } from '@/hooks/useWidgetResource';
import { Button } from '@/ui/primitives/button';
import { CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { WidgetCard, WidgetHeading } from './WidgetChrome';

type RealtimeState =
  | 'SCHEDULED'
  | 'UPDATED'
  | 'CANCELED'
  | 'ADDED'
  | 'MODIFIED';

type Train = {
  destination?: string;
  directionId?: string;
  departureAt?: number;
  leaveAt?: number;
  minUntilHomeDeparture: number;
  name: string;
  departureFormatted: string;
  realtime: boolean;
  realtimeState: RealtimeState;
};

export const TrainScheduleCard = ({ widget }: { widget?: DashboardWidget }) => {
  const { apiEndpoint } = useAppConfig();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useInterval(() => setNow(Date.now()), 15000);
  const isIdle = useIdle();
  const trainApiUrl = getDashboardWidgetOptionString(widget, 'trainApiUrl', '');
  const stationId = getDashboardWidgetOptionString(
    widget,
    'stationId',
    'HSL:2131551',
  );
  const walkMinutes = getDashboardWidgetOptionNumber(widget, 'walkMinutes', 12);
  const resultLimit = getDashboardWidgetOptionNumber(widget, 'limit', 5);
  const displayLimit = Math.max(
    1,
    Math.min(20, getDashboardWidgetOptionNumber(widget, 'displayLimit', 3)),
  );
  const scrollMore = getDashboardWidgetOptionBoolean(
    widget,
    'scrollMore',
    false,
  );
  const requestedLimit = Math.max(
    resultLimit,
    displayLimit + (scrollMore ? 5 : 0),
  );
  const destination = getDashboardWidgetOptionString(widget, 'destination', '');
  const directionId = getDashboardWidgetOptionString(widget, 'directionId', '');
  const hasProxyOptions =
    trainApiUrl ||
    destination ||
    directionId ||
    stationId !== 'HSL:2131551' ||
    walkMinutes !== 12 ||
    resultLimit !== 5;
  const trainSchedulePath = hasProxyOptions
    ? buildDashboardWidgetProxyPath('/api/train-schedule', {
        url: trainApiUrl,
        station_id: stationId,
        walk_minutes: walkMinutes,
        limit: requestedLimit,
        destination,
        direction_id: directionId,
      })
    : getDashboardWidgetOptionString(
        widget,
        'trainSchedulePath',
        '/api/train-schedule',
      );
  const trainScheduleUrl = resolveDashboardWidgetUrl(
    apiEndpoint,
    trainSchedulePath,
  );

  const query = useWidgetResource<Train[]>(trainScheduleUrl);
  const trains = (query.data ?? []).filter(
    (train) =>
      train.departureAt === undefined || train.departureAt * 1000 >= now,
  );
  const error = query.isError ? 'Departures could not be refreshed.' : null;

  useTimeout(
    () => setDetailsOpen(false),
    detailsOpen && isIdle ? 10 * 1000 : null,
  );

  const departureRows = (rows: Train[], compact = false) => (
    <div className="divide-y divide-border/45">
      {(compact && !scrollMore ? rows.slice(0, displayLimit) : rows).map(
        (train, index) => {
          const remaining =
            train.leaveAt === undefined
              ? train.minUntilHomeDeparture
              : Math.floor((train.leaveAt * 1000 - now) / 60000);
          const cancelled = train.realtimeState === 'CANCELED';
          return (
            <div
              key={`${train.name}-${train.departureFormatted}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{train.name}</div>
                <div className="truncate text-sm">
                  {train.destination || 'Destination unavailable'}
                </div>
                <div className="text-xs text-muted-foreground">
                  Departure {train.departureFormatted}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {!train.realtime && !cancelled ? 'Scheduled' : ''}
              </span>
              <div
                className={clsx(
                  'min-w-16 rounded-xl px-3 py-2 text-right',
                  remaining <= 5 && !cancelled
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                    : 'bg-muted/60',
                )}
              >
                <div className="text-lg font-semibold leading-none tabular-nums">
                  {cancelled
                    ? 'Cancelled'
                    : remaining === 0
                      ? 'Now'
                      : remaining}
                </div>
                <div className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide">
                  {cancelled
                    ? 'departure cancelled'
                    : remaining === 0
                      ? 'Leave home'
                      : 'min to leave'}
                </div>
              </div>
            </div>
          );
        },
      )}
    </div>
  );

  return (
    <>
      <WidgetCard className="col-span-4">
        <Button
          variant="ghost"
          className="group h-full w-full items-stretch rounded-[inherit] p-0 text-left hover:bg-muted/30"
          onClick={() => setDetailsOpen(true)}
        >
          <CardContent className="w-full p-[var(--widget-padding,1rem)]">
            <WidgetHeading
              icon={<TrainFront />}
              label="Next departures"
              detail
            />
            <div
              className="mt-2 overflow-y-auto overscroll-contain"
              style={
                scrollMore
                  ? { maxHeight: `${displayLimit * 5.25}rem` }
                  : undefined
              }
            >
              {departureRows(trains, true)}
            </div>
            {error && (
              <p role="status" className="text-sm text-muted-foreground">
                Departures could not be refreshed
                {trains.length ? '; showing earlier results.' : '.'}
              </p>
            )}
            {trains.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="size-4" />{' '}
                {query.isPending
                  ? 'Loading departures…'
                  : error
                    ? 'Departures unavailable'
                    : 'No matching departures'}
              </div>
            ) : null}
          </CardContent>
        </Button>
      </WidgetCard>

      <ResponsiveOverlay
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Train departures"
        description="Departure time and when to leave home."
        className="max-w-3xl"
      >
        <div className="space-y-3 px-5 pb-5 md:px-0 md:pb-0">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {trains.length > 0 ? (
            departureRows(trains)
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              No upcoming departures
            </div>
          )}
        </div>
      </ResponsiveOverlay>
    </>
  );
};
