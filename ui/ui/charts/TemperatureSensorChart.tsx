import React, { useMemo, memo } from 'react';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleTime, scaleLinear } from '@visx/scale';
import { LinearGradient } from '@visx/gradient';
import { GridRows } from '@visx/grid';
import { LinePath } from '@visx/shape';
import { curveCardinal } from '@visx/curve';
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

// Unified temperature thresholds and categories
const TEMP_THRESHOLDS = {
  VERY_COLD: -20,
  FREEZING: 0,
  COLD: 8,
  COOL: 18,
  COMFORTABLE_MIN: 20,
  COMFORTABLE_MAX: 25,
  WARM: 27,
  HOT: 30,
} as const;

const getTemperatureCategory = (temp: number): string => {
  if (temp < TEMP_THRESHOLDS.FREEZING) return 'Freezing';
  if (temp < TEMP_THRESHOLDS.COLD) return 'Cold';
  if (temp < TEMP_THRESHOLDS.COOL) return 'Cool';
  if (temp < TEMP_THRESHOLDS.COMFORTABLE_MIN) return 'Mild';
  if (temp <= TEMP_THRESHOLDS.COMFORTABLE_MAX) return 'Comfortable';
  if (temp < TEMP_THRESHOLDS.WARM) return 'Warm';
  return 'Hot';
};

// Create dynamic gradient for each temperature value
const createTemperatureGradientId = (value: number, index: number) => {
  return `tempGradient_${index}_${Math.round(value * 100)}`;
};

// Get single temperature color for tooltips and badges
const getTemperatureColor = (temp: number, boostLightness?: boolean) => {
  const saturation = boostLightness ? 1 : 0.45;
  const lightness = boostLightness ? 0.7 : 0.5;

  // Define temperature points and corresponding hue values for smooth interpolation
  const tempPoints = [
    { temp: TEMP_THRESHOLDS.VERY_COLD, hue: 240 }, // Deep blue for very cold
    { temp: TEMP_THRESHOLDS.FREEZING, hue: 200 }, // Blue for freezing
    { temp: TEMP_THRESHOLDS.COLD, hue: 180 }, // Cyan for cold
    { temp: TEMP_THRESHOLDS.COOL, hue: 150 }, // Light blue for cool
    { temp: TEMP_THRESHOLDS.COMFORTABLE_MIN, hue: 120 }, // Green for mild/comfortable start
    { temp: TEMP_THRESHOLDS.COMFORTABLE_MAX, hue: 100 }, // Green for comfortable end
    { temp: TEMP_THRESHOLDS.WARM, hue: 60 }, // Yellow for warm
    { temp: TEMP_THRESHOLDS.HOT, hue: 0 }, // Red for hot
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

  // Interpolate between the two hue values
  const baseHue =
    lowerPoint.hue + (upperPoint.hue - lowerPoint.hue) * clampedFactor;

  return `hsl(${baseHue}, ${saturation * 100}%, ${lightness * 100}%)`;
};

// Export for use in other components
export { getTemperatureColor, getTemperatureCategory };

// Memoized Temperature Line Component
const TemperatureLine = memo(
  ({
    data,
    xScale,
    yScale,
    innerHeight,
  }: {
    data: TemperatureData[];
    xScale: any;
    yScale: any;
    innerHeight: number;
  }) => {
    const validData = data.filter((d) => d.temp !== undefined);

    // Group consecutive data points to handle gaps
    const dataSegments = useMemo(() => {
      if (validData.length === 0) return [];

      const segments: TemperatureData[][] = [];
      let currentSegment: TemperatureData[] = [validData[0]];

      for (let i = 1; i < validData.length; i++) {
        const timeDiff =
          validData[i].time.getTime() - validData[i - 1].time.getTime();
        // If gap is more than 2 hours, start new segment
        if (timeDiff > 2 * 60 * 60 * 1000) {
          segments.push(currentSegment);
          currentSegment = [validData[i]];
        } else {
          currentSegment.push(validData[i]);
        }
      }
      segments.push(currentSegment);

      return segments;
    }, [validData]);

    return (
      <>
        {/* Render each segment as a separate line */}
        {dataSegments.map((segment, segmentIndex) => {
          if (segment.length < 2) {
            // Single point - render as circle
            const d = segment[0];
            return (
              <circle
                key={`point-${segmentIndex}`}
                cx={xScale(d.time) ?? 0}
                cy={yScale(d.temp) ?? 0}
                r={3}
                fill={getTemperatureColor(d.temp)}
                stroke="#ffffff"
                strokeWidth={1}
              />
            );
          }

          return (
            <g key={`segment-${segmentIndex}`}>
              {/* Line segments with per-segment coloring */}
              {segment.map((d, i) => {
                if (i === segment.length - 1) return null;

                const nextPoint = segment[i + 1];
                const color = getTemperatureColor(d.temp);

                return (
                  <LinePath<TemperatureData>
                    key={`line-${segmentIndex}-${i}`}
                    data={[d, nextPoint]}
                    x={(pt) => xScale(pt.time) ?? 0}
                    y={(pt) => yScale(pt.temp) ?? 0}
                    stroke={color}
                    strokeWidth={3}
                    curve={curveCardinal}
                    fill="transparent"
                  />
                );
              })}

              {/* Data points */}
              {segment.map((d, i) => (
                <circle
                  key={`point-${segmentIndex}-${i}`}
                  cx={xScale(d.time) ?? 0}
                  cy={yScale(d.temp) ?? 0}
                  r={3}
                  fill={getTemperatureColor(d.temp)}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              ))}
            </g>
          );
        })}

        {/* Gap indicators */}
        {dataSegments.map((segment, segmentIndex) => {
          if (segmentIndex === dataSegments.length - 1) return null;

          const lastPoint = segment[segment.length - 1];
          const nextSegment = dataSegments[segmentIndex + 1];
          const firstPointNext = nextSegment[0];

          const gapStartX = xScale(lastPoint.time) ?? 0;
          const gapEndX = xScale(firstPointNext.time) ?? 0;
          const gapY = innerHeight - 10;

          return (
            <g key={`gap-${segmentIndex}`}>
              <line
                x1={gapStartX}
                y1={gapY}
                x2={gapEndX}
                y2={gapY}
                stroke="#6b7280"
                strokeWidth={2}
                strokeDasharray="5,5"
                opacity={0.6}
              />
              <text
                x={(gapStartX + gapEndX) / 2}
                y={gapY - 5}
                textAnchor="middle"
                fontSize="10"
                fill="#9ca3af"
              >
                No data
              </text>
            </g>
          );
        })}
      </>
    );
  },
);

TemperatureLine.displayName = 'TemperatureLine';

// Memoized Grid Component
const TemperatureGrid = memo(
  ({
    yScale,
    innerWidth,
    innerHeight,
  }: {
    yScale: any;
    innerWidth: number;
    innerHeight: number;
  }) => (
    <GridRows
      scale={yScale}
      width={innerWidth}
      height={innerHeight}
      stroke="#374151"
      strokeOpacity={0.3}
      strokeDasharray="2,2"
    />
  ),
);

TemperatureGrid.displayName = 'TemperatureGrid';

// Memoized Hover Indicator Component
const TemperatureHoverIndicator = memo(
  ({
    tooltipOpen,
    tooltipData,
    xScale,
    innerHeight,
  }: {
    tooltipOpen: boolean;
    tooltipData: TemperatureData | undefined;
    xScale: any;
    innerHeight: number;
  }) => {
    if (!tooltipOpen || !tooltipData) return null;

    const x = xScale(tooltipData.time) ?? 0;

    return (
      <line
        x1={x}
        y1={0}
        x2={x}
        y2={innerHeight}
        stroke="rgba(156, 163, 175, 0.6)"
        strokeWidth={2}
        strokeDasharray="3,3"
        pointerEvents="none"
      />
    );
  },
);

TemperatureHoverIndicator.displayName = 'TemperatureHoverIndicator';

const TemperatureSensorChartComponent: React.FC<
  TemperatureSensorChartProps
> = ({ data, width, height, margin = defaultMargin, animate = true }) => {
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

  // Memoize scales
  const { xScale, yScale } = useMemo(() => {
    const xScale = scaleTime<number>({
      range: [0, innerWidth],
      domain: [
        Math.min(...data.map((d) => d.time.getTime())),
        Math.max(...data.map((d) => d.time.getTime())),
      ],
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

  // Memoize interaction functions
  const findDataPoint = useMemo(
    () =>
      (position: TooltipPosition): TemperatureData | undefined => {
        const xPos = position.x;
        const time = xScale.invert(xPos);

        let closestIndex = 0;
        let closestDistance = Infinity;

        data.forEach((d, i) => {
          const distance = Math.abs(d.time.getTime() - time.getTime());
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
    () => (datum: TemperatureData) => {
      const x = xScale(datum.time.getTime()) ?? 0;
      const y = yScale(datum.temp) ?? 0;
      return { x, y };
    },
    [xScale, yScale],
  );

  if (width < 10) return null;

  return (
    <div className="relative overflow-hidden" ref={containerRef}>
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
          <TemperatureGrid
            yScale={yScale}
            innerWidth={innerWidth}
            innerHeight={innerHeight}
          />

          <TemperatureLine
            data={data}
            xScale={xScale}
            yScale={yScale}
            innerHeight={innerHeight}
          />

          <TemperatureHoverIndicator
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
          title={
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: getTemperatureColor(tooltipData.temp),
                }}
              />
              {tooltipData.temp.toFixed(1)}°C
            </div>
          }
          fields={[
            {
              label: 'Category',
              value: getTemperatureCategory(tooltipData.temp),
              secondary: true,
            },
          ]}
          timestamp={tooltipData.time}
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

export const TemperatureSensorChart = memo(
  TemperatureSensorChartComponent,
  (prevProps, nextProps) => {
    // Custom comparison to avoid unnecessary re-renders
    return (
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height &&
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

TemperatureSensorChart.displayName = 'TemperatureSensorChart';
