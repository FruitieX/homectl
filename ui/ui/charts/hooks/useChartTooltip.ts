import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { debounce } from 'lodash';

export interface TooltipConfig {
  zIndex?: number;
  debounce?: number;
}

export interface TooltipPosition {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

export interface UseChartTooltipProps<T> {
  data: T[];
  margin: { top: number; right: number; bottom: number; left: number };
  config?: TooltipConfig;
}

export interface UseChartTooltipReturn<T> {
  tooltipData: T | undefined;
  tooltipLeft: number | undefined;
  tooltipTop: number | undefined;
  tooltipOpen: boolean;
  hideTooltip: () => void;
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
  TooltipInPortal: any;
  containerRef: any;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

const defaultConfig: TooltipConfig = {
  zIndex: 10000,
  debounce: 100,
};

export function useChartTooltip<T>({
  data,
  margin,
  config = {},
}: UseChartTooltipProps<T>): UseChartTooltipReturn<T> {
  const finalConfig = { ...defaultConfig, ...config };

  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip: originalShowTooltip,
    hideTooltip: originalHideTooltip,
  } = useTooltip<T>();

  const { containerRef, containerBounds, TooltipInPortal, forceRefreshBounds } =
    useTooltipInPortal({
      scroll: true,
      detectBounds: true,
      zIndex: finalConfig.zIndex,
      debounce: finalConfig.debounce,
    });

  const debouncedForceRefreshBounds = useCallback(
    debounce(forceRefreshBounds, finalConfig.debounce, { leading: true }),
    [forceRefreshBounds, finalConfig.debounce],
  );

  const svgRef = useRef<SVGSVGElement>(null);

  const calculateTooltipPosition = useCallback(
    (dataPointX: number, dataPointY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();

      if (!rect) return { tooltipTop: 0, tooltipLeft: 0 };

      // Calculate screen coordinates relative to the page
      const tooltipLeft = margin.left + dataPointX;
      const tooltipTop = margin.top + dataPointY;

      return { tooltipTop, tooltipLeft };
    },
    [containerBounds, margin],
  );

  const hideTooltip = useCallback(() => {
    originalHideTooltip();
  }, [originalHideTooltip]);

  // Cleanup effect to hide tooltip on unmount
  useEffect(() => {
    return () => {
      originalHideTooltip();
    };
  }, [originalHideTooltip]);

  const handleMouseMove = useCallback(
    (
      event: React.MouseEvent | React.TouchEvent,
      findDataPoint: (position: TooltipPosition) => T | undefined,
      getDataPointPosition?: (data: T) => { x: number; y: number },
    ) => {
      debouncedForceRefreshBounds();

      const point = localPoint(event);
      if (!point) return;

      const clientX =
        'clientX' in event ? event.clientX : event.touches[0]?.clientX || 0;
      const clientY =
        'clientY' in event ? event.clientY : event.touches[0]?.clientY || 0;

      // Chart coordinates for finding data point
      const position: TooltipPosition = {
        x: point.x - margin.left,
        y: point.y - margin.top,
        clientX,
        clientY,
      };

      const dataPoint = findDataPoint(position);
      if (!dataPoint) return;

      // Get data point position if available, otherwise use cursor position
      let dataPointX = position.x;
      let dataPointY = position.y;

      if (getDataPointPosition) {
        const dataPos = getDataPointPosition(dataPoint);
        dataPointX = dataPos.x;
        dataPointY = dataPos.y;
      }

      const { tooltipTop, tooltipLeft } = calculateTooltipPosition(
        dataPointX,
        dataPointY,
      );

      originalShowTooltip({
        tooltipData: dataPoint,
        tooltipLeft,
        tooltipTop,
      });
    },
    [
      originalShowTooltip,
      calculateTooltipPosition,
      margin.left,
      margin.top,
      debouncedForceRefreshBounds,
    ],
  );

  const handleTouch = useCallback(
    (
      event: React.TouchEvent,
      findDataPoint: (position: TooltipPosition) => T | undefined,
      getDataPointPosition?: (data: T) => { x: number; y: number },
    ) => {
      debouncedForceRefreshBounds();

      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const touch = event.touches[0];
      if (!touch) return;

      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Chart coordinates for finding data point
      const position: TooltipPosition = {
        x: x - margin.left,
        y: y - margin.top,
        clientX: touch.clientX,
        clientY: touch.clientY,
      };

      const dataPoint = findDataPoint(position);
      if (!dataPoint) return;

      // Get data point position if available, otherwise use touch position
      let dataPointX = x - margin.left;
      let dataPointY = y - margin.top;

      if (getDataPointPosition) {
        const dataPos = getDataPointPosition(dataPoint);
        dataPointX = dataPos.x;
        dataPointY = dataPos.y;
      }

      const { tooltipTop, tooltipLeft } = calculateTooltipPosition(
        dataPointX,
        dataPointY,
      );

      originalShowTooltip({
        tooltipData: dataPoint,
        tooltipLeft,
        tooltipTop,
      });
    },
    [
      originalShowTooltip,
      calculateTooltipPosition,
      margin.left,
      margin.top,
      debouncedForceRefreshBounds,
    ],
  );

  return {
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
  };
}
