import { NextResponse } from 'next/server';
import { serverCache } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

type Trip = {
  routeShortName: string;
};

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

export async function GET() {
  try {
    const trainApiUrl = process.env.TRAIN_API_URL;

    if (!trainApiUrl) {
      return NextResponse.json(
        { error: 'TRAIN_API_URL environment variable not set' },
        { status: 500 },
      );
    }

    const trains = await serverCache.get<Train[]>(
      'trainScheduleCache',
      1, // Cache for 1 minute
      async () => {
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

        if (!res.ok) {
          throw new Error(`Failed to fetch train schedule: ${res.status}`);
        }

        const json: HslResponse = await res.json();
        const stop = json.data.stop;

        const trainsToCatch = stop.stoptimesWithoutPatterns.flatMap((st) => {
          const secSinceMidnight = getSecSinceMidnight(new Date());
          const departureSecSinceMidnight = st.realtimeDeparture;

          const secUntilDeparture =
            departureSecSinceMidnight - secSinceMidnight;
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
      },
    );

    return NextResponse.json(trains);
  } catch (error) {
    console.error('Error fetching train schedule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train schedule' },
      { status: 500 },
    );
  }
}
