import type { SourcePreviewSample } from '@/bindings/SourcePreviewSample';
import type { SourceComputeConfig } from '@/hooks/useConfig';
import { useSourcePreview } from '@/hooks/useConfig';
import { deviceColorPreview } from '@/lib/deviceColorPreview';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { ConfigHelpPanel } from '@/ui/config-form';
import { Skeleton } from '@/ui/primitives/skeleton';
import { useEffect, useState } from 'react';

const SAMPLES_OPTIONS = [24, 48, 96];

const CHART_WIDTH = 960;
const CHART_HEIGHT = 220;
const CHART_PADDING_X = 16;
const CHART_PADDING_Y = 16;

function sampleBrightness(sample: SourcePreviewSample) {
  return typeof sample.profile.brightness === 'number'
    ? sample.profile.brightness
    : null;
}

function brightnessPath(samples: SourcePreviewSample[]) {
  const points: Array<[number, number]> = [];
  const plotWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;
  samples.forEach((sample, index) => {
    const brightness = sampleBrightness(sample);
    if (brightness === null) {
      return;
    }
    const x =
      CHART_PADDING_X +
      (samples.length <= 1 ? 0 : (index / (samples.length - 1)) * plotWidth);
    const y = CHART_PADDING_Y + (1 - Math.min(1, Math.max(0, brightness))) * plotHeight;
    points.push([x, y]);
  });
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function hourTicks(samples: SourcePreviewSample[]) {
  const ticks: Array<{ x: number; label: string }> = [];
  const plotWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const seen = new Set<string>();
  samples.forEach((sample, index) => {
    const [hour] = sample.local_time.split(':');
    const hourNumber = Number(hour);
    if (
      Number.isFinite(hourNumber) &&
      hourNumber % 6 === 0 &&
      !seen.has(sample.local_time)
    ) {
      seen.add(sample.local_time);
      ticks.push({
        x:
          CHART_PADDING_X +
          (samples.length <= 1
            ? 0
            : (index / (samples.length - 1)) * plotWidth),
        label: sample.local_time,
      });
    }
  });
  return ticks;
}

function SourcePreviewChart({ samples }: { samples: SourcePreviewSample[] }) {
  const path = brightnessPath(samples);
  const ticks = hourTicks(samples);
  const hasBrightness = path.length > 0;

  return (
    <div className="space-y-2">
      <svg
        className="w-full rounded-2xl border border-border bg-muted/20"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Light profile preview"
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={CHART_PADDING_X}
            x2={CHART_WIDTH - CHART_PADDING_X}
            y1={CHART_PADDING_Y + fraction * (CHART_HEIGHT - CHART_PADDING_Y * 2)}
            y2={CHART_PADDING_Y + fraction * (CHART_HEIGHT - CHART_PADDING_Y * 2)}
            stroke="currentColor"
            strokeDasharray="4 6"
            className="text-border"
            strokeWidth={1}
          />
        ))}
        {hasBrightness ? (
          <polyline
            fill="none"
            points={path}
            stroke="currentColor"
            className="text-primary"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <text
            x={CHART_WIDTH / 2}
            y={CHART_HEIGHT / 2}
            textAnchor="middle"
            className="fill-muted-foreground text-sm"
          >
            This profile has no brightness values
          </text>
        )}
        {ticks.map((tick) => (
          <text
            key={tick.label}
            x={tick.x}
            y={CHART_HEIGHT - 2}
            textAnchor="middle"
            className="fill-muted-foreground text-xs"
          >
            {tick.label}
          </text>
        ))}
      </svg>
      <div className="flex overflow-hidden rounded-lg border border-border">
        {samples.map((sample, index) => (
          <div
            key={`${sample.time_ms}-${index}`}
            className="h-6 flex-1"
            style={{ backgroundColor: deviceColorPreview(sample.profile.color) }}
            title={`${sample.local_time} · ${
              sample.profile.color
                ? JSON.stringify(sample.profile.color)
                : 'no color'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        One local day ({samples.length} samples,{' '}
        {Math.round(1440 / Math.max(1, samples.length))} minute steps) in the
        source timezone.
      </p>
    </div>
  );
}

export function SourcePreviewPanel({
  timezone,
  compute,
}: {
  timezone: string;
  compute: SourceComputeConfig;
}) {
  const { preview, data, loading, error } = useSourcePreview();
  const [samples, setSamples] = useState(48);

  const runPreview = (sampleCount: number) => {
    void preview({ timezone, compute, samples: sampleCount });
  };

  useEffect(() => {
    runPreview(samples);
    // Preview runs on tab open and on demand; the draft is passed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 pt-4">
      <ConfigHelpPanel>
        <p>
          Previews are computed server-side through the same pure evaluation
          path the runtime uses, and nothing is saved. Custom script bodies run
          in the worker and cannot be previewed synchronously.
        </p>
      </ConfigHelpPanel>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={samples}
          onChange={(event) => setSamples(Number(event.target.value))}
        >
          {SAMPLES_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} samples
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => runPreview(samples)}
        >
          {loading ? 'Previewing…' : 'Refresh preview'}
        </Button>
        {data ? (
          <span className="text-xs text-muted-foreground">
            {data.timezone}
            {data.note ? ` · ${data.note}` : ''}
          </span>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !data ? <Skeleton className="h-56 w-full" /> : null}
      {data?.unsupported_reason ? (
        <Alert>
          <AlertDescription>{data.unsupported_reason}</AlertDescription>
        </Alert>
      ) : null}
      {data && !data.unsupported_reason && data.samples.length > 0 ? (
        <SourcePreviewChart samples={data.samples} />
      ) : null}
    </div>
  );
}
