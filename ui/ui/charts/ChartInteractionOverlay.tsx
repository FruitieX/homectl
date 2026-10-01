import React, { memo } from 'react';
import { TooltipPosition } from './hooks/useChartTooltip';
import { useChartInteraction } from './hooks/useChartInteraction';

export interface ChartInteractionOverlayProps<T> {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  data: T[];
  findDataPoint: (position: TooltipPosition) => T | undefined;
  getDataPointPosition?: (data: T) => { x: number; y: number };
  handleMouseMove: (
    event: React.MouseEvent | React.TouchEvent,
    findDataPoint: (position: TooltipPosition) => T | undefined,
    getDataPointPosition?: (data: T) => { x: number; y: number },
  ) => void;
  handleTouch: (
    event: React.TouchEvent,
    findDataPoint: (position: TooltipPosition) => T | undefined,
    getDataPointPosition?: (data: T) => { x: number; y: number },
  ) => void;
  hideTooltip: () => void;
}

export const ChartInteractionOverlay = <T,>({
  width,
  height,
  margin,
  data,
  findDataPoint,
  getDataPointPosition,
  handleMouseMove,
  hideTooltip,
}: ChartInteractionOverlayProps<T>): React.ReactElement => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const interaction = useChartInteraction<SVGRectElement>({
    inspect: (event) =>
      handleMouseMove(event, findDataPoint, getDataPointPosition),
    clear: hideTooltip,
  });

  return (
    <g>
      {/* Main interaction area - positioned over the chart content */}
      <rect
        x={0}
        y={0}
        width={innerWidth}
        height={innerHeight}
        fill="transparent"
        {...interaction}
        style={{ cursor: 'pointer', touchAction: 'pan-y' }}
      />
    </g>
  );
};
