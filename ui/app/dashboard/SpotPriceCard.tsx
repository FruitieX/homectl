'use client';

import { Card } from 'react-daisyui';
import { useSpotPriceQuery } from '@/hooks/influxdb';
import { SpotPriceChart, spotPriceToColor } from '@/ui/charts/SpotPriceChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { useMemo } from 'react';

export const SpotPriceCard = () => {
  const spotPrice = useSpotPriceQuery();

  // Memoize the data transformation to prevent unnecessary re-renders
  const data = useMemo(() => {
    const oneHourAgo = new Date().getTime() - 1 * 60 * 60 * 1000;

    return spotPrice
      .filter((row) => {
        return new Date(row._time).getTime() >= oneHourAgo;
      })
      .map((row) => {
        const color = spotPriceToColor(row._value);
        return {
          time: new Date(row._time).getTime(),
          value: row._value,
          fill: color || '#6b7280',
        };
      });
  }, [spotPrice]);

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
