import React, { useMemo, memo } from 'react';
import { AreaClosed, LinePath, Line, Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleTime, scaleLinear } from '@visx/scale';
import { LinearGradient } from '@visx/gradient';
import { GridRows } from '@visx/grid';
import { curveCardinal } from '@visx/curve';
import { bisector } from 'd3-array';
import { useChartTooltip, TooltipPosition } from './hooks/useChartTooltip';
import { ChartTooltip, TooltipField } from './ChartTooltip';
import { getTemperatureColor } from './TemperatureSensorChart';
import { ChartInteractionOverlay } from './ChartInteractionOverlay';

interface WeatherDataPoint {
  time: Date;
  temp?: number;
  temp_percentile_10?: number;
  temp_percentile_90?: number;
  max_temp?: number;
  min_temp?: number;
  precipitation_amount?: number;
  precipitation_amount_max?: number;
  precipitation_amount_min?: number;
  probability_of_precipitation?: number;
  wind_speed?: number;
  wind_speed_of_gust?: number;
  wind_speed_percentile_10?: number;
  wind_speed_percentile_90?: number;
}

interface WeatherChartProps {
  data: WeatherDataPoint[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  chartType: 'temperature' | 'precipitation' | 'wind';
  animate?: boolean;
}

const defaultMargin = { top: 20, right: 20, bottom: 40, left: 50 };

const bisectDate = bisector<WeatherDataPoint, Date>(
  (d: WeatherDataPoint) => d.time,
).left;

// Memoized Temperature Chart Component
const TemperatureChart = memo(
  ({
    limitedData,
    xScale,
    yScale,
    getYValue,
    innerHeight,
  }: {
    limitedData: WeatherDataPoint[];
    xScale: any;
    yScale: any;
    getYValue: (d: WeatherDataPoint) => number;
    innerHeight: number;
  }) => {
    // Generate temperature gradients that follow the data path
    const validTemperatureData = limitedData.filter(
      (d) => getYValue(d) !== undefined,
    );
    const temperaturePathGradients =
      validTemperatureData.length > 0
        ? validTemperatureData.map((d, i) => {
            const temp = getYValue(d);
            const xRange = xScale.range()[1] - xScale.range()[0];
            const x = xRange > 0 ? ((xScale(d.time) ?? 0) / xRange) * 100 : 0;
            return {
              offset: `${Math.max(0, Math.min(100, x))}%`,
              color: getTemperatureColor(temp),
            };
          })
        : [
            { offset: '0%', color: getTemperatureColor(15) },
            { offset: '100%', color: getTemperatureColor(15) },
          ];

    const validMaxTempData = limitedData.filter(
      (d) => d.max_temp !== undefined,
    );
    const maxTempPathGradients =
      validMaxTempData.length > 0
        ? validMaxTempData.map((d, i) => {
            const temp = d.max_temp!;
            const xRange = xScale.range()[1] - xScale.range()[0];
            const x = xRange > 0 ? ((xScale(d.time) ?? 0) / xRange) * 100 : 0;
            return {
              offset: `${Math.max(0, Math.min(100, x))}%`,
              color: getTemperatureColor(temp),
            };
          })
        : [
            { offset: '0%', color: getTemperatureColor(20) },
            { offset: '100%', color: getTemperatureColor(20) },
          ];

    const validMinTempData = limitedData.filter(
      (d) => d.min_temp !== undefined,
    );
    const minTempPathGradients =
      validMinTempData.length > 0
        ? validMinTempData.map((d, i) => {
            const temp = d.min_temp!;
            const xRange = xScale.range()[1] - xScale.range()[0];
            const x = xRange > 0 ? ((xScale(d.time) ?? 0) / xRange) * 100 : 0;
            return {
              offset: `${Math.max(0, Math.min(100, x))}%`,
              color: getTemperatureColor(temp),
            };
          })
        : [
            { offset: '0%', color: getTemperatureColor(10) },
            { offset: '100%', color: getTemperatureColor(10) },
          ];

    const validRangeTempData = limitedData.filter(
      (d) => d.min_temp !== undefined && d.max_temp !== undefined,
    );
    const rangeTempPathGradients =
      validRangeTempData.length > 0
        ? validRangeTempData.map((d, i) => {
            const avgTemp = (d.min_temp! + d.max_temp!) / 2;
            const xRange = xScale.range()[1] - xScale.range()[0];
            const x = xRange > 0 ? ((xScale(d.time) ?? 0) / xRange) * 100 : 0;
            return {
              offset: `${Math.max(0, Math.min(100, x))}%`,
              color: getTemperatureColor(avgTemp),
            };
          })
        : [
            { offset: '0%', color: getTemperatureColor(15) },
            { offset: '100%', color: getTemperatureColor(15) },
          ];

    return (
      <>
        {/* Dynamic gradients for temperature paths */}
        <defs>
          <linearGradient
            id="temperaturePathGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            {temperaturePathGradients.map((stop, i) => (
              <stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          <linearGradient
            id="temperatureMaxPathGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            {maxTempPathGradients.map((stop, i) => (
              <stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          <linearGradient
            id="temperatureMinPathGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            {minTempPathGradients.map((stop, i) => (
              <stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          <linearGradient
            id="temperatureRangePathGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            {rangeTempPathGradients.map((stop, i) => (
              <stop
                key={i}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={0.3}
              />
            ))}
          </linearGradient>
        </defs>

        {/* Percentile range area (10th to 90th percentile) */}
        {limitedData[0]?.temp_percentile_10 !== undefined &&
          limitedData[0]?.temp_percentile_90 !== undefined && (
            <AreaClosed<any>
              data={limitedData.filter(
                (d) =>
                  d.temp_percentile_10 !== undefined &&
                  d.temp_percentile_90 !== undefined,
              )}
              x={(d) => xScale(d.time) ?? 0}
              y0={(d) => yScale(d.temp_percentile_10!) ?? 0}
              y1={(d) => yScale(d.temp_percentile_90!) ?? 0}
              yScale={yScale}
              fill="url(#temperaturePercentileYGradient)"
              mask="url(#temperaturePercentileMask)"
              stroke="url(#temperaturePercentileStrokeGradient)"
              strokeWidth={1}
              strokeOpacity={1}
              strokeDasharray="2,2"
              curve={curveCardinal}
            />
          )}

        {/* Min-Max temperature area */}
        {limitedData[0]?.max_temp !== undefined &&
          limitedData[0]?.min_temp !== undefined && (
            <AreaClosed<any>
              data={limitedData.filter(
                (d) => d.max_temp !== undefined && d.min_temp !== undefined,
              )}
              x={(d) => xScale(d.time) ?? 0}
              y0={(d) => yScale(d.min_temp!) ?? 0}
              y1={(d) => yScale(d.max_temp!) ?? 0}
              yScale={yScale}
              fill="url(#temperatureRangePathGradient)"
              stroke="transparent"
              curve={curveCardinal}
            />
          )}

        {/* Main temperature line with smooth interpolation and path gradient */}
        <LinePath<any>
          data={limitedData.filter((d) => getYValue(d) !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(getYValue(d)) ?? 0}
          stroke="url(#temperaturePathGradient)"
          strokeWidth={3}
          curve={curveCardinal}
          fill="transparent"
        />

        {/* Max temperature line */}
        {limitedData[0]?.max_temp !== undefined && (
          <LinePath<any>
            data={limitedData.filter((d) => d.max_temp !== undefined)}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.max_temp!) ?? 0}
            stroke="url(#temperatureMaxPathGradient)"
            strokeWidth={1}
            strokeOpacity={1}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}

        {/* Min temperature line */}
        {limitedData[0]?.min_temp !== undefined && (
          <LinePath<any>
            data={limitedData.filter((d) => d.min_temp !== undefined)}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.min_temp!) ?? 0}
            stroke="url(#temperatureMinPathGradient)"
            strokeWidth={2}
            strokeOpacity={1}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}
      </>
    );
  },
);

TemperatureChart.displayName = 'TemperatureChart';

// Memoized Precipitation Chart Component
const PrecipitationChart = memo(
  ({
    limitedData,
    xScale,
    yScale,
    getYValue,
    innerWidth,
    innerHeight,
  }: {
    limitedData: WeatherDataPoint[];
    xScale: any;
    yScale: any;
    getYValue: (d: WeatherDataPoint) => number;
    innerWidth: number;
    innerHeight: number;
  }) => {
    return (
      <>
        {/* Precipitation range area */}
        {limitedData.some(
          (d) =>
            d.precipitation_amount_max !== undefined &&
            d.precipitation_amount_min !== undefined,
        ) && (
          <AreaClosed<any>
            data={limitedData.filter(
              (d) =>
                d.precipitation_amount_max !== undefined &&
                d.precipitation_amount_min !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y0={(d) => yScale(d.precipitation_amount_min!) ?? 0}
            y1={(d) => yScale(d.precipitation_amount_max!) ?? 0}
            yScale={yScale}
            fill="url(#precipitationRangeGradient)"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="2,2"
            curve={curveCardinal}
          />
        )}

        {/* Max precipitation line */}
        {limitedData.some((d) => d.precipitation_amount_max !== undefined) && (
          <LinePath<any>
            data={limitedData.filter(
              (d) => d.precipitation_amount_max !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.precipitation_amount_max!) ?? 0}
            stroke="#2563eb"
            strokeWidth={1}
            strokeOpacity={0.7}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}

        {/* Min precipitation line */}
        {limitedData.some((d) => d.precipitation_amount_min !== undefined) && (
          <LinePath<any>
            data={limitedData.filter(
              (d) => d.precipitation_amount_min !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.precipitation_amount_min!) ?? 0}
            stroke="#3b82f6"
            strokeWidth={1}
            strokeOpacity={0.7}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}

        {/* Main precipitation bars */}
        {limitedData.map((d, i) => {
          const precipitation = getYValue(d);
          const barWidth = Math.max(2, (innerWidth / limitedData.length) * 0.8);
          const barHeight = innerHeight - (yScale(precipitation) ?? 0);
          const barX = (xScale(d.time) ?? 0) - barWidth / 2;
          const barY = yScale(precipitation) ?? 0;

          return (
            <g key={i}>
              {/* Main precipitation bar */}
              <rect
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill="url(#precipitationBarGradient)"
                stroke="url(#precipitationLineGradient)"
                strokeWidth={1}
                rx={1}
                ry={1}
                opacity={precipitation > 0 ? 0.8 : 0.1}
              />
            </g>
          );
        })}

        {/* Precipitation probability indicators using density dots */}
        {limitedData.map((d, i) => {
          if (
            !d.probability_of_precipitation ||
            d.probability_of_precipitation <= 10
          ) {
            return null;
          }

          const dataX = xScale(d.time) ?? 0;
          const probability = d.probability_of_precipitation;

          // Calculate number of dots based on probability (1-5 dots)
          const numDots = Math.ceil(probability / 20);

          // Calculate dot spacing to avoid overlap with dense data
          const maxDotWidth = Math.min(20, innerWidth / limitedData.length);
          const dotSize = Math.min(3, maxDotWidth / 3);
          const dotSpacing = dotSize + 1;

          // Position dots at bottom of chart
          const baseY = innerHeight - 1;

          // Color based on probability level
          const dotColor =
            probability > 70
              ? '#1e40af' // Dark blue for high probability
              : probability > 40
                ? '#3b82f6' // Medium blue for medium probability
                : '#60a5fa'; // Light blue for low probability

          return (
            <g key={`prob-${i}`}>
              {Array.from({ length: numDots }, (_, dotIndex) => {
                const dotX =
                  dataX -
                  ((numDots - 1) * dotSpacing) / 2 +
                  dotIndex * dotSpacing;
                const dotY = baseY - dotIndex * 2; // Stack dots slightly

                return (
                  <circle
                    key={dotIndex}
                    cx={dotX}
                    cy={dotY}
                    r={dotSize}
                    fill={dotColor}
                    opacity={0.8}
                    pointerEvents="none"
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  },
);

PrecipitationChart.displayName = 'PrecipitationChart';

// Memoized Wind Chart Component
const WindChart = memo(
  ({
    limitedData,
    xScale,
    yScale,
    getYValue,
  }: {
    limitedData: WeatherDataPoint[];
    xScale: any;
    yScale: any;
    getYValue: (d: WeatherDataPoint) => number;
  }) => {
    return (
      <>
        {/* Wind percentile range area (10th to 90th percentile) */}
        {limitedData[0]?.wind_speed_percentile_10 !== undefined &&
          limitedData[0]?.wind_speed_percentile_90 !== undefined && (
            <AreaClosed<any>
              data={limitedData.filter(
                (d) =>
                  d.wind_speed_percentile_10 !== undefined &&
                  d.wind_speed_percentile_90 !== undefined,
              )}
              x={(d) => xScale(d.time) ?? 0}
              y0={(d) => yScale(d.wind_speed_percentile_10!) ?? 0}
              y1={(d) => yScale(d.wind_speed_percentile_90!) ?? 0}
              yScale={yScale}
              fill="url(#windPercentileGradient)"
              stroke="#10b981"
              strokeWidth={1}
              strokeOpacity={0.6}
              strokeDasharray="2,2"
              curve={curveCardinal}
            />
          )}

        {/* Wind area under the line */}
        <LinePath<any>
          data={limitedData.filter((d) => getYValue(d) !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(getYValue(d)) ?? 0}
          stroke="url(#windGradient)"
          curve={curveCardinal}
        />

        {/* Wind speed line */}
        <LinePath<any>
          data={limitedData.filter((d) => getYValue(d) !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(getYValue(d)) ?? 0}
          stroke="url(#windLineGradient)"
          strokeWidth={3}
          curve={curveCardinal}
          fill="transparent"
        />

        {/* Wind gust line if available */}
        {limitedData[0]?.wind_speed_of_gust !== undefined && (
          <LinePath<any>
            data={limitedData.filter((d) => d.wind_speed_of_gust !== undefined)}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.wind_speed_of_gust!) ?? 0}
            stroke="#059669"
            strokeWidth={2}
            strokeOpacity={0.7}
            strokeDasharray="5,3"
            curve={curveCardinal}
            fill="transparent"
          />
        )}

        {/* Wind percentile lines */}
        {limitedData[0]?.wind_speed_percentile_90 !== undefined && (
          <LinePath<any>
            data={limitedData.filter(
              (d) => d.wind_speed_percentile_90 !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.wind_speed_percentile_90!) ?? 0}
            stroke="#059669"
            strokeWidth={1}
            strokeOpacity={0.5}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}

        {limitedData[0]?.wind_speed_percentile_10 !== undefined && (
          <LinePath<any>
            data={limitedData.filter(
              (d) => d.wind_speed_percentile_10 !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y={(d) => yScale(d.wind_speed_percentile_10!) ?? 0}
            stroke="#059669"
            strokeWidth={1}
            strokeOpacity={0.5}
            strokeDasharray="2,2"
            curve={curveCardinal}
            fill="transparent"
          />
        )}
      </>
    );
  },
);

WindChart.displayName = 'WindChart';

// Memoized Hover Elements Component
const HoverElements = memo(
  ({
    tooltipOpen,
    tooltipData,
    xScale,
    innerHeight,
  }: {
    tooltipOpen: boolean;
    tooltipData: WeatherDataPoint | undefined;
    xScale: any;
    innerHeight: number;
  }) => {
    if (!tooltipOpen || !tooltipData) return null;

    return (
      <Line
        from={{
          x: Math.max(2, xScale(tooltipData.time)),
          y: 0,
        }}
        to={{
          x: Math.max(2, xScale(tooltipData.time)),
          y: innerHeight,
        }}
        stroke="#9ca3af"
        strokeWidth={1}
        strokeOpacity={0.5}
        strokeDasharray="3,3"
      />
    );
  },
);

HoverElements.displayName = 'HoverElements';

const WeatherChartComponent: React.FC<WeatherChartProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
  chartType,
  animate = true,
}) => {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    hideTooltip,
    handleMouseMove,
    handleTouch,
    TooltipInPortal,
    containerRef,
    svgRef,
  } = useChartTooltip<WeatherDataPoint>({
    data,
    margin,
  });

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Limit data to next 7 days
  const limitedData = useMemo(() => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return data.filter((d) => d.time <= sevenDaysFromNow);
  }, [data]);

  // Generate midnight markers for multi-day charts
  const midnightLines = useMemo(() => {
    if (limitedData.length === 0) return [];

    const startDate = new Date(limitedData[0].time);
    const endDate = new Date(limitedData[limitedData.length - 1].time);
    const lines = [];

    // Start from the next midnight after the first data point
    let currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    currentDate.setDate(currentDate.getDate() + 1);

    while (currentDate <= endDate) {
      lines.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return lines;
  }, [limitedData]);

  const { xScale, yScale, getYValue, formatYValue, getGradientId } =
    useMemo(() => {
      const xScale = scaleTime<number>({
        range: [0, innerWidth],
        domain: [
          Math.min(...limitedData.map((d) => d.time.getTime())),
          Math.max(...limitedData.map((d) => d.time.getTime())),
        ],
      });

      let yScale: any;
      let getYValue: (d: WeatherDataPoint) => number;
      let formatYValue: (value: number) => string;
      let getGradientId: string;

      switch (chartType) {
        case 'temperature':
          const temps = limitedData.flatMap(
            (d) =>
              [
                d.temp,
                d.max_temp,
                d.min_temp,
                d.temp_percentile_10,
                d.temp_percentile_90,
              ].filter(Boolean) as number[],
          );
          yScale = scaleLinear<number>({
            range: [innerHeight, 0],
            domain: [Math.min(...temps) - 2, Math.max(...temps) + 2],
            nice: false,
          });
          getYValue = (d: WeatherDataPoint) => d.temp || d.max_temp || 0;
          formatYValue = (value: number) => `${value.toFixed(1)}°C`;
          getGradientId = 'temperatureGradient';
          break;

        case 'precipitation':
          const precips = limitedData.flatMap(
            (d) =>
              [
                d.precipitation_amount,
                d.precipitation_amount_max,
                d.precipitation_amount_min,
              ].filter(Boolean) as number[],
          );
          yScale = scaleLinear<number>({
            range: [innerHeight, 0],
            domain: [0, Math.max(...precips, 1) + 1],
            nice: false,
            clamp: true,
          });
          getYValue = (d: WeatherDataPoint) => d.precipitation_amount || 0;
          formatYValue = (value: number) => `${value.toFixed(1)}mm`;
          getGradientId = 'precipitationGradient';
          break;

        case 'wind':
          const winds = limitedData.flatMap((d) =>
            [
              d.wind_speed,
              d.wind_speed_of_gust,
              d.wind_speed_percentile_10,
              d.wind_speed_percentile_90,
            ].filter(Boolean),
          ) as number[];
          yScale = scaleLinear<number>({
            range: [innerHeight, 0],
            domain: [0, Math.max(...winds) + 2],
            nice: false,
          });
          getYValue = (d: WeatherDataPoint) => d.wind_speed || 0;
          formatYValue = (value: number) => `${value.toFixed(1)} m/s`;
          getGradientId = 'windGradient';
          break;
      }

      return {
        xScale,
        yScale,
        getYValue,
        formatYValue,
        getGradientId,
      };
    }, [data, innerWidth, innerHeight, chartType]);

  // Function to find data point based on position
  const findDataPoint = (
    position: TooltipPosition,
  ): WeatherDataPoint | undefined => {
    const x = position.x;
    const x0 = xScale.invert(x);
    const index = bisectDate(limitedData as any[], new Date(x0), 1);
    const d0 = limitedData[index - 1];
    const d1 = limitedData[index];
    let d = d0;
    if (d1 && x0) {
      d =
        x0.getTime() - d0.time.getTime() > d1.time.getTime() - x0.getTime()
          ? d1
          : d0;
    }
    return d;
  };

  // Function to get data point position for tooltip
  const getDataPointPosition = (datum: WeatherDataPoint) => {
    const x = xScale(datum.time) ?? 0;

    // Use the maximum value in the series for positioning (so tooltip doesn't cover max values)
    let maxValue = getYValue(datum);

    if (chartType === 'temperature') {
      maxValue = Math.max(
        datum.temp || 0,
        datum.max_temp || 0,
        datum.temp_percentile_90 || 0,
      );
    } else if (chartType === 'precipitation') {
      maxValue = Math.max(
        datum.precipitation_amount || 0,
        datum.precipitation_amount_max || 0,
      );
    } else if (chartType === 'wind') {
      maxValue = Math.max(
        datum.wind_speed || 0,
        datum.wind_speed_of_gust || 0,
        datum.wind_speed_percentile_90 || 0,
      );
    }

    const y = yScale(maxValue) ?? 0;
    return { x, y };
  };

  const renderTemperatureChart = () => (
    <>
      {/* Percentile range area (10th to 90th percentile) */}
      {limitedData[0]?.temp_percentile_10 !== undefined &&
        limitedData[0]?.temp_percentile_90 !== undefined && (
          <AreaClosed<any>
            data={limitedData.filter(
              (d) =>
                d.temp_percentile_10 !== undefined &&
                d.temp_percentile_90 !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y0={(d) => yScale(d.temp_percentile_10!) ?? 0}
            y1={(d) => yScale(d.temp_percentile_90!) ?? 0}
            yScale={yScale}
            fill="url(#temperaturePercentileGradient)"
            stroke="#fbbf24"
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="2,2"
            curve={curveCardinal}
          />
        )}

      {/* Min-Max temperature area */}
      {limitedData[0]?.max_temp !== undefined &&
        limitedData[0]?.min_temp !== undefined && (
          <AreaClosed<any>
            data={limitedData.filter(
              (d) => d.max_temp !== undefined && d.min_temp !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y0={(d) => yScale(d.min_temp!) ?? 0}
            y1={(d) => yScale(d.max_temp!) ?? 0}
            yScale={yScale}
            fill="url(#temperatureRangeGradient)"
            stroke="transparent"
            curve={curveCardinal}
          />
        )}

      {/* Main temperature line */}
      <LinePath<any>
        data={limitedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.time) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        stroke="url(#temperatureLineGradient)"
        strokeWidth={3}
        curve={curveCardinal}
        fill="transparent"
      />

      {/* Max temperature line */}
      {limitedData[0]?.max_temp !== undefined && (
        <LinePath<any>
          data={limitedData.filter((d) => d.max_temp !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.max_temp!) ?? 0}
          stroke="#ef4444"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="3,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Min temperature line */}
      {limitedData[0]?.min_temp !== undefined && (
        <LinePath<any>
          data={limitedData.filter((d) => d.min_temp !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.min_temp!) ?? 0}
          stroke="#3b82f6"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="3,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}
    </>
  );

  const renderPrecipitationChart = () => (
    <>
      {/* Precipitation range area */}
      {limitedData.some(
        (d) =>
          d.precipitation_amount_max !== undefined &&
          d.precipitation_amount_min !== undefined,
      ) && (
        <AreaClosed<any>
          data={limitedData.filter(
            (d) =>
              d.precipitation_amount_max !== undefined &&
              d.precipitation_amount_min !== undefined,
          )}
          x={(d) => xScale(d.time) ?? 0}
          y0={(d) => yScale(d.precipitation_amount_min!) ?? 0}
          y1={(d) => yScale(d.precipitation_amount_max!) ?? 0}
          yScale={yScale}
          fill="url(#precipitationRangeGradient)"
          stroke="#3b82f6"
          strokeWidth={1}
          strokeOpacity={0.6}
          strokeDasharray="2,2"
          curve={curveCardinal}
        />
      )}

      {/* Max precipitation line */}
      {limitedData.some((d) => d.precipitation_amount_max !== undefined) && (
        <LinePath<any>
          data={limitedData.filter(
            (d) => d.precipitation_amount_max !== undefined,
          )}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.precipitation_amount_max!) ?? 0}
          stroke="#2563eb"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="3,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Min precipitation line */}
      {limitedData.some((d) => d.precipitation_amount_min !== undefined) && (
        <LinePath<any>
          data={limitedData.filter(
            (d) => d.precipitation_amount_min !== undefined,
          )}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.precipitation_amount_min!) ?? 0}
          stroke="#3b82f6"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="3,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Main precipitation bars */}
      {limitedData.map((d, i) => {
        const precipitation = getYValue(d);
        const barWidth = Math.max(2, (innerWidth / limitedData.length) * 0.8);
        const barHeight = innerHeight - (yScale(precipitation) ?? 0);
        const barX = (xScale(d.time) ?? 0) - barWidth / 2;
        const barY = yScale(precipitation) ?? 0;

        return (
          <g key={i}>
            {/* Main precipitation bar */}
            <rect
              x={barX}
              y={barY}
              width={barWidth}
              height={barHeight}
              fill="url(#precipitationBarGradient)"
              stroke="url(#precipitationLineGradient)"
              strokeWidth={1}
              rx={1}
              ry={1}
              opacity={precipitation > 0 ? 0.8 : 0.1}
            />
          </g>
        );
      })}

      {/* Separate probability indicators at bottom of chart */}
      {limitedData.map((d, i) => {
        if (
          !d.probability_of_precipitation ||
          d.probability_of_precipitation <= 10
        ) {
          return null;
        }

        const barWidth = Math.max(2, (innerWidth / limitedData.length) * 0.8);
        const barX = (xScale(d.time) ?? 0) - barWidth / 2;

        // Fixed height for probability indicators based on percentage
        const maxProbabilityHeight = 30; // Fixed maximum height for 100% probability
        const probabilityHeight =
          (d.probability_of_precipitation / 100) * maxProbabilityHeight;
        const probabilityY = innerHeight - probabilityHeight;

        const probabilityPattern =
          d.probability_of_precipitation > 70
            ? 'url(#probabilityPattern3)'
            : d.probability_of_precipitation > 40
              ? 'url(#probabilityPattern2)'
              : 'url(#probabilityPattern1)';

        return (
          <g key={`prob-${i}`}>
            {/* Probability indicator bar */}
            <rect
              x={barX}
              y={probabilityY}
              width={barWidth}
              height={probabilityHeight}
              fill={probabilityPattern}
              stroke="#1e40af"
              strokeWidth={0.5}
              rx={1}
              ry={1}
              opacity={0.8}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </>
  );

  const renderWindChart = () => (
    <>
      {/* Wind percentile range area (10th to 90th percentile) */}
      {limitedData[0]?.wind_speed_percentile_10 !== undefined &&
        limitedData[0]?.wind_speed_percentile_90 !== undefined && (
          <AreaClosed<any>
            data={limitedData.filter(
              (d) =>
                d.wind_speed_percentile_10 !== undefined &&
                d.wind_speed_percentile_90 !== undefined,
            )}
            x={(d) => xScale(d.time) ?? 0}
            y0={(d) => yScale(d.wind_speed_percentile_10!) ?? 0}
            y1={(d) => yScale(d.wind_speed_percentile_90!) ?? 0}
            yScale={yScale}
            fill="url(#windPercentileGradient)"
            stroke="#10b981"
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="2,2"
            curve={curveCardinal}
          />
        )}

      {/* Wind area under the line */}
      <LinePath<any>
        data={limitedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.time) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        stroke="url(#windGradient)"
        curve={curveCardinal}
      />

      {/* Wind speed line */}
      <LinePath<any>
        data={limitedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.time) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        stroke="url(#windLineGradient)"
        strokeWidth={3}
        curve={curveCardinal}
        fill="transparent"
      />

      {/* Wind gust line if available */}
      {limitedData[0]?.wind_speed_of_gust !== undefined && (
        <LinePath<any>
          data={limitedData.filter((d) => d.wind_speed_of_gust !== undefined)}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.wind_speed_of_gust!) ?? 0}
          stroke="#059669"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="5,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Wind percentile lines */}
      {limitedData[0]?.wind_speed_percentile_90 !== undefined && (
        <LinePath<any>
          data={limitedData.filter(
            (d) => d.wind_speed_percentile_90 !== undefined,
          )}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.wind_speed_percentile_90!) ?? 0}
          stroke="#059669"
          strokeWidth={1}
          strokeOpacity={0.5}
          strokeDasharray="2,2"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {limitedData[0]?.wind_speed_percentile_10 !== undefined && (
        <LinePath<any>
          data={limitedData.filter(
            (d) => d.wind_speed_percentile_10 !== undefined,
          )}
          x={(d) => xScale(d.time) ?? 0}
          y={(d) => yScale(d.wind_speed_percentile_10!) ?? 0}
          stroke="#059669"
          strokeWidth={1}
          strokeOpacity={0.5}
          strokeDasharray="2,2"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Wind speed data points */}
      {limitedData.map((d, i) => {
        const windSpeed = getYValue(d);
        const x = xScale(d.time) ?? 0;
        const y = yScale(windSpeed) ?? 0;

        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={2}
              fill="#10b981"
              stroke="#ffffff"
              strokeWidth={1}
              opacity={0.8}
            />
            {/* Wind gust indicator */}
            {d.wind_speed_of_gust !== undefined &&
              d.wind_speed_of_gust > windSpeed && (
                <circle
                  cx={x}
                  cy={yScale(d.wind_speed_of_gust) ?? 0}
                  r={3}
                  fill="#059669"
                  stroke="#ffffff"
                  strokeWidth={1}
                  opacity={0.6}
                />
              )}
          </g>
        );
      })}
    </>
  );

  return (
    <div className="relative" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          {/* Clip path to prevent precipitation from going below x-axis */}
          <clipPath id="chartClip">
            <rect x={0} y={0} width={innerWidth} height={innerHeight} />
          </clipPath>

          {chartType === 'temperature' &&
            (() => {
              // Generate dynamic temperature gradients based on data range
              const tempData = limitedData.filter((d) => d.temp !== undefined);
              if (tempData.length === 0) {
                // Fallback to neutral gradient when no temperature data is available
                return (
                  <>
                    <LinearGradient
                      id="temperatureGradient"
                      from={getTemperatureColor(15)}
                      to={getTemperatureColor(15)}
                      fromOpacity={0.6}
                      toOpacity={0.3}
                      vertical={true}
                    />
                    <LinearGradient
                      id="temperatureLineGradient"
                      from={getTemperatureColor(15)}
                      to={getTemperatureColor(15)}
                      vertical={true}
                    />
                    <LinearGradient
                      id="temperatureRangeGradient"
                      from={getTemperatureColor(15)}
                      to={getTemperatureColor(15)}
                      fromOpacity={0.3}
                      toOpacity={0.1}
                      vertical={true}
                    />
                    <LinearGradient
                      id="temperaturePercentileGradient"
                      from={getTemperatureColor(15)}
                      to={getTemperatureColor(15)}
                      fromOpacity={0.2}
                      toOpacity={0.05}
                      vertical={true}
                    />
                  </>
                );
              }

              const yDomain = yScale.domain();
              const minScaleTemp = yDomain[0];
              const maxScaleTemp = yDomain[1];

              // Create Y-axis mapped gradient for percentile area
              const percentileYGradientStops = [];
              for (let i = 0; i <= 10; i++) {
                const temp =
                  maxScaleTemp - ((maxScaleTemp - minScaleTemp) * i) / 10;
                percentileYGradientStops.push({
                  offset: `${i * 10}%`,
                  color: getTemperatureColor(temp),
                });
              }

              const percentileYGradientStopsStroke = [];
              for (let i = 0; i <= 10; i++) {
                const temp =
                  maxScaleTemp - ((maxScaleTemp - minScaleTemp) * i) / 10;
                percentileYGradientStopsStroke.push({
                  offset: `${i * 10}%`,
                  color: getTemperatureColor(temp, true),
                });
              }

              const minTemp = Math.min(...tempData.map((d) => d.temp!));
              const maxTemp = Math.max(...tempData.map((d) => d.temp!));
              const avgTemp = (minTemp + maxTemp) / 2;

              // Generate individual gradients for each temperature data point
              const temperatureGradients = tempData.map((d, i) => {
                const temp = d.temp!;
                const color = getTemperatureColor(temp);
                const gradientId = `tempGradient_${i}_${Math.round(temp * 100)}`;

                return (
                  <LinearGradient
                    key={gradientId}
                    id={gradientId}
                    from={color}
                    to={color}
                    fromOpacity={0.8}
                    toOpacity={0.4}
                    vertical={true}
                  />
                );
              });

              // Use average temperature color for other gradients
              const avgColor = getTemperatureColor(avgTemp);
              const minColor = getTemperatureColor(minTemp);
              const maxColor = getTemperatureColor(maxTemp);

              return (
                <>
                  {temperatureGradients}
                  <LinearGradient
                    id="temperatureGradient"
                    from={maxColor}
                    to={minColor}
                    fromOpacity={0.6}
                    toOpacity={0.3}
                    vertical={true}
                  />
                  <LinearGradient
                    id="temperatureLineGradient"
                    from={avgColor}
                    to={avgColor}
                    vertical={true}
                  />
                  <LinearGradient
                    id="temperatureRangeGradient"
                    from={maxColor}
                    to={minColor}
                    fromOpacity={0.3}
                    toOpacity={0.1}
                    vertical={true}
                  />
                  <linearGradient
                    id="temperaturePercentileYGradient"
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    {percentileYGradientStops.map((stop, i) => (
                      <stop
                        key={i}
                        offset={stop.offset}
                        stopColor={stop.color}
                        stopOpacity={0.3}
                      />
                    ))}
                  </linearGradient>
                  <linearGradient
                    id="temperaturePercentileStrokeGradient"
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    {percentileYGradientStopsStroke.map((stop, i) => (
                      <stop
                        key={i}
                        offset={stop.offset}
                        stopColor={stop.color}
                        stopOpacity={1.0}
                      />
                    ))}
                  </linearGradient>
                  <linearGradient
                    id="temperaturePercentileFadeGradient"
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={0.45} />
                    <stop
                      offset="100%"
                      stopColor="#ffffff"
                      stopOpacity={0.12}
                    />
                  </linearGradient>
                  <mask id="temperaturePercentileMask">
                    <rect
                      width="100%"
                      height="100%"
                      fill="url(#temperaturePercentileFadeGradient)"
                    />
                  </mask>
                </>
              );
            })()}

          <LinearGradient
            id="precipitationGradient"
            from="#3b82f6"
            to="#1e40af"
            fromOpacity={0.6}
            toOpacity={0.2}
          />
          <LinearGradient
            id="precipitationLineGradient"
            from="#2563eb"
            to="#1d4ed8"
          />
          <LinearGradient
            id="precipitationRangeGradient"
            from="#3365bd"
            to="#20459a"
            fromOpacity={0.4}
            toOpacity={0.1}
          />
          <LinearGradient
            id="precipitationBarGradient"
            from="#60a5fa"
            to="#3b82f6"
          />

          <LinearGradient
            id="windGradient"
            from="#10b981"
            to="#059669"
            fromOpacity={0.5}
            toOpacity={0.1}
          />
          <LinearGradient id="windLineGradient" from="#34d399" to="#10b981" />
          <LinearGradient
            id="windPercentileGradient"
            from="#10b981"
            to="#059669"
            fromOpacity={0.3}
            toOpacity={0.1}
          />
          <LinearGradient
            id="probabilityGradient"
            from="#1e40af"
            to="#3b82f6"
            fromOpacity={0.8}
            toOpacity={0.4}
          />

          {/* Probability patterns for different probability ranges */}
          <pattern
            id="probabilityPattern1"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
          >
            <rect width="4" height="4" fill="transparent" />
            <circle cx="2" cy="2" r="1" fill="#ffffff" opacity="0.6" />
          </pattern>

          <pattern
            id="probabilityPattern2"
            patternUnits="userSpaceOnUse"
            width="3"
            height="3"
          >
            <rect width="3" height="3" fill="transparent" />
            <circle cx="1.5" cy="1.5" r="1" fill="#ffffff" opacity="0.7" />
          </pattern>

          <pattern
            id="probabilityPattern3"
            patternUnits="userSpaceOnUse"
            width="2"
            height="2"
          >
            <rect width="2" height="2" fill="transparent" />
            <circle cx="1" cy="1" r="0.8" fill="#ffffff" opacity="0.8" />
          </pattern>
        </defs>

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          rx={8}
        />

        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            height={innerHeight}
            stroke="#374151"
            strokeOpacity={0.2}
            strokeDasharray="2,2"
          />

          {chartType === 'temperature' && (
            <TemperatureChart
              limitedData={limitedData}
              xScale={xScale}
              yScale={yScale}
              getYValue={getYValue}
              innerHeight={innerHeight}
            />
          )}
          {chartType === 'precipitation' && (
            <g clipPath="url(#chartClip)">
              <PrecipitationChart
                limitedData={limitedData}
                xScale={xScale}
                yScale={yScale}
                getYValue={getYValue}
                innerWidth={innerWidth}
                innerHeight={innerHeight}
              />
            </g>
          )}
          {chartType === 'wind' && (
            <WindChart
              limitedData={limitedData}
              xScale={xScale}
              yScale={yScale}
              getYValue={getYValue}
            />
          )}

          {/* Midnight lines for multi-day charts */}
          {midnightLines.map((midnightTime, i) => (
            <Line
              key={i}
              from={{ x: xScale(midnightTime) ?? 0, y: 0 }}
              to={{ x: xScale(midnightTime) ?? 0, y: innerHeight }}
              stroke="#6b7280"
              strokeWidth={1}
              strokeOpacity={0.3}
              strokeDasharray="2,4"
            />
          ))}

          {/* Hover line */}
          <HoverElements
            tooltipOpen={tooltipOpen}
            tooltipData={tooltipData}
            xScale={xScale}
            innerHeight={innerHeight}
          />

          {/* Data points */}
          {/* {limitedData.map((d, i) => {
            const x = xScale(d.time) ?? 0;
            const yValue = getYValue(d);
            const y = yScale(yValue) ?? 0;

            if (yValue === undefined) return null;

            const pointFill =
              chartType === 'temperature'
                ? getTemperatureColor(yValue)
                : `url(#${getGradientId})`;

            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={3}
                fill={pointFill}
                stroke="#ffffff"
                strokeWidth={1}
                opacity={0.8}
                style={{ cursor: 'pointer' }}
              />
            );
          })} */}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={7}
            tickFormat={(value) => {
              const date = new Date(Number(value));
              // Show time for granular data, date for daily data
              // Show time for data spanning 48 hours or less
              const hoursDiff =
                (Math.max(...limitedData.map((d) => d.time.getTime())) -
                  Math.min(...limitedData.map((d) => d.time.getTime()))) /
                (1000 * 60 * 60);

              if (hoursDiff <= 48) {
                // Show time for data spanning 48 hours or less
                return date.toLocaleTimeString('en-FI', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
              } else {
                // Show date for longer periods
                return date.toLocaleDateString('en-US', {
                  weekday: 'short',
                });
              }
            }}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'middle',
            }}
          />

          <AxisLeft
            scale={yScale}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'end',
            }}
            tickFormat={(value) => formatYValue(Number(value))}
            numTicks={5}
          />

          {/* Chart title */}
          <text
            x={innerWidth / 2}
            y={-5}
            textAnchor="middle"
            fontSize={12}
            fill="#f9fafb"
            fontWeight="600"
          >
            {chartType === 'temperature' && 'Temperature forecast'}
            {chartType === 'precipitation' && 'Precipitation forecast'}
            {chartType === 'wind' && 'Wind speed forecast'}
          </text>

          {/* Unified interaction overlay */}
          <ChartInteractionOverlay
            width={width}
            height={height}
            margin={margin}
            data={limitedData}
            findDataPoint={findDataPoint}
            getDataPointPosition={getDataPointPosition}
            handleMouseMove={handleMouseMove}
            handleTouch={handleTouch}
            hideTooltip={hideTooltip}
          />
        </Group>
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={
            chartType === 'temperature' ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    backgroundColor: getTemperatureColor(
                      getYValue(tooltipData),
                    ),
                  }}
                />
                {formatYValue(getYValue(tooltipData))}
              </div>
            ) : (
              formatYValue(getYValue(tooltipData))
            )
          }
          fields={[
            ...(chartType === 'temperature'
              ? [
                  ...(tooltipData.max_temp !== undefined &&
                  tooltipData.min_temp !== undefined
                    ? [
                        {
                          label: 'Max',
                          value: `${tooltipData.max_temp.toFixed(1)}°C`,
                        },
                        {
                          label: 'Min',
                          value: `${tooltipData.min_temp.toFixed(1)}°C`,
                        },
                      ]
                    : []),
                  ...(tooltipData.temp_percentile_90 !== undefined &&
                  tooltipData.temp_percentile_10 !== undefined
                    ? [
                        {
                          label: '90th %',
                          value: `${tooltipData.temp_percentile_90.toFixed(1)}°C`,
                          secondary: true,
                        },
                        {
                          label: '10th %',
                          value: `${tooltipData.temp_percentile_10.toFixed(1)}°C`,
                          secondary: true,
                        },
                      ]
                    : []),
                ]
              : []),
            ...(chartType === 'precipitation'
              ? [
                  ...(tooltipData.precipitation_amount_max !== undefined &&
                  tooltipData.precipitation_amount_min !== undefined
                    ? [
                        {
                          label: 'Max',
                          value: `${tooltipData.precipitation_amount_max.toFixed(1)}mm`,
                        },
                        {
                          label: 'Min',
                          value: `${tooltipData.precipitation_amount_min.toFixed(1)}mm`,
                        },
                      ]
                    : []),
                  ...(tooltipData.probability_of_precipitation !== undefined &&
                  tooltipData.probability_of_precipitation > 0
                    ? [
                        {
                          label: 'Probability',
                          value: `${tooltipData.probability_of_precipitation.toFixed(0)}%`,
                          secondary: false,
                        },
                      ]
                    : []),
                ]
              : []),
            ...(chartType === 'wind'
              ? [
                  ...(tooltipData.wind_speed_of_gust !== undefined
                    ? [
                        {
                          label: 'Gusts',
                          value: `${tooltipData.wind_speed_of_gust.toFixed(1)} m/s`,
                        },
                      ]
                    : []),
                  ...(tooltipData.wind_speed_percentile_90 !== undefined &&
                  tooltipData.wind_speed_percentile_10 !== undefined
                    ? [
                        {
                          label: '90th %',
                          value: `${tooltipData.wind_speed_percentile_90.toFixed(1)} m/s`,
                          secondary: true,
                        },
                        {
                          label: '10th %',
                          value: `${tooltipData.wind_speed_percentile_10.toFixed(1)} m/s`,
                          secondary: true,
                        },
                      ]
                    : []),
                ]
              : []),
          ]}
          timestamp={tooltipData.time}
          TooltipInPortal={TooltipInPortal}
          tooltipTop={tooltipTop}
          tooltipLeft={tooltipLeft}
          tooltipOpen={tooltipOpen}
          margin={margin}
          offsetTop={-20}
          offsetLeft={-10}
        />
      )}
    </div>
  );
};

export const WeatherChart = memo(
  WeatherChartComponent,
  (prevProps, nextProps) => {
    // Custom comparison function for memo
    return (
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height &&
      prevProps.chartType === nextProps.chartType &&
      prevProps.animate === nextProps.animate &&
      prevProps.data.length === nextProps.data.length &&
      // Compare data arrays efficiently - only check if lengths and first/last items match
      (prevProps.data.length === 0 ||
        (prevProps.data[0]?.time.getTime() ===
          nextProps.data[0]?.time.getTime() &&
          prevProps.data[0]?.temp === nextProps.data[0]?.temp &&
          prevProps.data[prevProps.data.length - 1]?.time.getTime() ===
            nextProps.data[nextProps.data.length - 1]?.time.getTime() &&
          prevProps.data[prevProps.data.length - 1]?.temp ===
            nextProps.data[nextProps.data.length - 1]?.temp)) &&
      // Compare margin without JSON serialization
      (prevProps.margin?.top ?? defaultMargin.top) ===
        (nextProps.margin?.top ?? defaultMargin.top) &&
      (prevProps.margin?.right ?? defaultMargin.right) ===
        (nextProps.margin?.right ?? defaultMargin.right) &&
      (prevProps.margin?.bottom ?? defaultMargin.bottom) ===
        (nextProps.margin?.bottom ?? defaultMargin.bottom) &&
      (prevProps.margin?.left ?? defaultMargin.left) ===
        (nextProps.margin?.left ?? defaultMargin.left)
    );
  },
);

WeatherChart.displayName = 'WeatherChart';
