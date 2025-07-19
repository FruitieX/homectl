import React, { useMemo, memo } from 'react';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft, AxisRight } from '@visx/axis';
import { scaleTime, scaleLinear } from '@visx/scale';
import { GridRows } from '@visx/grid';
import { AreaClosed, LinePath } from '@visx/shape';
import { curveCardinal } from '@visx/curve';
import { useChartTooltip } from './hooks/useChartTooltip';
import { ChartTooltip } from './ChartTooltip';
import { ChartInteractionOverlay } from './ChartInteractionOverlay';
import { getTemperatureColor } from '@/ui/charts/TemperatureSensorChart';
import { getHumidityColor } from '@/lib/humidityColors';
import { Button } from 'react-daisyui';

interface SensorReading {
  time: Date;
  value: number;
  deviceId: string;
  deviceName: string;
  color: string;
}

interface CombinedDataPoint {
  time: Date;
  tempReadings: SensorReading[];
  humidityReadings: SensorReading[];
}

interface CombinedSensorsChartProps {
  data: CombinedDataPoint[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
  showTemperature?: boolean;
  showHumidity?: boolean;
  sensorFilter: 'indoor' | 'outdoor';
  onSensorFilterChange: (filter: 'indoor' | 'outdoor') => void;
  chartType: 'temperature' | 'humidity';
  chartId?: string;
}

const defaultMargin = { top: 20, right: 60, bottom: 40, left: 50 };

// Utility function to detect gaps in sensor data (>1 hour)
const hasGap = (time1: Date, time2: Date): boolean => {
  return time2.getTime() - time1.getTime() > 1 * 60 * 60 * 1000; // 1 hour
};

// Segment area data by device changes and gaps
const segmentAreaDataByDeviceChanges = (
  data: CombinedDataPoint[],
  type: 'temp' | 'humidity',
): CombinedDataPoint[][] => {
  if (data.length === 0) return [];

  const sortedData = [...data].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
  const segments: CombinedDataPoint[][] = [];
  let currentSegment: CombinedDataPoint[] = [sortedData[0]];

  // Track active devices in the current segment
  let currentDevices = new Set(
    type === 'temp'
      ? sortedData[0].tempReadings.map((r) => r.deviceId)
      : sortedData[0].humidityReadings.map((r) => r.deviceId),
  );

  for (let i = 1; i < sortedData.length; i++) {
    const currentPoint = sortedData[i];
    const prevPoint = sortedData[i - 1];

    const currentPointDevices = new Set(
      type === 'temp'
        ? currentPoint.tempReadings.map((r) => r.deviceId)
        : currentPoint.humidityReadings.map((r) => r.deviceId),
    );

    // Check for time gap
    const hasTimeGap = hasGap(prevPoint.time, currentPoint.time);

    // Check for device changes (device goes offline or comes online)
    const devicesChanged =
      currentDevices.size !== currentPointDevices.size ||
      [...currentDevices].some((id) => !currentPointDevices.has(id)) ||
      [...currentPointDevices].some((id) => !currentDevices.has(id));

    if (hasTimeGap || devicesChanged) {
      // Include transition point in current segment for continuity
      currentSegment.push(currentPoint);

      // End current segment
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }

      // Start new segment with the transition point
      currentSegment = [currentPoint];
      currentDevices = currentPointDevices;
    } else {
      currentSegment.push(currentPoint);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
};

// Improved segmentation for lines that handles sensor transitions smoothly
const segmentLineDataBySensorGaps = (
  data: CombinedDataPoint[],
  deviceId: string,
  type: 'temp' | 'humidity',
): {
  time: Date;
  value: number;
  deviceId: string;
  deviceName: string;
  color: string;
}[][] => {
  if (data.length === 0) return [];

  // Extract device data points
  const deviceData = data
    .map((d) => {
      const reading =
        type === 'temp'
          ? d.tempReadings.find((r) => r.deviceId === deviceId)
          : d.humidityReadings.find((r) => r.deviceId === deviceId);
      return reading
        ? {
            time: d.time,
            value: reading.value,
            deviceId: reading.deviceId,
            deviceName: reading.deviceName,
            color: reading.color,
          }
        : null;
    })
    .map((point, index) => ({ point, originalIndex: index }))
    .filter(
      (
        item,
      ): item is {
        point: NonNullable<typeof item.point>;
        originalIndex: number;
      } => item.point !== null,
    );

  if (deviceData.length === 0) return [];

  const segments: (typeof deviceData)[0]['point'][][] = [];
  let currentSegment: (typeof deviceData)[0]['point'][] = [deviceData[0].point];

  for (let i = 1; i < deviceData.length; i++) {
    const currentDataPoint = deviceData[i];
    const prevDataPoint = deviceData[i - 1];

    // Check if there's a gap in the original data (missing readings between these points)
    const indexGap =
      currentDataPoint.originalIndex - prevDataPoint.originalIndex;
    const hasDataGap =
      indexGap > 1 ||
      hasGap(prevDataPoint.point.time, currentDataPoint.point.time);

    if (hasDataGap) {
      // End current segment and start new one
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = [currentDataPoint.point];
    } else {
      currentSegment.push(currentDataPoint.point);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
};

// Memoized Temperature Area Component (for min/max)
const TemperatureArea = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: CombinedDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    const segments = useMemo(
      () => segmentAreaDataByDeviceChanges(data, 'temp'),
      [data],
    );

    return (
      <g>
        {segments.map((segment, segmentIndex) => {
          const areaData = segment
            .map((d) => {
              const values = d.tempReadings.map((r) => r.value);
              if (values.length === 0) return null;
              return {
                time: d.time,
                min: Math.min(...values),
                max: Math.max(...values),
              };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null);

          if (areaData.length === 0) return null;

          return (
            <AreaClosed
              key={`temp-area-segment-${segmentIndex}`}
              data={areaData}
              x={(d) => xScale(d.time) ?? 0}
              y0={(d) => yScale(d.min) ?? 0}
              y1={(d) => yScale(d.max) ?? 0}
              yScale={yScale}
              fill="url(#tempGradient)"
              fillOpacity={0.2}
              curve={curveCardinal}
            />
          );
        })}
      </g>
    );
  },
);

TemperatureArea.displayName = 'TemperatureArea';

// Memoized Temperature Lines Component
const TemperatureLines = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: CombinedDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    // Get all unique devices from the data
    const devices = new Set<string>();
    data.forEach((d) => {
      d.tempReadings.forEach((reading) => devices.add(reading.deviceId));
    });

    return (
      <g>
        {Array.from(devices).map((deviceId) => {
          // Segment the data to handle gaps
          const segments = segmentLineDataBySensorGaps(data, deviceId, 'temp');

          if (segments.length === 0) return null;

          return (
            <g key={`temp-lines-${deviceId}`}>
              {segments.map((segment, segmentIndex) => (
                <LinePath<(typeof segment)[0]>
                  key={`temp-line-${deviceId}-${segmentIndex}`}
                  data={segment}
                  x={(d) => xScale(d.time) ?? 0}
                  y={(d) => yScale(d.value) ?? 0}
                  stroke={segment[0].color}
                  strokeWidth={2}
                  curve={curveCardinal}
                  fill="transparent"
                />
              ))}
            </g>
          );
        })}
      </g>
    );
  },
);

TemperatureLines.displayName = 'TemperatureLines';

// Memoized Humidity Area Component (for min/max)
const HumidityArea = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: CombinedDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    const segments = useMemo(
      () => segmentAreaDataByDeviceChanges(data, 'humidity'),
      [data],
    );

    return (
      <g>
        {segments.map((segment, segmentIndex) => {
          const areaData = segment
            .map((d) => {
              const values = d.humidityReadings.map((r) => r.value);
              if (values.length === 0) return null;
              return {
                time: d.time,
                min: Math.min(...values),
                max: Math.max(...values),
              };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null);

          if (areaData.length === 0) return null;

          return (
            <AreaClosed
              key={`humidity-area-segment-${segmentIndex}`}
              data={areaData}
              x={(d) => xScale(d.time) ?? 0}
              y0={(d) => yScale(d.min) ?? 0}
              y1={(d) => yScale(d.max) ?? 0}
              yScale={yScale}
              fill="url(#humidityGradient)"
              fillOpacity={0.2}
              curve={curveCardinal}
            />
          );
        })}
      </g>
    );
  },
);

HumidityArea.displayName = 'HumidityArea';

// Memoized Humidity Lines Component
const HumidityLines = memo(
  ({
    data,
    xScale,
    yScale,
  }: {
    data: CombinedDataPoint[];
    xScale: any;
    yScale: any;
  }) => {
    // Get all unique devices from the data
    const devices = new Set<string>();
    data.forEach((d) => {
      d.humidityReadings.forEach((reading) => devices.add(reading.deviceId));
    });

    return (
      <g>
        {Array.from(devices).map((deviceId) => {
          // Segment the data to handle gaps
          const segments = segmentLineDataBySensorGaps(
            data,
            deviceId,
            'humidity',
          );

          if (segments.length === 0) return null;

          return (
            <g key={`humidity-lines-${deviceId}`}>
              {segments.map((segment, segmentIndex) => (
                <LinePath<(typeof segment)[0]>
                  key={`humidity-line-${deviceId}-${segmentIndex}`}
                  data={segment}
                  x={(d) => xScale(d.time) ?? 0}
                  y={(d) => yScale(d.value) ?? 0}
                  stroke={segment[0].color}
                  strokeWidth={2}
                  strokeDasharray="3,3"
                  curve={curveCardinal}
                  fill="transparent"
                  opacity={0.8}
                />
              ))}
            </g>
          );
        })}
      </g>
    );
  },
);

HumidityLines.displayName = 'HumidityLines';

// Memoized Grid Component
const CombinedGrid = memo(
  ({
    scale,
    innerWidth,
    innerHeight,
  }: {
    scale: any;
    innerWidth: number;
    innerHeight: number;
  }) => (
    <GridRows
      scale={scale}
      width={innerWidth}
      height={innerHeight}
      stroke="#374151"
      strokeOpacity={0.2}
      strokeDasharray="1,3"
    />
  ),
);

CombinedGrid.displayName = 'CombinedGrid';

// Memoized Hover Indicator Component
const CombinedHoverIndicator = memo(
  ({
    tooltipOpen,
    tooltipData,
    xScale,
    innerHeight,
  }: {
    tooltipOpen: boolean;
    tooltipData: CombinedDataPoint | undefined;
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
        stroke="rgba(156, 163, 175, 0.8)"
        strokeWidth={2}
        strokeDasharray="3,3"
        pointerEvents="none"
      />
    );
  },
);

CombinedHoverIndicator.displayName = 'CombinedHoverIndicator';

const CombinedSensorsChartComponent: React.FC<CombinedSensorsChartProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
  animate = true,
  showTemperature = true,
  showHumidity = true,
  sensorFilter,
  onSensorFilterChange,
  chartType,
  chartId = 'default',
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
  } = useChartTooltip<CombinedDataPoint>({
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

    let yScale;

    if (chartType === 'temperature') {
      const tempValues = data
        .flatMap((d) => d.tempReadings.map((r) => r.value))
        .filter((v): v is number => v !== undefined);

      if (tempValues.length > 0) {
        yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [Math.min(...tempValues) - 2, Math.max(...tempValues) + 2],
          nice: true,
        });
      }
    } else {
      const humidityValues = data
        .flatMap((d) => d.humidityReadings.map((r) => r.value))
        .filter((v): v is number => v !== undefined);

      if (humidityValues.length > 0) {
        yScale = scaleLinear<number>({
          range: [innerHeight, 0],
          domain: [0, 100],
          nice: true,
        });
      }
    }

    return { xScale, yScale };
  }, [data, innerWidth, innerHeight, chartType]);

  // Memoize interaction functions
  const findDataPoint = useMemo(
    () =>
      (position: { x: number; y: number }): CombinedDataPoint | undefined => {
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
    () => (datum: CombinedDataPoint) => {
      const x = xScale(datum.time.getTime()) ?? 0;
      let y = innerHeight / 2; // Default to center

      if (
        chartType === 'temperature' &&
        datum.tempReadings.length > 0 &&
        yScale
      ) {
        y = yScale(datum.tempReadings[0].value) ?? 0;
      } else if (
        chartType === 'humidity' &&
        datum.humidityReadings.length > 0 &&
        yScale
      ) {
        y = yScale(datum.humidityReadings[0].value) ?? 0;
      }

      return { x, y };
    },
    [xScale, yScale, chartType],
  );

  if (width < 10) return null;

  return (
    <div className="relative overflow-hidden" ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          {/* Temperature gradient */}
          <linearGradient id="tempGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f97316" stopOpacity={0.4} />
            <stop offset="50%" stopColor="#fb923c" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#fed7aa" stopOpacity={0.1} />
          </linearGradient>

          {/* Humidity gradient */}
          <linearGradient
            id="humidityGradient"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="50%" stopColor="#a78bfa" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#ddd6fe" stopOpacity={0.1} />
          </linearGradient>
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
          {yScale && (
            <CombinedGrid
              scale={yScale}
              innerWidth={innerWidth}
              innerHeight={innerHeight}
            />
          )}

          {chartType === 'temperature' && yScale && (
            <>
              <TemperatureArea data={data} xScale={xScale} yScale={yScale} />
              <TemperatureLines data={data} xScale={xScale} yScale={yScale} />
            </>
          )}

          {chartType === 'humidity' && yScale && (
            <>
              <HumidityArea data={data} xScale={xScale} yScale={yScale} />
              <HumidityLines data={data} xScale={xScale} yScale={yScale} />
            </>
          )}

          <CombinedHoverIndicator
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
            numTicks={Math.min(8, data.length)}
          />

          {yScale && (
            <AxisLeft
              scale={yScale}
              stroke="#6b7280"
              tickStroke="#6b7280"
              tickLabelProps={{
                fill: '#9ca3af',
                fontSize: 10,
                textAnchor: 'end',
              }}
              tickFormat={(value) =>
                chartType === 'temperature' ? `${value}°C` : `${value}%`
              }
              numTicks={6}
            />
          )}
        </Group>
      </svg>

      {tooltipData && (
        <ChartTooltip
          title={
            <div className="flex flex-col gap-1">
              {chartType === 'temperature' &&
                tooltipData.tempReadings.length > 0 && (
                  <>
                    <div className="text-sm font-medium">Temperature</div>
                    {tooltipData.tempReadings
                      .sort((a, b) => b.value - a.value)
                      .map((reading) => (
                        <div
                          key={`tooltip-${chartId}-${reading.deviceId}`}
                          className="flex items-center gap-2"
                        >
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: reading.color }}
                          />
                          <span className="text-xs">
                            <span className="font-medium">
                              {reading.deviceName}:
                            </span>{' '}
                            {reading.value.toFixed(1)}°C
                          </span>
                        </div>
                      ))}
                  </>
                )}
              {chartType === 'humidity' &&
                tooltipData.humidityReadings.length > 0 && (
                  <>
                    <div className="text-sm font-medium">Humidity</div>
                    {tooltipData.humidityReadings
                      .sort((a, b) => b.value - a.value)
                      .map((reading) => (
                        <div
                          key={`tooltip-${chartId}-${reading.deviceId}`}
                          className="flex items-center gap-2"
                        >
                          <div
                            className="w-2 h-2 rounded-full opacity-80"
                            style={{ backgroundColor: reading.color }}
                          />
                          <span className="text-xs">
                            <span className="font-medium">
                              {reading.deviceName}:
                            </span>{' '}
                            {reading.value.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                  </>
                )}
            </div>
          }
          fields={[
            ...(chartType === 'temperature' &&
            tooltipData.tempReadings.length > 0
              ? [
                  {
                    label: 'Min',
                    value: `${Math.min(...tooltipData.tempReadings.map((r) => r.value)).toFixed(1)}°C (${tooltipData.tempReadings.find((r) => r.value === Math.min(...tooltipData.tempReadings.map((r) => r.value)))?.deviceName})`,
                    secondary: true,
                  },
                  {
                    label: 'Max',
                    value: `${Math.max(...tooltipData.tempReadings.map((r) => r.value)).toFixed(1)}°C (${tooltipData.tempReadings.find((r) => r.value === Math.max(...tooltipData.tempReadings.map((r) => r.value)))?.deviceName})`,
                    secondary: true,
                  },
                ]
              : []),
            ...(chartType === 'humidity' &&
            tooltipData.humidityReadings.length > 0
              ? [
                  {
                    label: 'Min',
                    value: `${Math.min(...tooltipData.humidityReadings.map((r) => r.value)).toFixed(0)}% (${tooltipData.humidityReadings.find((r) => r.value === Math.min(...tooltipData.humidityReadings.map((r) => r.value)))?.deviceName})`,
                    secondary: true,
                  },
                  {
                    label: 'Max',
                    value: `${Math.max(...tooltipData.humidityReadings.map((r) => r.value)).toFixed(0)}% (${tooltipData.humidityReadings.find((r) => r.value === Math.max(...tooltipData.humidityReadings.map((r) => r.value)))?.deviceName})`,
                    secondary: true,
                  },
                ]
              : []),
          ]}
          timestamp={tooltipData.time}
          TooltipInPortal={TooltipInPortal}
          tooltipTop={tooltipTop}
          tooltipLeft={tooltipLeft}
          tooltipOpen={tooltipOpen}
          margin={margin}
          offsetTop={-60}
          offsetLeft={-10}
        />
      )}
    </div>
  );
};

export const CombinedSensorsChart = memo(
  CombinedSensorsChartComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height &&
      prevProps.animate === nextProps.animate &&
      prevProps.showTemperature === nextProps.showTemperature &&
      prevProps.showHumidity === nextProps.showHumidity &&
      prevProps.sensorFilter === nextProps.sensorFilter &&
      prevProps.chartType === nextProps.chartType &&
      prevProps.chartId === nextProps.chartId &&
      prevProps.data.length === nextProps.data.length &&
      (prevProps.data.length === 0 ||
        (prevProps.data[0]?.time.getTime() ===
          nextProps.data[0]?.time.getTime() &&
          prevProps.data[prevProps.data.length - 1]?.time.getTime() ===
            nextProps.data[nextProps.data.length - 1]?.time.getTime()))
    );
  },
);

CombinedSensorsChart.displayName = 'CombinedSensorsChart';
