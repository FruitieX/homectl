import React, { useMemo, memo } from 'react';
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

// Create dynamic gradient for each value
const createGradientId = (value: number, index: number, type = 'price') => {
  return `${type}Gradient_${index}_${Math.round(value * 100)}`;
};

// Generate gradient colors for spot price values
const getSpotPriceGradientColors = (
  value: number,
  minValue: number,
  maxValue: number,
) => {
  // Price-based hue calculation
  const baseHue = Math.min(Math.max(0, 120 - 5 * value), 300);
  const saturation = 0.4;

  // Calculate intensity based on absolute value to maintain visual hierarchy
  const absValue = Math.abs(value);
  const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
  const intensity = absMax > 0 ? absValue / absMax : 0;

  // Create gradient based on value intensity
  let fromLightness: number;
  let toLightness: number;

  if (value < 0) {
    // Negative values: use cooler, muted gradient
    fromLightness = 0.65 - intensity * 0.15;
    toLightness = 0.45 - intensity * 0.1;
  } else if (value === 0) {
    // Zero value: neutral gradient
    fromLightness = 0.6;
    toLightness = 0.4;
  } else {
    // Positive values: use warmer, more intense gradient
    const valueIntensity = Math.min(intensity * 1.2, 0.8);
    fromLightness = 0.7 - valueIntensity * 0.2;
    toLightness = 0.35 - valueIntensity * 0.15;
  }

  // Ensure lightness values are within valid range
  fromLightness = Math.max(0.25, Math.min(0.75, fromLightness));
  toLightness = Math.max(0.2, Math.min(0.6, toLightness));

  const fromColor = `hsl(${baseHue}, ${saturation * 100}%, ${fromLightness * 100}%)`;
  const toColor = `hsl(${baseHue}, ${saturation * 100}%, ${toLightness * 100}%)`;

  return { from: fromColor, to: toColor };
};

// Generate single spot price color
const spotPriceToColor = (spotPrice: number) => {
  const baseHue = Math.min(Math.max(0, 120 - 5 * spotPrice), 300);
  const saturation = 0.4;
  const lightness = 0.5;
  return `hsl(${baseHue}, ${saturation * 100}%, ${lightness * 100}%)`;
};

// Export for use in other components
export { spotPriceToColor };

const getGradientColors = (
  value: number,
  minValue: number,
  maxValue: number,
) => {
  return getSpotPriceGradientColors(value, minValue, maxValue);
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

// Memoized Bars Component
const SpotPriceBars = memo(
  ({
    data,
    xScale,
    yScale,
    innerHeight,
  }: {
    data: SpotPriceData[];
    xScale: any;
    yScale: any;
    innerHeight: number;
  }) => {
    const gradients = useMemo(() => {
      const minValue = Math.min(...data.map((d) => d.value));
      const maxValue = Math.max(...data.map((d) => d.value));

      return data.map((d, i) => {
        const gradientId = createGradientId(d.value, i);
        const colors = getSpotPriceGradientColors(d.value, minValue, maxValue);
        return { id: gradientId, colors, value: d.value };
      });
    }, [data]);

    return (
      <>
        {/* Dynamic gradients for each bar */}
        <defs>
          {gradients.map(({ id, colors }) => (
            <LinearGradient
              key={id}
              id={id}
              from={colors.from}
              to={colors.to}
              fromOpacity={0.95}
              toOpacity={1}
              vertical={true}
            />
          ))}
        </defs>

        {data.map((d, i) => {
          const barWidth = xScale.bandwidth();
          const barHeight = Math.abs(
            innerHeight -
              (yScale(d.value) ?? 0) -
              (d.value < 0 ? (yScale(0) ?? 0) : 0),
          );
          const barX = xScale(d.time) ?? 0;
          const barY = d.value < 0 ? (yScale(0) ?? 0) : (yScale(d.value) ?? 0);

          const gradientId = createGradientId(d.value, i);

          return (
            <g key={i}>
              <rect
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill={`url(#${gradientId})`}
                strokeWidth={1}
                rx={2}
                ry={2}
              />
            </g>
          );
        })}
      </>
    );
  },
);

SpotPriceBars.displayName = 'SpotPriceBars';

// Memoized Grid Component
const ChartGrid = memo(
  ({
    xScale,
    yScale,
    innerWidth,
    innerHeight,
  }: {
    xScale: any;
    yScale: any;
    innerWidth: number;
    innerHeight: number;
  }) => (
    <>
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
    </>
  ),
);

ChartGrid.displayName = 'ChartGrid';

// Memoized Current Time Marker Component
const CurrentTimeMarker = memo(
  ({
    currentTimeInfo,
    yScale,
    innerHeight,
  }: {
    currentTimeInfo: { x: number; price: number } | null;
    yScale: any;
    innerHeight: number;
  }) => {
    if (!currentTimeInfo) return null;

    return (
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
      </g>
    );
  },
);

CurrentTimeMarker.displayName = 'CurrentTimeMarker';

// Memoized Hover Indicator Component
const HoverIndicator = memo(
  ({
    tooltipOpen,
    tooltipData,
    xScale,
    innerHeight,
  }: {
    tooltipOpen: boolean;
    tooltipData: SpotPriceData | undefined;
    xScale: any;
    innerHeight: number;
  }) => {
    if (!tooltipOpen || !tooltipData) return null;

    return (
      <rect
        x={xScale(tooltipData.time) ?? 0}
        y={0}
        width={xScale.bandwidth()}
        height={innerHeight}
        fill="rgba(156, 163, 175, 0.2)"
        stroke="rgba(156, 163, 175, 0.4)"
        strokeWidth={1}
        strokeDasharray="3,3"
        pointerEvents="none"
      />
    );
  },
);

HoverIndicator.displayName = 'HoverIndicator';

const SpotPriceChartComponent: React.FC<SpotPriceChartProps> = ({
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

  // Generate midnight markers for multi-day charts
  const midnightLines = useMemo(() => {
    if (data.length === 0) return [];

    const startTime = data[0].time;
    const endTime = data[data.length - 1].time;
    const lines = [];

    // Start from the next midnight after the first data point
    let currentDate = new Date(startTime);
    currentDate.setHours(0, 0, 0, 0);
    currentDate.setDate(currentDate.getDate() + 1);

    while (currentDate.getTime() <= endTime) {
      lines.push(currentDate.getTime());
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return lines;
  }, [data]);

  // Memoize scales
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

  // Memoize current time calculation
  const currentTimeInfo = useMemo(() => {
    return showCurrentTime ? getCurrentTimePosition(data, xScale) : null;
  }, [data, xScale, showCurrentTime]);

  // Memoize interaction functions
  const findDataPoint = useMemo(
    () =>
      (position: TooltipPosition): SpotPriceData | undefined => {
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
      },
    [data, xScale],
  );

  const getDataPointPosition = useMemo(
    () => (datum: SpotPriceData) => {
      const x = (xScale(datum.time) ?? 0) + xScale.bandwidth() / 2;
      const y = datum.value < 0 ? (yScale(0) ?? 0) : (yScale(datum.value) ?? 0);
      return { x, y };
    },
    [xScale, yScale],
  );

  if (width < 10) return null;

  return (
    <div className="relative" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
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
          <ChartGrid
            xScale={xScale}
            yScale={yScale}
            innerWidth={innerWidth}
            innerHeight={innerHeight}
          />

          <SpotPriceBars
            data={data}
            xScale={xScale}
            yScale={yScale}
            innerHeight={innerHeight}
          />

          <CurrentTimeMarker
            currentTimeInfo={currentTimeInfo}
            yScale={yScale}
            innerHeight={innerHeight}
          />

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

          {/* Midnight lines for multi-day charts */}
          {midnightLines.map((midnightTime, i) => (
            <Line
              key={i}
              from={{ x: xScale(midnightTime) ?? 0, y: 0 }}
              to={{ x: xScale(midnightTime) ?? 0, y: innerHeight }}
              stroke="#6b7280"
              strokeWidth={2}
              strokeOpacity={0.4}
              strokeDasharray="2,4"
            />
          ))}

          <HoverIndicator
            tooltipOpen={tooltipOpen}
            tooltipData={tooltipData}
            xScale={xScale}
            innerHeight={innerHeight}
          />

          {/* Unified interaction overlay */}
          <ChartInteractionOverlay
            width={width}
            height={height}
            margin={margin}
            data={data}
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
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: spotPriceToColor(tooltipData.value),
                }}
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
          offsetTop={-40}
          offsetLeft={-10}
        />
      )}
    </div>
  );
};

export const SpotPriceChart = memo(
  SpotPriceChartComponent,
  (prevProps, nextProps) => {
    // Custom comparison to avoid unnecessary re-renders
    return (
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height &&
      prevProps.animate === nextProps.animate &&
      prevProps.showCurrentTime === nextProps.showCurrentTime &&
      prevProps.data.length === nextProps.data.length &&
      // Compare data arrays efficiently - only check if lengths and first/last items match
      (prevProps.data.length === 0 ||
        (prevProps.data[0]?.time === nextProps.data[0]?.time &&
          prevProps.data[0]?.value === nextProps.data[0]?.value &&
          prevProps.data[prevProps.data.length - 1]?.time ===
            nextProps.data[nextProps.data.length - 1]?.time &&
          prevProps.data[prevProps.data.length - 1]?.value ===
            nextProps.data[nextProps.data.length - 1]?.value)) &&
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

SpotPriceChart.displayName = 'SpotPriceChart';
