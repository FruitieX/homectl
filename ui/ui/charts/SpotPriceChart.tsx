import React, { useMemo } from 'react';
import { Bar } from '@visx/shape';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleBand, scaleLinear } from '@visx/scale';
import { LinearGradient } from '@visx/gradient';
import { GridRows, GridColumns } from '@visx/grid';
import { Line } from '@visx/shape';
import { useChartTooltip, TooltipPosition } from './hooks/useChartTooltip';
import { ChartTooltip, TooltipField } from './ChartTooltip';
import { ChartInteractionOverlay } from './ChartInteractionOverlay';

interface SpotPriceData {
  time: number;
  value: number;
  fill: string;
}

interface SpotPriceChartProps {
  data: SpotPriceData[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
  showCurrentTime?: boolean;
}

const defaultMargin = { top: 20, right: 20, bottom: 40, left: 45 };

const spotPriceToColor = (spotPrice: number) => {
  const h = Math.min(Math.max(0, 120 - 5 * spotPrice), 300);
  const s = 0.65;
  const v = 0.7;
  return `hsl(${h}, ${s * 100}%, ${v * 100}%)`;
};

const getCurrentTimePosition = (data: SpotPriceData[], xScale: any) => {
  if (data.length === 0) return null;

  const currentTime = new Date().getTime();
  const firstTime = data[0].time;
  const lastTime = data[data.length - 1].time;

  if (currentTime < firstTime || currentTime > lastTime) return null;

  // Find the current price point for coloring
  const currentPricePoint = data.find((d) => d.time <= currentTime);

  // Linear interpolation for x position
  const timeRange = lastTime - firstTime;
  const currentOffset = currentTime - firstTime;
  const xRange = xScale.range()[1] - xScale.range()[0];
  const currentX = xScale.range()[0] + (currentOffset / timeRange) * xRange;

  return {
    x: currentX,
    price: currentPricePoint?.value || 0,
  };
};

export const SpotPriceChart: React.FC<SpotPriceChartProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
  animate = true,
  showCurrentTime = true,
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
  } = useChartTooltip<SpotPriceData>({
    data,
    margin,
  });

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const { xScale, yScale } = useMemo(() => {
    const xScale = scaleBand<number>({
      range: [0, innerWidth],
      domain: data.map((d) => d.time),
      padding: 0.1,
    });

    const yScale = scaleLinear<number>({
      range: [innerHeight, 0],
      domain: [
        Math.min(0, Math.min(...data.map((d) => d.value)) - 1),
        Math.max(...data.map((d) => d.value)) + 2,
      ],
      nice: false,
    });

    return { xScale, yScale };
  }, [data, innerWidth, innerHeight]);

  const currentTimeInfo = useMemo(() => {
    return showCurrentTime ? getCurrentTimePosition(data, xScale) : null;
  }, [data, xScale, showCurrentTime]);

  // Function to find data point based on position
  const findDataPoint = (
    position: TooltipPosition,
  ): SpotPriceData | undefined => {
    const xPos = position.x;
    let closestIndex = 0;
    let closestDistance = Infinity;

    data.forEach((d, i) => {
      const barX = (xScale(d.time) ?? 0) + xScale.bandwidth() / 2;
      const distance = Math.abs(xPos - barX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    });

    return data[closestIndex];
  };

  if (width < 10) return null;

  return (
    <div className="relative" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <LinearGradient id="lowPriceGradient" from="#10b981" to="#059669" />
          <LinearGradient
            id="mediumPriceGradient"
            from="#f59e0b"
            to="#d97706"
          />
          <LinearGradient id="highPriceGradient" from="#dc2626" to="#991b1b" />
          <LinearGradient
            id="negativePriceGradient"
            from="#3b82f6"
            to="#1d4ed8"
          />

          {/* Glow effect for current time marker */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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

          <GridColumns
            scale={xScale}
            width={innerWidth}
            height={innerHeight}
            stroke="#374151"
            strokeOpacity={0.1}
          />

          {/* Zero line for negative prices */}
          {yScale(0) <= innerHeight && (
            <Line
              from={{ x: 0, y: yScale(0) }}
              to={{ x: innerWidth, y: yScale(0) }}
              stroke="#6b7280"
              strokeWidth={2}
              strokeOpacity={0.8}
              strokeDasharray="5,5"
            />
          )}

          {data.map((d, i) => {
            const barWidth = xScale.bandwidth();
            const barHeight = Math.abs(
              innerHeight -
                (yScale(d.value) ?? 0) -
                (d.value < 0 ? (yScale(0) ?? 0) : 0),
            );
            const barX = xScale(d.time) ?? 0;
            const barY =
              d.value < 0 ? (yScale(0) ?? 0) : (yScale(d.value) ?? 0);

            const gradientId =
              d.value < 0
                ? 'negativePriceGradient'
                : d.value < 5
                  ? 'lowPriceGradient'
                  : d.value < 15
                    ? 'mediumPriceGradient'
                    : 'highPriceGradient';

            return (
              <g key={i}>
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  fill={`url(#${gradientId})`}
                  stroke={spotPriceToColor(d.value)}
                  strokeWidth={1}
                  rx={2}
                  ry={2}
                />
              </g>
            );
          })}

          {/* Current time marker */}
          {currentTimeInfo && (
            <g>
              <Line
                from={{ x: currentTimeInfo.x, y: 0 }}
                to={{ x: currentTimeInfo.x, y: innerHeight }}
                stroke={spotPriceToColor(currentTimeInfo.price)}
                strokeWidth={3}
                strokeOpacity={0.8}
                filter="url(#glow)"
              />
              <circle
                cx={currentTimeInfo.x}
                cy={yScale(currentTimeInfo.price)}
                r={4}
                fill={spotPriceToColor(currentTimeInfo.price)}
                stroke="#ffffff"
                strokeWidth={2}
                filter="url(#glow)"
              />
              <text
                x={currentTimeInfo.x}
                y={-5}
                textAnchor="middle"
                fontSize={10}
                fill="#f9fafb"
                fontWeight="600"
              >
                NOW
              </text>
            </g>
          )}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickFormat={(value) => {
              const date = new Date(Number(value));
              return date.toLocaleTimeString('en-FI', {
                hour: '2-digit',
                minute: '2-digit',
              });
            }}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 9,
              textAnchor: 'middle',
            }}
            numTicks={Math.min(6, data.length)}
          />

          <AxisLeft
            scale={yScale}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={{
              fill: '#9ca3af',
              fontSize: 9,
              textAnchor: 'end',
            }}
            tickFormat={(value) => `${Number(value).toFixed(1)}`}
            numTicks={5}
          />

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
          title={
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: spotPriceToColor(tooltipData.value) }}
              />
              {tooltipData.value.toFixed(2)} c/kWh
            </div>
          }
          fields={[
            {
              label: 'Category',
              value:
                tooltipData.value < 0
                  ? 'Negative price'
                  : tooltipData.value < 5
                    ? 'Low price'
                    : tooltipData.value < 15
                      ? 'Medium price'
                      : 'High price',
              secondary: true,
            },
          ]}
          timestamp={new Date(tooltipData.time)}
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
