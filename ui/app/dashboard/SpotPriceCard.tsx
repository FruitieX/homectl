'use client';

import { Card } from 'react-daisyui';
import { useSpotPriceQuery } from '@/hooks/influxdb';
import { SpotPriceChart } from '@/ui/charts/SpotPriceChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';

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
        className="col-span-2 flex-row justify-around bg-base-300 overflow-hidden min-h-60"
      >
        <Card.Body className="p-2 w-full">
          <ResponsiveChart
            height={240}
            className="rounded-lg overflow-hidden w-full"
          >
            {({ width, height }) => (
              <SpotPriceChart
                data={data}
                width={width}
                height={height}
                animate={true}
                showCurrentTime={true}
              />
            )}
          </ResponsiveChart>
        </Card.Body>
      </Card>
    </>
  );
};
