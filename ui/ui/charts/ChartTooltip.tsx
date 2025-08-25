import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  memo,
} from 'react';
import { defaultStyles } from '@visx/tooltip';

export interface TooltipField {
  label: string;
  value: string | number;
  color?: string;
  secondary?: boolean;
}

export interface ChartTooltipProps {
  title: string | React.ReactNode;
  fields: TooltipField[];
  timestamp?: Date;
  TooltipInPortal: any;
  tooltipTop?: number;
  tooltipLeft?: number;
  tooltipOpen: boolean;
  margin: { top: number; right: number; bottom: number; left: number };
  isInModal?: boolean;
  offsetTop?: number;
  offsetLeft?: number;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = memo(
  ({
    title,
    fields,
    timestamp,
    TooltipInPortal,
    tooltipTop,
    tooltipLeft,
    tooltipOpen,
    margin,
    isInModal = false,
    offsetTop = 0,
    offsetLeft = 0,
  }) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [tooltipSize, setTooltipSize] = useState({ width: 140, height: 80 });

    useLayoutEffect(() => {
      if (tooltipRef.current) {
        const rect = tooltipRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        setTooltipSize({ width: rect.width, height: rect.height });
      }
    }, [tooltipOpen, fields, title]);

    // Calculate dynamic offsets based on tooltip size
    const dynamicOffsetLeft = -tooltipSize.width / 2; // Center horizontally
    const dynamicOffsetTop = -tooltipSize.height - 10; // Position above with 10px gap
    if (!tooltipOpen || tooltipTop === undefined || tooltipLeft === undefined) {
      return null;
    }

    return (
      <TooltipInPortal
        top={tooltipTop}
        left={tooltipLeft}
        offsetTop={dynamicOffsetTop + offsetTop}
        offsetLeft={dynamicOffsetLeft + offsetLeft}
        applyPositionStyle
        style={{
          ...defaultStyles,
          background: 'rgba(0, 0, 0, 0.9)',
          border: '1px solid #374151',
          borderRadius: '8px',
          color: '#f9fafb',
          fontSize: '12px',
          padding: '8px 12px',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
          maxWidth: 'min(200px, calc(100vw - 32px))',
          minWidth: '120px',
          zIndex: 10000,
          position: 'fixed',
          boxSizing: 'border-box',
          overflow: 'hidden',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        <div
          ref={tooltipRef}
          className="flex flex-col gap-1"
          style={{
            maxWidth: '100%',
            overflow: 'hidden',
            wordWrap: 'break-word',
          }}
        >
          <div className="font-semibold text-white">{title}</div>

          {fields.map((field, index) => (
            <div
              key={index}
              className={`text-xs ${
                field.secondary ? 'text-gray-300' : 'text-gray-200'
              }`}
              style={field.color ? { color: field.color } : undefined}
            >
              {field.label}: {field.value}
            </div>
          ))}

          {timestamp && (
            <div className="text-xs text-gray-400 mt-1 pt-1 border-t border-gray-600">
              {timestamp.toLocaleString('en-FI', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </div>
          )}
        </div>
      </TooltipInPortal>
    );
  },
);

ChartTooltip.displayName = 'ChartTooltip';
