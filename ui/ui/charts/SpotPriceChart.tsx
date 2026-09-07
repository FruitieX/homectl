import { TimeSeriesPlot } from './TimeSeriesPlot';
export function SpotPriceChart({
  data,
  width,
  height,
  showCurrentTime = true,
}: {
  data: { time: number; value: number; fill: string; end?: number }[];
  width: number;
  height: number;
  animate?: boolean;
  showCurrentTime?: boolean;
}) {
  return (
    <TimeSeriesPlot
      label="Electricity prices"
      unit="c/kWh"
      width={width}
      height={height}
      zero
      showNow={showCurrentTime}
      series={[
        {
          name: 'Spot price',
          bars: true,
          points: data.map((point, index) => ({
            ...point,
            end: point.end ?? data[index + 1]?.time ?? point.time + 3600000,
          })),
        },
      ]}
    />
  );
}
