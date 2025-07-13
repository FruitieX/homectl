import React, { useMemo } from 'react';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleBand, scaleLinear } from '@visx/scale';
import { LinearGradient } from '@visx/gradient';
import { GridRows } from '@visx/grid';
import { PatternLines } from '@visx/pattern';
import Color from 'color';
import { useChartTooltip, TooltipPosition } from './hooks/useChartTooltip';
import { ChartTooltip, TooltipField } from './ChartTooltip';
import { ChartInteractionOverlay } from './ChartInteractionOverlay';

interface TemperatureData {
  time: Date;
  temp: number;
  fill: string;
}

interface TemperatureSensorChartProps {
  data: TemperatureData[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
}

const defaultMargin = { top: 20, right: 20, bottom: 40, left: 40 };

const tempToColor = (temp: number) => {
  // Define temperature thresholds and corresponding hue values
  const tempPoints = [
    { temp: -20, hue: 240, sat: 20, light: 30 }, // Deep blue for very cold
    { temp: 0, hue: 200, sat: 60, light: 50 }, // Blue for freezing
    { temp: 8, hue: 180, sat: 70, light: 60 }, // Cyan for cold
    { temp: 15, hue: 120, sat: 60, light: 65 }, // Green for cool
    { temp: 23, hue: 60, sat: 70, light: 70 }, // Yellow for comfortable
    { temp: 30, hue: 20, sat: 80, light: 65 }, // Orange for warm
    { temp: 40, hue: 0, sat: 90, light: 60 }, // Red for hot
  ];

  // Find the two points to interpolate between
  let lowerPoint = tempPoints[0];
  let upperPoint = tempPoints[tempPoints.length - 1];

  for (let i = 0; i < tempPoints.length - 1; i++) {
    if (temp >= tempPoints[i].temp && temp <= tempPoints[i + 1].temp) {
      lowerPoint = tempPoints[i];
      upperPoint = tempPoints[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const factor = (temp - lowerPoint.temp) / (upperPoint.temp - lowerPoint.temp);
  const clampedFactor = Math.max(0, Math.min(1, factor));

  // Interpolate between the two colors
  const hue =
    lowerPoint.hue + (upperPoint.hue - lowerPoint.hue) * clampedFactor;
  const sat =
    lowerPoint.sat + (upperPoint.sat - lowerPoint.sat) * clampedFactor;
  const light =
    lowerPoint.light + (upperPoint.light - lowerPoint.light) * clampedFactor;

  return Color(`hsl(${hue}, ${sat}%, ${light}%)`);
};

export const TemperatureSensorChart: React.FC<TemperatureSensorChartProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
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
  } = useChartTooltip<TemperatureData>({
    data,
    margin,
  });

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const { xScale, yScale } = useMemo(() => {
    const xScale = scaleBand<Date>({
      range: [0, innerWidth],
      domain: data.map((d) => d.time),
      padding: 0.2,
    });

    const yScale = scaleLinear<number>({
      range: [innerHeight, 0],
      domain: [
        Math.min(...data.map((d) => d.temp)) - 2,
        Math.max(...data.map((d) => d.temp)) + 2,
      ],
      nice: false,
    });

    return { xScale, yScale };
  }, [data, innerWidth, innerHeight]);

  // Function to find data point based on position
  const findDataPoint = (
    position: TooltipPosition,
  ): TemperatureData | undefined => {
    const xPos = position.x;
    let closestIndex = 0;
    let closestDistance = Infinity;

    data.forEach((d, i) => {
      const dataX = xScale(d.time!) ?? 0;
      const distance = Math.abs(xPos - dataX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    });

    return data[closestIndex];
  };

  if (width < 10) return null;

  return (
    <div className="relative overflow-hidden" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <LinearGradient
            id="temperatureGradient"
            from="#1e40af"
            to="#06b6d4"
          />
          <LinearGradient id="coldGradient" from="#3b82f6" to="#06b6d4" />
          <LinearGradient id="warmGradient" from="#f59e0b" to="#dc2626" />
          <LinearGradient id="hotGradient" from="#dc2626" to="#7c2d12" />
          <PatternLines
            id="temperaturePattern"
            height={6}
            width={6}
            stroke="#374151"
            strokeWidth={1}
            orientation={['diagonal']}
          />
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
            strokeOpacity={0.3}
            strokeDasharray="2,2"
          />

          {data.map((d, i) => {
            const barWidth = xScale.bandwidth();
            const barHeight = innerHeight - (yScale(d.temp) ?? 0);
            const barX = xScale(d.time) ?? 0;
            const barY = yScale(d.temp) ?? 0;
            const color = tempToColor(d.temp);

            return (
              <g key={i}>
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  fill={color.toString()}
                  stroke={color.darken(0.2).toString()}
                  strokeWidth={1}
                  rx={3}
                  ry={3}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            );
          })}

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

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickFormat={(value) => {
              const date = new Date(value);
              return date.toLocaleTimeString('en-FI', {
                hour: '2-digit',
                minute: '2-digit',
              });
            }}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'middle',
            }}
            numTicks={Math.min(10, data.length)}
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
            tickFormat={(value) => `${value}°C`}
            numTicks={6}
          />
        </Group>
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={`${Math.round(tooltipData.temp)}°C`}
          fields={[]}
          timestamp={tooltipData.time}
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
