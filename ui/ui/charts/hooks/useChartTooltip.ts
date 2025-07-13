import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { debounce } from 'lodash';

export interface TooltipConfig {
  zIndex?: number;
  debounce?: number;
  detectBounds?: boolean;
  scroll?: boolean;
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
  ) => void;
  handleTouch: (
    event: React.TouchEvent,
    findDataPoint: (position: TooltipPosition) => T | undefined,
  ) => void;
  TooltipInPortal: any;
  containerRef: any;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

const defaultConfig: TooltipConfig = {
  zIndex: 10000,
  debounce: 100,
  detectBounds: true,
  scroll: true,
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

  const { containerRef, TooltipInPortal, forceRefreshBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
    zIndex: finalConfig.zIndex,
    debounce: finalConfig.debounce,
  });
  
  const debouncedForceRefreshBounds = useCallback(
    debounce(forceRefreshBounds, finalConfig.debounce, { leading: true }),
    [forceRefreshBounds, finalConfig.debounce]
  );

  const svgRef = useRef<SVGSVGElement>(null);

  const calculateTooltipPosition = useCallback(
    (clientX: number, clientY: number, svgX: number, svgY: number) => {
      const tooltipHeight = 80;

      let tooltipTop = svgY - tooltipHeight - 60;
      let tooltipLeft = svgX - 120;

      // If would go above viewport, position below cursor
      if (clientY < tooltipHeight + 20) {
        tooltipTop = svgY + 20;
      }

      return { tooltipTop, tooltipLeft };
    },
    [],
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

      // Simple positioning using raw SVG coordinates
      const { tooltipTop, tooltipLeft } = calculateTooltipPosition(
        clientX,
        clientY,
        point.x,
        point.y,
      );

      originalShowTooltip({
        tooltipData: dataPoint,
        tooltipLeft,
        tooltipTop,
      });
    },
    [originalShowTooltip, calculateTooltipPosition, margin.left, margin.top, debouncedForceRefreshBounds],
  );

  const handleTouch = useCallback(
    (
      event: React.TouchEvent,
      findDataPoint: (position: TooltipPosition) => T | undefined,
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

      // Simple positioning using raw SVG coordinates
      const { tooltipTop, tooltipLeft } = calculateTooltipPosition(
        touch.clientX,
        touch.clientY,
        x,
        y,
      );

      originalShowTooltip({
        tooltipData: dataPoint,
        tooltipLeft,
        tooltipTop,
      });
    },
    [originalShowTooltip, calculateTooltipPosition, margin.left, margin.top, debouncedForceRefreshBounds],
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
