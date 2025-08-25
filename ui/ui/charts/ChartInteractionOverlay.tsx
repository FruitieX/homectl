import React, { memo } from 'react';
import { TooltipPosition } from './hooks/useChartTooltip';

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
  handleTouch,
  hideTooltip,
}: ChartInteractionOverlayProps<T>): React.ReactElement => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  return (
    <g>
      {/* Main interaction area - positioned over the chart content */}
      <rect
        x={0}
        y={0}
        width={innerWidth}
        height={innerHeight}
        fill="transparent"
        onMouseMove={(event) =>
          handleMouseMove(event, findDataPoint, getDataPointPosition)
        }
        onMouseLeave={hideTooltip}
        onTouchStart={(event) =>
          handleTouch(event, findDataPoint, getDataPointPosition)
        }
        onTouchMove={(event) =>
          handleTouch(event, findDataPoint, getDataPointPosition)
        }
        onTouchEnd={hideTooltip}
        onTouchCancel={hideTooltip}
        style={{ cursor: 'pointer' }}
      />
    </g>
  );
};
