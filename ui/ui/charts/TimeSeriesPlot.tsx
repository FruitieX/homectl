import { useId, useMemo, useState } from 'react';
import { scaleLinear, scaleTime } from '@visx/scale';

export type PlotPoint = {
  time: number;
  value: number;
  low?: number;
  high?: number;
  end?: number;
  fill?: string;
};
export type PlotSeries = {
  name: string;
  points: PlotPoint[];
  className?: string;
  bars?: boolean;
  gapMs?: number;
};
const palette = [
  'text-sky-700 dark:text-sky-300',
  'text-amber-700 dark:text-amber-300',
  'text-violet-700 dark:text-violet-300',
  'text-emerald-700 dark:text-emerald-300',
  'text-rose-700 dark:text-rose-300',
];
const timeLabel = (time: number) =>
  new Date(time).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** Shared plot: actual time spacing, explicit missing-data gaps and optional uncertainty. */
export function TimeSeriesPlot({
  series,
  width,
  height,
  unit,
  label,
  zero = false,
  showNow = false,
  showLegend = true,
  showUnit = true,
}: {
  series: PlotSeries[];
  width: number;
  height: number;
  unit: string;
  label: string;
  zero?: boolean;
  showNow?: boolean;
  showLegend?: boolean;
  showUnit?: boolean;
}) {
  const id = useId();
  const [keyboardInspect, setKeyboardInspect] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const clean = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: [
          ...new Map(
            s.points
              .filter(
                (p) => Number.isFinite(p.time) && Number.isFinite(p.value),
              )
              .sort((a, b) => a.time - b.time)
              .map((point) => [point.time, point]),
          ).values(),
        ],
      })),
    [series],
  );
  const visible = clean.filter((s) => !hidden.includes(s.name));
  const points = visible.flatMap((s) => s.points);
  const times = [...new Set(points.map((p) => p.time))].sort((a, b) => a - b);
  const left = 44,
    right = 12,
    top = 16,
    bottom = 30;
  const svgHeight = Math.max(70, height - (showLegend ? 32 : 0));
  const plotWidth = Math.max(1, width - left - right),
    plotHeight = Math.max(1, svgHeight - top - bottom);
  const minTime = times[0] ?? Date.now();
  const maxTime = Math.max(
    minTime + 60000,
    ...points.map((p) => p.end ?? p.time),
  );
  const dayBands = useMemo(() => {
    if (points.length === 0) return [];
    const first = new Date(minTime);
    first.setHours(0, 0, 0, 0);
    const bands: { start: number; end: number; index: number }[] = [];
    for (let start = first.getTime(), index = 0; start < maxTime; index += 1) {
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 1);
      const end = endDate.getTime();
      bands.push({ start, end, index });
      start = end;
    }
    return bands;
  }, [maxTime, minTime, points.length]);
  const values = points
    .flatMap((p) => [p.value, p.low ?? p.value, p.high ?? p.value])
    .filter(Number.isFinite);
  const low = Math.min(...values, ...(zero ? [0] : []));
  const high = Math.max(...values, ...(zero ? [0] : []));
  const padding = Number.isFinite(high - low)
    ? Math.max((high - low) * 0.12, unit === '%' ? 1 : 0.5)
    : 1;
  const x = scaleTime({
    domain: [new Date(minTime), new Date(maxTime)],
    range: [left, left + plotWidth],
  });
  const y = scaleLinear({
    domain: [
      Number.isFinite(low) ? (zero && low >= 0 ? 0 : low - padding) : 0,
      Number.isFinite(high) ? high + padding : 1,
    ],
    range: [top + plotHeight, top],
    nice: true,
  });
  const selectedIndex =
    active === null || times.length === 0
      ? null
      : Math.max(0, Math.min(active, times.length - 1));
  const selectedTime = selectedIndex === null ? null : times[selectedIndex];
  const selectedBar =
    selectedTime === null
      ? undefined
      : visible
          .filter((series) => series.bars)
          .flatMap((series) => series.points)
          .find(
            (point) =>
              point.time <= selectedTime &&
              (point.end === undefined || point.end > selectedTime),
          );
  const selectedX =
    selectedBar === undefined
      ? selectedTime === null
        ? undefined
        : x(selectedTime)
      : x((selectedBar.time + (selectedBar.end ?? selectedBar.time)) / 2);
  const nearest = (s: (typeof clean)[number]) =>
    selectedTime === null
      ? undefined
      : s.points.find(
          (p) =>
            p.time === selectedTime ||
            (p.end !== undefined &&
              p.time <= selectedTime &&
              p.end > selectedTime),
        );
  const format = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const inspect = (event: React.PointerEvent<SVGSVGElement>) => {
    if (times.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const time = x
      .invert(((event.clientX - box.left) * width) / box.width)
      .getTime();
    let nearestIndex = 0;
    times.forEach((t, i) => {
      if (Math.abs(t - time) < Math.abs(times[nearestIndex] - time))
        nearestIndex = i;
    });
    setActive(nearestIndex);
  };
  return (
    <div
      className="relative min-w-0 overflow-hidden text-foreground"
      style={{ width, height }}
    >
      {showLegend && <div className="flex h-8 min-w-0 items-center gap-3 overflow-x-auto px-3 text-xs">
        {clean.map((s, index) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={!hidden.includes(s.name)}
            className={`flex shrink-0 items-center gap-1.5 rounded px-1 py-1 ${hidden.includes(s.name) ? 'opacity-40' : ''}`}
            onClick={() =>
              setHidden(
                hidden.includes(s.name)
                  ? hidden.filter((name) => name !== s.name)
                  : [...hidden, s.name],
              )
            }
          >
            <span
              className={`${s.className ?? palette[index % palette.length]} inline-block h-0.5 w-3 bg-current`}
            />
            {s.name}
          </button>
        ))}
        {showUnit && <span className="ml-auto shrink-0 text-muted-foreground">{unit}</span>}
      </div>}
      <svg
        width={width}
        height={svgHeight}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, times.length - 1)}
        aria-valuenow={selectedIndex ?? 0}
        aria-valuetext={
          selectedTime === null
            ? 'Use arrow keys to explore readings'
            : `${timeLabel(selectedTime)} ${visible
                .map((s) => {
                  const p = nearest(s);
                  return `${s.name}: ${p ? format(p.value) : 'No reading'} ${unit}`;
                })
                .join(', ')}`
        }
        className={`touch-pan-y outline-none rounded-lg ${keyboardInspect ? 'ring-2 ring-inset ring-ring' : ''}`}
        onBlur={() => {
          setActive(null);
          setKeyboardInspect(false);
        }}
        onPointerDown={(event) => {
          setKeyboardInspect(false);
          if (event.pointerType === 'mouse') event.preventDefault();
          else event.currentTarget.setPointerCapture(event.pointerId);
          inspect(event);
        }}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onLostPointerCapture={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setActive(null);
            setKeyboardInspect(false);
            return;
          }
          if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
            setKeyboardInspect(true);
          if (times.length === 0) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            setActive(
              Math.min(
                times.length - 1,
                Math.max(
                  0,
                  (active ?? 0) + (event.key === 'ArrowRight' ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === 'Home') {
            event.preventDefault();
            setActive(0);
          }
          if (event.key === 'End') {
            event.preventDefault();
            setActive(times.length - 1);
          }
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse' || event.buttons !== 0)
            inspect(event);
        }}
      >
        <defs>
          <clipPath id={id}>
            <rect x={left} y={top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        {y.ticks(4).map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeOpacity={0.65}
            />
            <text
              x={left - 7}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {format(tick)}
            </text>
          </g>
        ))}
        {x.ticks(Math.max(3, Math.floor(plotWidth / 58))).map((tick) => (
          <text
            key={tick.getTime()}
            x={x(tick)}
            y={svgHeight - 9}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {tick.getHours() === 0
              ? tick.toLocaleDateString(undefined, { weekday: 'short' })
              : tick.toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
          </text>
        ))}
        <g clipPath={`url(#${id})`}>
          {dayBands.map((band) => {
            const startX = Math.max(left, x(new Date(band.start)));
            const endX = Math.min(left + plotWidth, x(new Date(band.end)));
            return (
              <g key={band.start}>
                {band.index % 2 === 1 && (
                  <rect
                    x={startX}
                    y={top}
                    width={Math.max(0, endX - startX)}
                    height={plotHeight}
                    className="fill-muted-foreground"
                    opacity={0.035}
                  />
                )}
                {band.index > 0 && startX <= left + plotWidth && (
                  <line
                    x1={startX}
                    x2={startX}
                    y1={top}
                    y2={top + plotHeight}
                    className="stroke-border"
                    strokeDasharray="5 4"
                    opacity={0.8}
                  />
                )}
              </g>
            );
          })}
          {visible.map((s) => {
            const color =
              s.className ?? palette[clean.indexOf(s) % palette.length];
            if (s.bars)
              return (
                <g key={s.name} className={color}>
                  {s.points.map((p) => {
                    const barX = x(p.time),
                      w = Math.max(1, x(p.end ?? p.time + 3600000) - barX - 2);
                    return (
                      <g key={p.time}>
                        {p.high !== undefined && (
                          <rect
                            x={barX + 1}
                            y={y(p.high)}
                            width={w}
                            height={Math.max(
                              0,
                              y(Math.min(0, p.value)) - y(p.high),
                            )}
                            fill={p.fill ?? 'currentColor'}
                            opacity={0.2}
                          />
                        )}
                        <rect
                          x={barX + 1}
                          y={Math.min(y(p.value), y(0))}
                          width={w}
                          height={Math.max(1, Math.abs(y(p.value) - y(0)))}
                          fill={p.fill ?? 'currentColor'}
                          opacity={0.8}
                          rx={1.5}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            const segments: PlotPoint[][] = [];
            for (const p of s.points) {
              const last = segments.at(-1);
              if (!last || p.time - last.at(-1)!.time > (s.gapMs ?? Infinity))
                segments.push([p]);
              else last.push(p);
            }
            return (
              <g key={s.name} className={color}>
                {segments.map((segment, i) => (
                  <g key={i}>
                    {segment.every(
                      (p) => p.low !== undefined && p.high !== undefined,
                    ) && (
                      <path
                        d={`M${segment.map((p) => `${x(p.time)},${y(p.high!)}`).join(' L')} L${[
                          ...segment,
                        ]
                          .reverse()
                          .map((p) => `${x(p.time)},${y(p.low!)}`)
                          .join(' L')} Z`}
                        fill="currentColor"
                        opacity={0.12}
                      />
                    )}
                    <path
                      d={`M${segment.map((p) => `${x(p.time)},${y(p.value)}`).join(' L')}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                    {segment.length === 1 && (
                      <circle
                        cx={x(segment[0].time)}
                        cy={y(segment[0].value)}
                        r={3}
                        fill="currentColor"
                      />
                    )}
                  </g>
                ))}
              </g>
            );
          })}
          {showNow && Date.now() >= minTime && Date.now() <= maxTime && (
            <line
              x1={x(Date.now())}
              x2={x(Date.now())}
              y1={top}
              y2={top + plotHeight}
              className="stroke-foreground"
              strokeDasharray="3 4"
              opacity={0.55}
            />
          )}
          {selectedX !== undefined && (
            <line
              x1={selectedX}
              x2={selectedX}
              y1={top}
              y2={top + plotHeight}
              className="stroke-foreground"
              opacity={0.5}
            />
          )}
        </g>
        {points.length === 0 && (
          <text
            x={width / 2}
            y={svgHeight / 2}
            textAnchor="middle"
            className="fill-muted-foreground text-sm"
          >
            No readings available
          </text>
        )}
      </svg>
      {selectedTime !== null && (
        <div
          className={`pointer-events-none absolute inset-x-3 ${showLegend ? 'top-9' : 'top-1'} min-w-0 rounded-lg bg-popover/95 px-2 py-1.5 text-xs text-popover-foreground shadow-sm break-words whitespace-normal`}
          aria-live="polite"
        >
          {selectedTime !== null ? (
            <>
              <span className="mr-3">{timeLabel(selectedTime)}</span>
              {visible.map((s) => {
                const p = nearest(s);
                return (
                  <span className="mr-3 text-foreground" key={s.name}>
                    {s.name}:{' '}
                    {p
                      ? `${format(p.value)} ${unit}${p.high !== undefined ? ` · ${s.bars ? 'possible' : 'range'} ${p.low !== undefined && !s.bars ? `${format(p.low)}–` : ''}${format(p.high)} ${unit}` : ''}${p.end !== undefined && s.bars && unit.includes('period') ? ` over ${(p.end - p.time) / 3600000} h` : ''}`
                      : '—'}
                  </span>
                );
              })}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
