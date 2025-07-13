import React from 'react';
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
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({
  title,
  fields,
  timestamp,
  TooltipInPortal,
  tooltipTop,
  tooltipLeft,
  tooltipOpen,
  margin,
  isInModal = false,
}) => {
  if (!tooltipOpen || tooltipTop === undefined || tooltipLeft === undefined) {
    return null;
  }

  return (
    <TooltipInPortal
      top={tooltipTop + margin.top}
      left={tooltipLeft + margin.left}
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
        maxWidth: '200px',
        minWidth: '120px',
        zIndex: 10000,
      }}
    >
      <div className="flex flex-col gap-1">
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
};
