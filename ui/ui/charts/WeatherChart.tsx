import React, { useMemo } from 'react';
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
import { ChartInteractionOverlay } from './ChartInteractionOverlay';

interface WeatherDataPoint {
  time: Date;
  temp?: number;
  maxTemp?: number;
  minTemp?: number;
  precipitation?: number;
  precipitationMax?: number;
  precipitationMin?: number;
  windSpeed?: number;
  probability?: number;
  displayTime?: Date;
  originalTime?: Date;
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
  (d: WeatherDataPoint) => d.displayTime || d.time,
).left;

export const WeatherChart: React.FC<WeatherChartProps> = ({
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

  const {
    xScale,
    yScale,
    getYValue,
    formatYValue,
    getGradientId,
    normalizedData,
  } = useMemo(() => {
    // Normalize data to use midnight for consistent day alignment
    const normalizedData = data.map((d) => ({
      ...d,
      displayTime: new Date(
        d.time.getFullYear(),
        d.time.getMonth(),
        d.time.getDate(),
      ),
      originalTime: d.time,
    }));

    const xScale = scaleTime<number>({
      range: [0, innerWidth],
      domain: [
        Math.min(...normalizedData.map((d) => d.displayTime.getTime())),
        Math.max(...normalizedData.map((d) => d.displayTime.getTime())),
      ],
    });

    let yScale: any;
    let getYValue: (d: WeatherDataPoint) => number;
    let formatYValue: (value: number) => string;
    let getGradientId: string;

    switch (chartType) {
      case 'temperature':
        const temps = data.flatMap(
          (d) => [d.temp, d.maxTemp, d.minTemp].filter(Boolean) as number[],
        );
        yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [Math.min(...temps) - 2, Math.max(...temps) + 2],
          nice: false,
        });
        getYValue = (d: WeatherDataPoint) => d.temp || d.maxTemp || 0;
        formatYValue = (value: number) => `${value.toFixed(1)}°C`;
        getGradientId = 'temperatureGradient';
        break;

      case 'precipitation':
        const precips = data.flatMap(
          (d) =>
            [d.precipitation, d.precipitationMax].filter(Boolean) as number[],
        );
        yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [0, Math.max(...precips, 1) + 1],
          nice: false,
        });
        getYValue = (d: WeatherDataPoint) => d.precipitation || 0;
        formatYValue = (value: number) => `${value.toFixed(1)}mm`;
        getGradientId = 'precipitationGradient';
        break;

      case 'wind':
        const winds = data.map((d) => d.windSpeed).filter(Boolean) as number[];
        yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [0, Math.max(...winds) + 2],
          nice: false,
        });
        getYValue = (d: WeatherDataPoint) => d.windSpeed || 0;
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
      normalizedData,
    };
  }, [data, innerWidth, innerHeight, chartType]);

  // Function to find data point based on position
  const findDataPoint = (
    position: TooltipPosition,
  ): WeatherDataPoint | undefined => {
    const x = position.x;
    const x0 = xScale.invert(x);
    const index = bisectDate(normalizedData as any[], new Date(x0), 1);
    const d0 = normalizedData[index - 1];
    const d1 = normalizedData[index];
    let d = d0;
    if (d1 && x0) {
      d =
        x0.getTime() - d0.displayTime!.getTime() >
        d1.displayTime!.getTime() - x0.getTime()
          ? d1
          : d0;
    }
    return d;
  };

  const renderTemperatureChart = () => (
    <>
      {/* Min-Max temperature area */}
      {normalizedData[0]?.maxTemp && normalizedData[0]?.minTemp && (
        <AreaClosed<any>
          data={normalizedData.filter((d) => d.maxTemp && d.minTemp)}
          x={(d) => xScale(d.displayTime) ?? 0}
          y0={(d) => yScale(d.minTemp!) ?? 0}
          y1={(d) => yScale(d.maxTemp!) ?? 0}
          yScale={yScale}
          fill="url(#temperatureRangeGradient)"
          stroke="transparent"
          curve={curveCardinal}
        />
      )}

      {/* Main temperature line */}
      <LinePath<any>
        data={normalizedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.displayTime) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        stroke="url(#temperatureLineGradient)"
        strokeWidth={3}
        curve={curveCardinal}
        fill="transparent"
      />

      {/* Max temperature line */}
      {normalizedData[0]?.maxTemp && (
        <LinePath<any>
          data={normalizedData.filter((d) => d.maxTemp !== undefined)}
          x={(d) => xScale(d.displayTime) ?? 0}
          y={(d) => yScale(d.maxTemp!) ?? 0}
          stroke="#ef4444"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="3,3"
          curve={curveCardinal}
          fill="transparent"
        />
      )}

      {/* Min temperature line */}
      {normalizedData[0]?.minTemp && (
        <LinePath<any>
          data={normalizedData.filter((d) => d.minTemp !== undefined)}
          x={(d) => xScale(d.displayTime) ?? 0}
          y={(d) => yScale(d.minTemp!) ?? 0}
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
      {normalizedData[0]?.precipitationMax &&
        normalizedData[0]?.precipitationMin && (
          <AreaClosed<any>
            data={normalizedData.filter(
              (d) => d.precipitationMax && d.precipitationMin,
            )}
            x={(d) => xScale(d.displayTime) ?? 0}
            y0={(d) => yScale(d.precipitationMin!) ?? 0}
            y1={(d) => yScale(d.precipitationMax!) ?? 0}
            yScale={yScale}
            fill="url(#precipitationRangeGradient)"
            stroke="transparent"
            curve={curveCardinal}
          />
        )}

      {/* Main precipitation area */}
      <AreaClosed<any>
        data={normalizedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.displayTime) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        yScale={yScale}
        fill="url(#precipitationGradient)"
        stroke="url(#precipitationLineGradient)"
        strokeWidth={2}
        curve={curveCardinal}
      />

      {/* Precipitation bars for better visibility */}
      {normalizedData.map((d, i) => {
        const barWidth = Math.max(
          2,
          (innerWidth / normalizedData.length) * 0.8,
        );
        const barHeight = innerHeight - (yScale(getYValue(d)) ?? 0);
        const barX = (xScale(d.displayTime) ?? 0) - barWidth / 2;
        const barY = yScale(getYValue(d)) ?? 0;

        if (getYValue(d) === 0) return null;

        return (
          <Bar
            key={i}
            x={barX}
            y={barY}
            width={barWidth}
            height={barHeight}
            fill="url(#precipitationBarGradient)"
            stroke="#1e40af"
            strokeWidth={1}
            rx={1}
          />
        );
      })}
    </>
  );

  const renderWindChart = () => (
    <>
      {/* Wind area */}
      <AreaClosed<any>
        data={normalizedData.filter((d) => getYValue(d) !== undefined)}
        x={(d) => xScale(d.displayTime) ?? 0}
        y={(d) => yScale(getYValue(d)) ?? 0}
        yScale={yScale}
        fill="url(#windGradient)"
        stroke="url(#windLineGradient)"
        strokeWidth={2}
        curve={curveCardinal}
      />

      {/* Wind gusts indicators */}
      {normalizedData.map((d, i) => {
        const windSpeed = getYValue(d);
        if (windSpeed < 5) return null;

        const x = xScale(d.displayTime) ?? 0;
        const y = yScale(windSpeed) ?? 0;

        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={windSpeed > 10 ? 4 : 2}
              fill="#10b981"
              stroke="#ffffff"
              strokeWidth={1}
              opacity={0.8}
            />
          </g>
        );
      })}
    </>
  );

  if (width < 10) return null;

  return (
    <div className="relative" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <LinearGradient
            id="temperatureGradient"
            from="#f59e0b"
            to="#dc2626"
          />
          <LinearGradient
            id="temperatureLineGradient"
            from="#ef4444"
            to="#f97316"
          />
          <LinearGradient
            id="temperatureRangeGradient"
            from="#fef3c7"
            to="#fed7aa"
            fromOpacity={0.3}
            toOpacity={0.1}
          />

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
            from="#dbeafe"
            to="#bfdbfe"
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

          {chartType === 'temperature' && renderTemperatureChart()}
          {chartType === 'precipitation' && renderPrecipitationChart()}
          {chartType === 'wind' && renderWindChart()}

          {/* Hover line */}
          {tooltipOpen && tooltipData && (
            <Line
              from={{
                x: Math.max(
                  2,
                  xScale(tooltipData.displayTime || tooltipData.time),
                ),
                y: 0,
              }}
              to={{
                x: Math.max(
                  2,
                  xScale(tooltipData.displayTime || tooltipData.time),
                ),
                y: innerHeight,
              }}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeOpacity={0.5}
              strokeDasharray="3,3"
            />
          )}

          {/* Data points */}
          {normalizedData.map((d, i) => {
            const x = xScale(d.displayTime) ?? 0;
            const y = yScale(getYValue(d)) ?? 0;

            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={3}
                fill={`url(#${getGradientId})`}
                stroke="#ffffff"
                strokeWidth={1}
                opacity={0.8}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickFormat={(value) => {
              const date = new Date(Number(value));
              return date.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });
            }}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'middle',
            }}
            numTicks={6}
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
            {chartType === 'temperature' && 'Temperature'}
            {chartType === 'precipitation' && 'Precipitation'}
            {chartType === 'wind' && 'Wind Speed'}
          </text>

          {/* Unified interaction overlay */}
          <ChartInteractionOverlay
            width={width}
            height={height}
            margin={margin}
            data={data}
            findDataPoint={findDataPoint}
            handleMouseMove={handleMouseMove}
            handleTouch={handleTouch}
            hideTooltip={hideTooltip}
          />
        </Group>
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={formatYValue(getYValue(tooltipData))}
          fields={[
            ...(chartType === 'temperature' &&
            tooltipData.maxTemp &&
            tooltipData.minTemp
              ? [
                  {
                    label: 'Max',
                    value: `${tooltipData.maxTemp.toFixed(1)}°C`,
                  },
                  {
                    label: 'Min',
                    value: `${tooltipData.minTemp.toFixed(1)}°C`,
                  },
                ]
              : []),
            ...(chartType === 'precipitation' && tooltipData.probability
              ? [
                  {
                    label: 'Probability',
                    value: `${tooltipData.probability.toFixed(0)}%`,
                  },
                ]
              : []),
          ]}
          timestamp={tooltipData.originalTime || tooltipData.time}
          TooltipInPortal={TooltipInPortal}
          tooltipTop={tooltipTop}
          tooltipLeft={tooltipLeft}
          tooltipOpen={tooltipOpen}
          margin={margin}
        />
      )}
    </div>
  );
};
