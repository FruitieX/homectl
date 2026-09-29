import type { SourcePreviewSample } from '@/bindings/SourcePreviewSample';
import type { SourceComputeConfig } from '@/hooks/useConfig';
import { useSourcePreview } from '@/hooks/useConfig';
import { deviceColorPreview } from '@/lib/deviceColorPreview';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { ConfigHelpPanel } from '@/ui/config-form';
import { Skeleton } from '@/ui/primitives/skeleton';
import { useState } from 'react';
import { StatePreview } from '@/ui/settings/StatePreview';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';

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
    const y =
      CHART_PADDING_Y + (1 - Math.min(1, Math.max(0, brightness))) * plotHeight;
    points.push([x, y]);
  });
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function hourTicks(samples: SourcePreviewSample[]) {
  const ticks: Array<{ x: number; label: string }> = [];
  const plotWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const seen = new Set<number>();
  samples.forEach((sample, index) => {
    const [hour] = sample.local_time.split(':');
    const hourNumber = Number(hour);
    if (
      Number.isFinite(hourNumber) &&
      hourNumber % 6 === 0 &&
      !seen.has(hourNumber)
    ) {
      seen.add(hourNumber);
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
      <div className="relative pb-5">
        <svg
          className="h-36 min-h-[144px] w-full rounded-2xl border border-border bg-muted/20 sm:h-56"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Light profile preview"
        >
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={CHART_PADDING_X}
              x2={CHART_WIDTH - CHART_PADDING_X}
              y1={
                CHART_PADDING_Y +
                fraction * (CHART_HEIGHT - CHART_PADDING_Y * 2)
              }
              y2={
                CHART_PADDING_Y +
                fraction * (CHART_HEIGHT - CHART_PADDING_Y * 2)
              }
              stroke="currentColor"
              strokeDasharray="4 6"
              className="text-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hasBrightness && (
            <polyline
              fill="none"
              points={path}
              stroke="currentColor"
              className="text-primary"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
        {!hasBrightness && (
          <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
            This profile has no brightness values
          </p>
        )}
        {ticks.map((tick) => (
          <span
            key={tick.label}
            style={{
              left: `clamp(1.25rem, ${(tick.x / CHART_WIDTH) * 100}%, calc(100% - 1.25rem))`,
            }}
            className="absolute bottom-0 -translate-x-1/2 text-[12px] text-muted-foreground"
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div className="flex overflow-hidden rounded-lg border border-border">
        {samples.map((sample, index) => (
          <div
            key={`${sample.time_ms}-${index}`}
            className="h-6 flex-1"
            style={{
              backgroundColor: deviceColorPreview(sample.profile.color),
            }}
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
  blockedReason,
}: {
  timezone: string;
  compute: SourceComputeConfig;
  blockedReason?: string;
}) {
  const { preview, data, loading, error } = useSourcePreview();
  const [samples, setSamples] = useState(48);
  const [requested, setRequested] = useState('');
  const current = JSON.stringify({ timezone, compute, samples });
  const stale = requested !== current || Boolean(blockedReason);

  const runPreview = (sampleCount: number) => {
    setRequested(JSON.stringify({ timezone, compute, samples: sampleCount }));
    void preview({ timezone, compute, samples: sampleCount });
  };

  return (
    <div className="space-y-4 pt-4">
      <ConfigHelpPanel>
        <p>
          Preview one day using this draft’s timezone and profile. Custom
          scripts report when this preview is unavailable.
        </p>
      </ConfigHelpPanel>
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSelect
          aria-label="Preview sample count"
          className="w-auto"
          value={String(samples)}
          onValueChange={(next) => setSamples(Number(next))}
          options={SAMPLES_OPTIONS.map((option) => ({
            value: String(option),
            label: `${option} samples`,
          }))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || Boolean(blockedReason)}
          onClick={() => runPreview(samples)}
        >
          {loading
            ? 'Previewing…'
            : requested
              ? 'Refresh preview'
              : 'Preview draft'}
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
      {blockedReason && (
        <p role="alert" className="text-sm text-destructive">
          {blockedReason}
        </p>
      )}
      {data && stale && (
        <p role="status" className="text-sm text-amber-700">
          Draft changed. These results are from the previous inputs; refresh the
          preview.
        </p>
      )}
      {loading && !data ? <Skeleton className="h-56 w-full" /> : null}
      {data?.unsupported_reason ? (
        <Alert>
          <AlertDescription>{data.unsupported_reason}</AlertDescription>
        </Alert>
      ) : null}
      {data && !data.unsupported_reason && data.samples.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          The preview returned no samples.
        </p>
      )}
      {data && !data.unsupported_reason && data.samples.length > 0 ? (
        <div className={stale ? 'opacity-60' : undefined}>
          <SourcePreviewChart samples={data.samples} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.samples
              .filter(
                (_, index) =>
                  index % Math.max(1, Math.ceil(data.samples.length / 8)) === 0,
              )
              .map((sample) => (
                <div
                  key={String(sample.time_ms)}
                  className="flex items-center gap-2 text-xs"
                >
                  <StatePreview
                    color={sample.profile.color}
                    brightness={sample.profile.brightness}
                  />
                  <span>
                    {sample.local_time}
                    <br />
                    {sample.profile.brightness == null
                      ? 'Brightness unspecified'
                      : `${Math.round(sample.profile.brightness * 100)}%`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
