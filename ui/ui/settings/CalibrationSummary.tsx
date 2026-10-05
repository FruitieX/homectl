import { Link } from 'react-router-dom';
import { Palette, SunMedium } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ColorCalibrationPoint } from '@/bindings/ColorCalibrationPoint';
import type { BrightnessCalibrationPoint } from '@/bindings/BrightnessCalibrationPoint';
import type { Device } from '@/bindings/Device';
import { useCalibrationActions } from '@/hooks/useCalibrationActions';
import {
  NO_PROFILE,
  lightCalibration,
  profileChannelSummary,
} from '@/lib/calibrationProfiles';
import { canCalibrateDevice, uvToHs } from '@/lib/colorCalibration';
import {
  isDimmableDevice,
  sortBrightnessPoints,
} from '@/lib/brightnessCalibration';
import { configItemHref } from '@/lib/configItemHref';
import { getDeviceKey } from '@/lib/device';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { StatePreview } from './StatePreview';
import { SettingsSelect } from './SettingsSelect';
import { CalibrationCatalogStatus } from './CalibrationCatalogStatus';

/** Small logical → output plot; the dashed diagonal is "unchanged". */
export function BrightnessCurvePreview({
  points,
  className,
}: {
  points: BrightnessCalibrationPoint[];
  className?: string;
}) {
  const sorted = sortBrightnessPoints(points);
  const path = [
    { logical: 0, output: 0 },
    ...sorted,
    ...(sorted.at(-1)?.logical === 1 ? [] : [{ logical: 1, output: 1 }]),
  ]
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${(point.logical * 40).toFixed(1)} ${(40 - point.output * 40).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="-2 -2 44 44"
      className={cn('size-10 shrink-0 text-primary', className)}
      role="img"
      aria-label={`Brightness curve: ${sorted.map((point) => `${Math.round(point.logical * 100)}% → ${Math.round(point.output * 100)}%`).join(', ')}`}
    >
      <rect
        x="0"
        y="0"
        width="40"
        height="40"
        rx="4"
        className="fill-muted stroke-border"
      />
      <path
        d="M0 40 L40 0"
        className="stroke-muted-foreground/40"
        strokeDasharray="2 2"
      />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Reference → matched output swatches, at most `limit` of them. */
export function ColorPointsPreview({
  points,
  limit = 6,
}: {
  points: ColorCalibrationPoint[];
  limit?: number;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1" aria-hidden>
      {points.slice(0, limit).map((point, index) => (
        <span
          key={index}
          className="inline-flex items-center rounded-full border border-border bg-background p-0.5"
        >
          <StatePreview power color={uvToHs(point.reference)} size={14} />
          <StatePreview power color={uvToHs(point.output)} size={14} />
        </span>
      ))}
      {points.length > limit && (
        <span className="text-xs text-muted-foreground">
          +{points.length - limit}
        </span>
      )}
    </span>
  );
}

function ChannelRow({
  icon,
  title,
  status,
  preview,
  action,
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  preview?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-xs text-muted-foreground">{status}</div>
      </div>
      {preview}
      {action}
    </div>
  );
}

/**
 * What calibration a light uses, at a glance: its one profile, what each
 * channel does, who else shares it, and how to change any of it.
 */
export function LightCalibrationSummary({
  device,
  devices,
  labelFor,
  onCalibrate,
}: {
  device: Device;
  devices: Device[];
  labelFor: (key: string) => string;
  onCalibrate: (channel: 'color' | 'brightness') => void;
}) {
  const { editor, busy, run } = useCalibrationActions();
  const deviceKey = getDeviceKey(device);
  const view = editor.data;
  if (!view) return <CalibrationCatalogStatus query={editor} />;
  const light = lightCalibration(view, deviceKey);
  const color = canCalibrateDevice(device);
  const dimmable = isDimmableDevice(device);
  const referenceKey = light.profile?.reference_device_key;
  const reference = referenceKey
    ? devices.find((row) => getDeviceKey(row) === referenceKey)
    : undefined;
  const compatible = view.profiles.filter(
    (profile) =>
      (!profile.points.length || color) &&
      (!profile.brightness_points.length || dimmable),
  );
  const assign = (selected: string) => {
    const profileId = selected === NO_PROFILE ? '' : selected;
    const profile = view.profiles.find((row) => row.id === profileId);
    void run(
      () => [{ profile_id: profileId || null, device_keys: [deviceKey] }],
      profile
        ? `${labelFor(deviceKey)} now uses ${profile.name}`
        : `Calibration removed from ${labelFor(deviceKey)}`,
      (before) => {
        const previous = lightCalibration(before, deviceKey).profile;
        return [{ profile_id: previous?.id ?? null, device_keys: [deviceKey] }];
      },
    );
  };
  return (
    <div className="space-y-3">
      <CalibrationCatalogStatus query={editor} />
      <div className="rounded-lg border border-border">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
          <div className="min-w-48 flex-1">
            <p className="text-xs text-muted-foreground">Calibration profile</p>
            <p className="font-medium">
              {light.profile?.name ??
                (light.kind === 'legacy'
                  ? 'Older per-light calibration'
                  : 'Not calibrated')}
            </p>
            <p className="text-xs text-muted-foreground">
              {light.kind === 'none' ? (
                'Commands are sent unchanged.'
              ) : light.sharedWith.length ? (
                <>
                  Shared with{' '}
                  {light.sharedWith.slice(0, 3).map((key, index) => (
                    <span key={key}>
                      {index > 0 && ', '}
                      <Link
                        className="underline underline-offset-2"
                        to={configItemHref('device', key)}
                      >
                        {labelFor(key)}
                      </Link>
                    </span>
                  ))}
                  {light.sharedWith.length > 3 &&
                    ` and ${light.sharedWith.length - 3} more`}
                  . Changes to it affect all of them.
                </>
              ) : (
                'Used only by this light.'
              )}
            </p>
          </div>
          <label className="grid min-w-56 gap-1 text-xs text-muted-foreground">
            Use profile
            <SettingsSelect
              aria-label="Calibration profile for this light"
              value={light.profile?.id ?? NO_PROFILE}
              disabled={busy}
              onValueChange={assign}
              options={[
                { value: NO_PROFILE, label: 'No calibration' },
                ...compatible.map((profile) => ({
                  value: profile.id,
                  label: `${profile.name} · ${profileChannelSummary(profile)}`,
                })),
              ]}
            />
          </label>
        </div>
        <div className="divide-y divide-border px-3">
          {(color || light.points.length > 0) && (
            <ChannelRow
              icon={<Palette className="size-4" />}
              title="Color"
              status={
                light.points.length ? (
                  <>
                    {light.points.length} matched point
                    {light.points.length === 1 ? '' : 's'}
                    {referenceKey && (
                      <>
                        {' '}
                        · matched to{' '}
                        <Link
                          className="underline underline-offset-2"
                          to={configItemHref('device', referenceKey)}
                        >
                          {reference ? labelFor(referenceKey) : referenceKey}
                        </Link>
                      </>
                    )}
                  </>
                ) : (
                  'Not calibrated · colors are sent as chosen'
                )
              }
              preview={
                light.points.length > 0 && (
                  <ColorPointsPreview points={light.points} />
                )
              }
              action={
                color && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCalibrate('color')}
                  >
                    {light.points.length ? 'Adjust color' : 'Calibrate color'}
                  </Button>
                )
              }
            />
          )}
          {(dimmable || light.brightnessPoints.length > 0) && (
            <ChannelRow
              icon={<SunMedium className="size-4" />}
              title="Brightness"
              status={
                light.brightnessPoints.length
                  ? `${light.brightnessPoints.length}-point curve`
                  : 'Not calibrated · levels are sent as chosen'
              }
              preview={
                light.brightnessPoints.length > 0 && (
                  <BrightnessCurvePreview points={light.brightnessPoints} />
                )
              }
              action={
                dimmable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCalibrate('brightness')}
                  >
                    {light.brightnessPoints.length
                      ? 'Adjust brightness'
                      : 'Calibrate brightness'}
                  </Button>
                )
              }
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {light.kind !== 'none' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (
                await confirmDialog({
                  title: `Remove calibration from ${labelFor(deviceKey)}?`,
                  description: light.profile
                    ? `${light.profile.name} is kept${light.sharedWith.length ? ` for the ${light.sharedWith.length} other light${light.sharedWith.length === 1 ? '' : 's'} using it` : ' and can be applied again later'}.`
                    : 'The older per-light calibration is deleted.',
                  confirmLabel: 'Remove calibration',
                })
              )
                assign('');
            }}
          >
            Remove calibration from this light
          </Button>
        )}
        <Link
          to="/config/calibration"
          className="ml-auto text-xs text-muted-foreground underline underline-offset-2"
        >
          All calibration profiles
        </Link>
      </div>
    </div>
  );
}
