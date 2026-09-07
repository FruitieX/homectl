import { TimeSeriesPlot } from './TimeSeriesPlot';
type Point = {
  time: Date;
  temp?: number;
  temp_percentile_10?: number;
  temp_percentile_90?: number;
  precipitation_amount?: number;
  precipitation_amount_max?: number;
  precipitation_amount_min?: number;
  period_hours?: number;
  wind_speed?: number;
  wind_speed_of_gust?: number;
  wind_speed_percentile_10?: number;
  wind_speed_percentile_90?: number;
};
export function WeatherChart({
  data,
  width,
  height,
  chartType,
}: {
  data: Point[];
  width: number;
  height: number;
  chartType: 'temperature' | 'precipitation' | 'wind';
  animate?: boolean;
}) {
  const precipitation = chartType === 'precipitation',
    temperature = chartType === 'temperature';
  return (
    <TimeSeriesPlot
      label={`${chartType} forecast`}
      unit={temperature ? '°C' : precipitation ? 'mm / period' : 'm/s'}
      width={width}
      height={height}
      zero={!temperature}
      series={[
        {
          name: temperature
            ? 'Temperature'
            : precipitation
              ? 'Expected rain'
              : 'Wind',
          bars: precipitation,
          className: temperature
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-sky-700 dark:text-sky-300',
          points: data.flatMap((p) => {
            const value = temperature
              ? p.temp
              : precipitation
                ? p.precipitation_amount
                : p.wind_speed;
            return value === undefined
              ? []
              : [
                  {
                    time: p.time.getTime(),
                    value,
                    low: temperature
                      ? p.temp_percentile_10
                      : precipitation
                        ? undefined
                        : p.wind_speed_percentile_10,
                    high: temperature
                      ? p.temp_percentile_90
                      : precipitation
                        ? p.precipitation_amount_max
                        : p.wind_speed_percentile_90,
                    end: precipitation
                      ? p.time.getTime() + (p.period_hours ?? 1) * 3600000
                      : undefined,
                  },
                ];
          }),
        },
      ]}
    />
  );
}
