import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
  resolveDashboardWidgetUrl,
} from '@/hooks/useDashboard';
import { Card, CardContent } from '@/ui/primitives/card';

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
  const trainScheduleUrl = resolveDashboardWidgetUrl(
    apiEndpoint,
    getDashboardWidgetOptionString(
      widget,
      'trainSchedulePath',
      '/api/train-schedule',
    ),
  );

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const trains = await fetchTrainSchedule(trainScheduleUrl);
      if (isSubscribed === true) {
        setTrains(trains);
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [trainScheduleUrl]);

  useInterval(async () => {
    const trains = await fetchTrainSchedule(trainScheduleUrl);
    setTrains(trains);
  }, 60 * 1000);

  return (
    <Card className="col-span-4">
      <CardContent className="overflow-x-auto py-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Train</th>
              <th className="px-3 py-2 font-medium">Departure</th>
              <th className="px-3 py-2 font-medium">Leave home</th>
            </tr>
          </thead>
          <tbody>
            {trains.map((train, index) => {
              return (
                <tr key={index} className="border-t border-border text-xl">
                  <td className="px-3 py-2">{train.name}</td>
                  <td className="px-3 py-2">{train.departureFormatted}</td>
                  <td
                    className={clsx(
                      'px-3 py-2',
                      train.realtime ? 'font-extrabold' : 'text-stone-500',
                    )}
                  >
                    {train.minUntilHomeDeparture}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trains.length === 0 && (
          <span className="py-2 pl-4 font-extrabold text-muted-foreground">
            No scheduled trains
          </span>
        )}
      </CardContent>
    </Card>
  );
};
