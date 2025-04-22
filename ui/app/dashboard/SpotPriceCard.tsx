'use client';

import { Card } from 'react-daisyui';
import { useSpotPriceQuery } from '@/hooks/influxdb';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Rectangle,
  ResponsiveContainer,
} from 'recharts';

const spotPriceToColor = (spotPrice: number) => {
  const h = Math.min(Math.max(0, 120 - 5 * spotPrice), 300);
  const s = 0.45;
  const v = 0.4;
  return `hsl(${h}, ${s * 100}%, ${v * 100}%)`;
};

export const SpotPriceCard = () => {
  const spotPrice = useSpotPriceQuery();

  const data = spotPrice
    .filter((row) => {
      return (
        new Date(row._time).getTime() >=
        new Date(new Date().getTime() - 1 * 60 * 60 * 1000).getTime()
      );
    })
    .map((row) => {
      const color = spotPriceToColor(row._value);
      return {
        time: new Date(row._time).getTime(),
        value: row._value,
        fill: color,
      };
    });

  return (
    <>
      <Card
        compact
        className="col-span-2 flex-row justify-around bg-base-300 overflow-hidden"
      >
        <Card.Body className="pr-12 min-h-60 -mt-4 -mb-2 -mx-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{
                top: 20,
                right: 0,
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis
                dataKey="time"
                interval="equidistantPreserveStart"
                tickFormatter={(date) =>
                  new Date(date).toLocaleTimeString('en-FI', {
                    second: undefined,
                    timeStyle: 'short',
                  })
                }
                tickMargin={8}
              />
              <YAxis tickMargin={8} />
              <Bar type="step" dataKey="value" radius={3} />
              {/* <Customized component={CurrentTimeMarker} /> */}
            </BarChart>
          </ResponsiveContainer>
        </Card.Body>
      </Card>
    </>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CurrentTimeMarker = (props: any) => {
  const { formattedGraphicalItems } = props;

  const firstSeries = formattedGraphicalItems[0];

  if (!firstSeries || !firstSeries?.props?.data) {
    return null;
  }

  const firstPoint = firstSeries?.props?.data[0];
  const lastPoint =
    firstSeries?.props?.data[firstSeries?.props?.data.length - 1];

  if (!firstPoint || !lastPoint) {
    return null;
  }

  const firstT = firstPoint?.time;
  const firstX = firstPoint?.x;

  const lastT = lastPoint?.time;
  const lastX = lastPoint?.x;

  const currentTime = new Date().getTime();
  // linear interpolation
  const currentX =
    firstX + ((lastX - firstX) / (lastT - firstT)) * (currentTime - firstT);

  const currentPrice = firstSeries.props.data.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => d.time <= currentTime,
  );

  // Draw vertical line at current time
  return (
    <Rectangle
      x={currentX - 4}
      y={0}
      width={2}
      height={1000}
      stroke={spotPriceToColor(currentPrice?.value)}
      strokeWidth={2}
      opacity={0.5}
    />
  );
};
