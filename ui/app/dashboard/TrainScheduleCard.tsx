import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Card, Table } from 'react-daisyui';
import { useInterval } from 'usehooks-ts';
import { cachedPromise } from './cachedPromise';
import { useAppConfig } from '@/hooks/appConfig';

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

const fetchCachedTrainSchedule = async (
  trainApiUrl: string,
): Promise<Train[]> => {
  const json = await cachedPromise('trainScheduleCache', 1, async () => {
    const res = await fetch(trainApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/graphql',
      },
      body: `
{
  stop(id: "HSL:2131551") {
    name
    stoptimesWithoutPatterns {
      scheduledDeparture
      realtimeDeparture
      realtime
      realtimeState
      serviceDay
      headsign
      trip {
        routeShortName
      }
    }
  }
}
      `,
    });
    const json: HslResponse = await res.json();
    return json;
  });

  const stop = json.data.stop;
  const trainsToCatch = stop.stoptimesWithoutPatterns.flatMap((st) => {
    const secSinceMidnight = getSecSinceMidnight(new Date());
    const departureSecSinceMidnight = st.realtimeDeparture;

    const secUntilDeparture = departureSecSinceMidnight - secSinceMidnight;
    const minUntilDeparture = secUntilDeparture / 60;
    const suggestedMinUntilDeparture = 12;

    const minUntilHomeDeparture = Math.floor(
      minUntilDeparture - suggestedMinUntilDeparture,
    );
    if (minUntilHomeDeparture < -5) {
      return [];
    }

    const departureFormatted = new Date(st.realtimeDeparture * 1000)
      .toISOString()
      .slice(11, 16);

    return [
      {
        minUntilHomeDeparture,
        name: st.trip.routeShortName,
        departureFormatted,
        realtime: st.realtime,
        realtimeState: st.realtimeState,
      },
    ];
  });

  return trainsToCatch.slice(0, 5);
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

export const TrainScheduleCard = () => {
  const [trains, setTrains] = useState<Train[]>([]);

  const trainApiUrl = useAppConfig().trainApiUrl;

  useEffect(() => {
    let isSubscribed = true;

    const fetch = async () => {
      const trains = await fetchCachedTrainSchedule(trainApiUrl);
      if (isSubscribed === true) {
        setTrains(trains);
      }
    };
    fetch();

    return () => {
      isSubscribed = false;
    };
  }, [trainApiUrl]);

  useInterval(async () => {
    const trains = await fetchCachedTrainSchedule(trainApiUrl);
    setTrains(trains);
  }, 60 * 1000);

  return (
    <Card compact className="col-span-2">
      <Card.Body className="shadow-lg">
        <Table>
          <Table.Head>
            <span>Train</span>
            <span>Departure</span>
            <span>Leave home</span>
          </Table.Head>
          <Table.Body>
            {trains.map((train, index) => {
              return (
                <Table.Row key={index} className={clsx(['text-xl'])}>
                  <span>{train.name}</span>
                  <span>{train.departureFormatted}</span>
                  <span
                    className={
                      train.realtime ? 'font-extrabold' : 'text-stone-500'
                    }
                  >
                    {train.minUntilHomeDeparture}
                  </span>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </Card.Body>
    </Card>
  );
};
