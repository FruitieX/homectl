import React, { useMemo, memo } from 'react';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft, AxisRight } from '@visx/axis';
import { scaleTime, scaleLinear } from '@visx/scale';
import { GridRows } from '@visx/grid';
import { LinePath } from '@visx/shape';
import { curveCardinal } from '@visx/curve';
import { useChartTooltip } from './hooks/useChartTooltip';
import { ChartTooltip } from './ChartTooltip';
import { ChartInteractionOverlay } from './ChartInteractionOverlay';
import {
  getTemperatureColor,
  getTemperatureCategory,
} from '@/ui/charts/TemperatureSensorChart';
import { getHumidityColor, getHumidityCategory } from '@/lib/humidityColors';

interface SensorDataPoint {
  time: Date;
  temp?: number;
  humidity?: number;
}

interface SensorChartProps {
  data: SensorDataPoint[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
  showTemperature?: boolean;
  showHumidity?: boolean;
}

const defaultMargin = { top: 20, right: 60, bottom: 40, left: 50 };

// Memoized Temperature Line Component
const TemperatureLine = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: SensorDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    const validData = data.filter((d) => d.temp !== undefined);

    if (validData.length === 0) return null;

    // Group consecutive data points to handle gaps
    const dataSegments = useMemo(() => {
      if (validData.length === 0) return [];

      const segments: SensorDataPoint[][] = [];
      let currentSegment: SensorDataPoint[] = [validData[0]];

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
      <g>
        {/* Render each segment as a separate line */}
        {dataSegments.map((segment, segmentIndex) => {
          if (segment.length < 2) {
            // Single point - render as circle
            const d = segment[0];
            if (d.temp === undefined) return null;
            return (
              <circle
                key={`temp-point-${segmentIndex}`}
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
            <g key={`temp-segment-${segmentIndex}`}>
              {/* Line segments with per-segment coloring */}
              {segment.map((d, i) => {
                if (i === segment.length - 1 || d.temp === undefined)
                  return null;

                const nextPoint = segment[i + 1];
                if (nextPoint.temp === undefined) return null;

                const color = getTemperatureColor(d.temp);

                return (
                  <LinePath<SensorDataPoint>
                    key={`temp-line-${segmentIndex}-${i}`}
                    data={[d, nextPoint]}
                    x={(pt) => xScale(pt.time) ?? 0}
                    y={(pt) => yScale(pt.temp!) ?? 0}
                    stroke={color}
                    strokeWidth={3}
                    curve={curveCardinal}
                    fill="transparent"
                  />
                );
              })}

              {/* Data points */}
              {segment.map((d, i) => {
                if (d.temp === undefined) return null;
                return (
                  <circle
                    key={`temp-point-${segmentIndex}-${i}`}
                    cx={xScale(d.time) ?? 0}
                    cy={yScale(d.temp) ?? 0}
                    r={3}
                    fill={getTemperatureColor(d.temp)}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    );
  },
);

TemperatureLine.displayName = 'TemperatureLine';

// Memoized Humidity Line Component
const HumidityLine = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: SensorDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    const validData = data.filter((d) => d.humidity !== undefined);

    if (validData.length === 0) return null;

    // Group consecutive data points to handle gaps
    const dataSegments = useMemo(() => {
      if (validData.length === 0) return [];

      const segments: SensorDataPoint[][] = [];
      let currentSegment: SensorDataPoint[] = [validData[0]];

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
      <g>
        {/* Render each segment as a separate line */}
        {dataSegments.map((segment, segmentIndex) => {
          if (segment.length < 2) {
            // Single point - render as circle
            const d = segment[0];
            if (d.humidity === undefined) return null;
            return (
              <circle
                key={`hum-point-${segmentIndex}`}
                cx={xScale(d.time) ?? 0}
                cy={yScale(d.humidity) ?? 0}
                r={3}
                fill={getHumidityColor(d.humidity)}
                stroke="#ffffff"
                strokeWidth={1}
                opacity={0.8}
              />
            );
          }

          return (
            <g key={`hum-segment-${segmentIndex}`}>
              {/* Line segments with per-segment coloring */}
              {segment.map((d, i) => {
                if (i === segment.length - 1 || d.humidity === undefined)
                  return null;

                const nextPoint = segment[i + 1];
                if (nextPoint.humidity === undefined) return null;

                const color = getHumidityColor(d.humidity);

                return (
                  <LinePath<SensorDataPoint>
                    key={`hum-line-${segmentIndex}-${i}`}
                    data={[d, nextPoint]}
                    x={(pt) => xScale(pt.time) ?? 0}
                    y={(pt) => yScale(pt.humidity!) ?? 0}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="3,3"
                    curve={curveCardinal}
                    fill="transparent"
                    opacity={0.8}
                  />
                );
              })}

              {/* Data points */}
              {segment.map((d, i) => {
                if (d.humidity === undefined) return null;
                return (
                  <circle
                    key={`hum-point-${segmentIndex}-${i}`}
                    cx={xScale(d.time) ?? 0}
                    cy={yScale(d.humidity) ?? 0}
                    r={2}
                    fill={getHumidityColor(d.humidity)}
                    stroke="#ffffff"
                    strokeWidth={1}
                    opacity={0.8}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    );
  },
);

HumidityLine.displayName = 'HumidityLine';

// Memoized Grid Component
const SensorGrid = memo(
  ({
    tempScale,
    humidityScale,
    innerWidth,
    innerHeight,
    showTemperature,
    showHumidity,
  }: {
    tempScale?: any;
    humidityScale?: any;
    innerWidth: number;
    innerHeight: number;
    showTemperature: boolean;
    showHumidity: boolean;
  }) => (
    <g>
      {showTemperature && tempScale && (
        <GridRows
          scale={tempScale}
          width={innerWidth}
          height={innerHeight}
          stroke="#374151"
          strokeOpacity={0.3}
          strokeDasharray="2,2"
        />
      )}
    </g>
  ),
);

SensorGrid.displayName = 'SensorGrid';

// Memoized Hover Indicator Component
const SensorHoverIndicator = memo(
  ({
    tooltipOpen,
    tooltipData,
    xScale,
    innerHeight,
  }: {
    tooltipOpen: boolean;
    tooltipData: SensorDataPoint | undefined;
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

SensorHoverIndicator.displayName = 'SensorHoverIndicator';

const SensorChartComponent: React.FC<SensorChartProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
  animate = true,
  showTemperature = true,
  showHumidity = true,
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
  } = useChartTooltip<SensorDataPoint>({
    data,
    margin,
  });

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Memoize scales
  const { xScale, tempScale, humidityScale } = useMemo(() => {
    const xScale = scaleTime<number>({
      range: [0, innerWidth],
      domain: [
        Math.min(...data.map((d) => d.time.getTime())),
        Math.max(...data.map((d) => d.time.getTime())),
      ],
    });

    let tempScale, humidityScale;

    if (showTemperature) {
      const tempValues = data
        .filter((d) => d.temp !== undefined)
        .map((d) => d.temp!);
      if (tempValues.length > 0) {
        tempScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [Math.min(...tempValues) - 2, Math.max(...tempValues) + 2],
          nice: false,
        });
      }
    }

    if (showHumidity) {
      const humidityValues = data
        .filter((d) => d.humidity !== undefined)
        .map((d) => d.humidity!);
      if (humidityValues.length > 0) {
        humidityScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [0, 100],
          nice: false,
        });
      }
    }

    return { xScale, tempScale, humidityScale };
  }, [data, innerWidth, innerHeight, showTemperature, showHumidity]);

  // Memoize interaction functions
  const findDataPoint = useMemo(
    () =>
      (position: { x: number; y: number }): SensorDataPoint | undefined => {
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
    () => (datum: SensorDataPoint) => {
      const x = xScale(datum.time.getTime()) ?? 0;
      let y = 0;

      // Use temperature scale if available, otherwise humidity scale
      if (datum.temp !== undefined && tempScale) {
        y = tempScale(datum.temp) ?? 0;
      } else if (datum.humidity !== undefined && humidityScale) {
        y = humidityScale(datum.humidity) ?? 0;
      }

      return { x, y };
    },
    [xScale, tempScale, humidityScale],
  );

  if (width < 10) return null;

  return (
    <div className="relative overflow-hidden" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          rx={8}
        />

        <Group left={margin.left} top={margin.top}>
          <SensorGrid
            tempScale={tempScale}
            humidityScale={humidityScale}
            innerWidth={innerWidth}
            innerHeight={innerHeight}
            showTemperature={showTemperature}
            showHumidity={showHumidity}
          />

          {showTemperature && tempScale && (
            <TemperatureLine data={data} xScale={xScale} yScale={tempScale} />
          )}

          {showHumidity && humidityScale && (
            <HumidityLine data={data} xScale={xScale} yScale={humidityScale} />
          )}

          <SensorHoverIndicator
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

          {showTemperature && tempScale && (
            <AxisLeft
              scale={tempScale}
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
          )}

          {showHumidity && humidityScale && (
            <AxisRight
              left={innerWidth}
              scale={humidityScale}
              stroke="#6b7280"
              tickStroke="#6b7280"
              tickLabelProps={{
                fill: '#9ca3af',
                fontSize: 10,
                textAnchor: 'start',
              }}
              tickFormat={(value) => `${value}%`}
              numTicks={6}
            />
          )}
        </Group>
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={
            <div className="flex flex-col gap-1">
              {tooltipData.temp !== undefined && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: getTemperatureColor(tooltipData.temp),
                    }}
                  />
                  <span>
                    {tooltipData.temp.toFixed(1)}°C (
                    {getTemperatureCategory(tooltipData.temp)})
                  </span>
                </div>
              )}
              {tooltipData.humidity !== undefined && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full border border-white"
                    style={{
                      backgroundColor: getHumidityColor(tooltipData.humidity),
                      opacity: 0.8,
                    }}
                  />
                  <span>
                    {tooltipData.humidity.toFixed(1)}% (
                    {getHumidityCategory(tooltipData.humidity)})
                  </span>
                </div>
              )}
            </div>
          }
          fields={[]}
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

export const SensorChart = memo(
  SensorChartComponent,
  (prevProps, nextProps) => {
    // Custom comparison to avoid unnecessary re-renders
    return (
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height &&
      prevProps.animate === nextProps.animate &&
      prevProps.showTemperature === nextProps.showTemperature &&
      prevProps.showHumidity === nextProps.showHumidity &&
      prevProps.data.length === nextProps.data.length &&
      // Compare data arrays efficiently - only check if lengths and first/last items match
      (prevProps.data.length === 0 ||
        (prevProps.data[0]?.time.getTime() ===
          nextProps.data[0]?.time.getTime() &&
          prevProps.data[0]?.temp === nextProps.data[0]?.temp &&
          prevProps.data[0]?.humidity === nextProps.data[0]?.humidity &&
          prevProps.data[prevProps.data.length - 1]?.time.getTime() ===
            nextProps.data[nextProps.data.length - 1]?.time.getTime() &&
          prevProps.data[prevProps.data.length - 1]?.temp ===
            nextProps.data[nextProps.data.length - 1]?.temp &&
          prevProps.data[prevProps.data.length - 1]?.humidity ===
            nextProps.data[nextProps.data.length - 1]?.humidity)) &&
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

SensorChart.displayName = 'SensorChart';
