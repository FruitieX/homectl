import { TimeSeriesPlot } from './TimeSeriesPlot';
export function SpotPriceChart({
  data,
  width,
  height,
  showCurrentTime = true,
  showLegend = true,
  showUnit = true,
  onTap,
}: {
  data: { time: number; value: number; fill?: string; end?: number }[];
  width: number;
  height: number;
  animate?: boolean;
  showCurrentTime?: boolean;
  showLegend?: boolean;
  showUnit?: boolean;
  onTap?: () => void;
}) {
  return (
    <TimeSeriesPlot
      label="Electricity prices"
      unit="c/kWh"
      width={width}
      height={height}
      zero
      showNow={showCurrentTime}
      showLegend={showLegend}
      showUnit={showUnit}
      onTap={onTap}
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
