import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useInterval, useTimeout } from 'usehooks-ts';
import { Clock3, TrainFront } from 'lucide-react';
import useIdle from '@/hooks/useIdle';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionNumber,
  getDashboardWidgetOptionString,
  resolveDashboardWidgetUrl,
} from '@/hooks/useDashboard';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { WidgetCard, WidgetHeading } from './WidgetChrome';

type Trip = {
  routeShortName: string;
};

// SCHEDULED
// The trip information comes from the GTFS feed, i.e. no real-time update has been applied.

// UPDATED
// The trip information has been updated, but the trip pattern stayed the same as the trip pattern of the scheduled trip.

// CANCELED
// The trip has been canceled by a real-time update.

// ADDED
// The trip has been added using a real-time update, i.e. the trip was not present in the GTFS feed.

// MODIFIED
// The trip information has been updated and resulted in a different trip pattern compared to the trip pattern of the scheduled trip.

type RealtimeState =
  | 'SCHEDULED'
  | 'UPDATED'
  | 'CANCELED'
  | 'ADDED'
  | 'MODIFIED';

type StopTime = {
  scheduledDeparture: number;
  realtimeDeparture: number;
  realtime: boolean;
  realtimeState: RealtimeState;
  serviceDay: number;
  headsign: string;
  trip: Trip;
};

type Stop = {
  name: string;
  stoptimesWithoutPatterns: StopTime[];
};

type HslResponse = {
  data: {
    stop: Stop;
  };
};

const fetchTrainSchedule = async (
  trainScheduleUrl: string,
): Promise<Train[]> => {
  const res = await fetch(trainScheduleUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch train schedule: ${res.status}`);
  }
  const trains: Train[] = await res.json();
  return trains;
};

type Train = {
  minUntilHomeDeparture: number;
  name: string;
  departureFormatted: string;
  realtime: boolean;
  realtimeState: RealtimeState;
};

function getSecSinceMidnight(d: Date) {
  const e = new Date(d);
  return (d.valueOf() - e.setHours(0, 0, 0, 0)) / 1000;
}

export const TrainScheduleCard = ({ widget }: { widget?: DashboardWidget }) => {
  const { apiEndpoint } = useAppConfig();
  const [trains, setTrains] = useState<Train[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isIdle = useIdle();
  const trainApiUrl = getDashboardWidgetOptionString(widget, 'trainApiUrl', '');
  const stationId = getDashboardWidgetOptionString(
    widget,
    'stationId',
    'HSL:2131551',
  );
  const walkMinutes = getDashboardWidgetOptionNumber(widget, 'walkMinutes', 12);
  const resultLimit = getDashboardWidgetOptionNumber(widget, 'limit', 5);
  const hasProxyOptions =
    trainApiUrl ||
    stationId !== 'HSL:2131551' ||
    walkMinutes !== 12 ||
    resultLimit !== 5;
  const trainSchedulePath = hasProxyOptions
    ? buildDashboardWidgetProxyPath('/api/train-schedule', {
        url: trainApiUrl,
        station_id: stationId,
        walk_minutes: walkMinutes,
        limit: resultLimit,
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

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const trains = await fetchTrainSchedule(trainScheduleUrl);
        if (isSubscribed === true) {
          setTrains(trains);
          setError(null);
        }
      } catch (cause) {
        if (isSubscribed === true) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Failed to fetch departures',
          );
        }
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [trainScheduleUrl]);

  useInterval(async () => {
    try {
      setTrains(await fetchTrainSchedule(trainScheduleUrl));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to fetch departures',
      );
    }
  }, 60 * 1000);

  useTimeout(
    () => setDetailsOpen(false),
    detailsOpen && isIdle ? 10 * 1000 : null,
  );

  const departureRows = (rows: Train[], compact = false) => (
    <div className="divide-y divide-border/45">
      {(compact ? rows.slice(0, 3) : rows).map((train, index) => (
        <div
          key={`${train.name}-${train.departureFormatted}-${index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3"
        >
          <div className="min-w-0">
            <div className="truncate font-semibold">{train.name}</div>
            <div className="text-xs text-muted-foreground">
              Departure {train.departureFormatted}
            </div>
          </div>
          {train.realtime ? <Badge variant="muted">Realtime</Badge> : <span />}
          <div
            className={clsx(
              'min-w-16 rounded-xl px-3 py-2 text-right',
              train.minUntilHomeDeparture <= 5
                ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                : 'bg-muted/60',
            )}
          >
            <div className="text-lg font-semibold leading-none tabular-nums">
              {Math.max(0, train.minUntilHomeDeparture)}
            </div>
            <div className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide">
              min to leave
            </div>
          </div>
        </div>
      ))}
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
          <CardContent className="w-full p-4 sm:p-5">
            <WidgetHeading
              icon={<TrainFront />}
              label="Next departures"
              detail
            />
            <div className="mt-2">{departureRows(trains, true)}</div>
            {trains.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="size-4" /> No upcoming departures
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
