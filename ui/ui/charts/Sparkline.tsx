import { useMemo } from 'react';

import { enforceMinimumSpan } from './axisSpan';

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;
const MAX_POINTS = 48;

const downsample = <T,>(points: T[], maxPoints: number): T[] => {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from(
    { length: maxPoints },
    (_, i) => points[Math.round(i * step)],
  );
};

export function Sparkline({
  points,
  minSpan = 0,
  className,
}: {
  points: Array<{ time: Date; value: number }>;
  /** Floor for the drawn range, so a flat series does not look dramatic. */
  minSpan?: number;
  className?: string;
}) {
  const path = useMemo(() => {
    const data = downsample(points, MAX_POINTS);
    if (data.length < 2) return null;
    const values = data.map((point) => point.value);
    const [min, max] = enforceMinimumSpan(
      Math.min(...values),
      Math.max(...values),
      minSpan,
    );
    const range = max - min || 1;
    const step = VIEW_WIDTH / (data.length - 1);
    const coords = data.map((point, index) => {
      const x = index * step;
      const y =
        VIEW_HEIGHT - 2 - ((point.value - min) / range) * (VIEW_HEIGHT - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      line: `M${coords.join(' L')}`,
      area: `M${coords.join(' L')} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`,
    };
  }, [minSpan, points]);

  if (!path) return null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={path.area} fill="currentColor" opacity={0.12} />
      <path
        d={path.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
