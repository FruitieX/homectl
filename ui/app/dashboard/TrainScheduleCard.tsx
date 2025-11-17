import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Card, Table } from 'react-daisyui';
import { useInterval } from 'usehooks-ts';

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

const fetchTrainSchedule = async (): Promise<Train[]> => {
  const res = await fetch('/api/train-schedule');
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

export const TrainScheduleCard = () => {
  const [trains, setTrains] = useState<Train[]>([]);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const trains = await fetchTrainSchedule();
      if (isSubscribed === true) {
        setTrains(trains);
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  useInterval(async () => {
    const trains = await fetchTrainSchedule();
    setTrains(trains);
  }, 60 * 1000);

  return (
    <Card compact className="col-span-4 bg-base-300">
      <Card.Body className="py-4">
        <Table>
          <Table.Head>
            <span>Train</span>
            <span>Departure</span>
            <span>Leave home</span>
          </Table.Head>
          <Table.Body>
            {trains.map((train, index) => {
              return (
                <Table.Row key={index} className={'text-xl'}>
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
        {trains.length === 0 && (
          <span className="text-stone-500 pl-4 font-extrabold py-2">
            No scheduled trains
          </span>
        )}
      </Card.Body>
    </Card>
  );
};
