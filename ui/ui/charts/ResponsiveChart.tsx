import React, { memo } from 'react';
import { ParentSize } from '@visx/responsive';

interface ResponsiveChartProps {
  children: (dimensions: { width: number; height: number }) => React.ReactNode;
  height?: number;
  className?: string;
}

export const ResponsiveChart: React.FC<ResponsiveChartProps> = memo(
  ({ children, height = 300, className = '' }) => {
    return (
      <div className={`w-full ${className}`} style={{ height }}>
        <ParentSize>
          {({ width, height: parentHeight }) => {
            if (width < 10 || parentHeight < 10) return null;
            return children({ width, height: parentHeight });
          }}
        </ParentSize>
      </div>
    );
  },
);

ResponsiveChart.displayName = 'ResponsiveChart';
