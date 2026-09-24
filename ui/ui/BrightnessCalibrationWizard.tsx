import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { useAppConfig } from '@/hooks/appConfig';
import { useAssignCalibrationProfile } from '@/hooks/useConfig';
import { getDeviceKey } from '@/lib/device';
import {
  BRIGHTNESS_COARSE_STEP,
  BRIGHTNESS_FINE_STEP,
  type BrightnessPoint,
  addBrightnessPoint,
  brightnessClampSummary,
  brightnessCurveError,
  brightnessPointError,
  brightnessReviewRows,
  formatPercent,
  isDimmableDevice,
  mapBrightnessOutput,
  parsePercent,
  removeBrightnessPoint,
  setBrightnessPoint,
  sortBrightnessPoints,
  stepBrightnessValue,
  suggestedBrightnessPoints,
} from '@/lib/brightnessCalibration';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/lib/cn';
import type { Device } from '@/bindings/Device';
import type { ColorCalibrationProfile } from '@/bindings/ColorCalibrationProfile';

type Step = 'mode' | 'points' | 'review';

type BrightnessCalibrationWizardProps = {
  device: Device;
  devices: Device[];
  /** What this light resolves today, so the other channel is preserved. */
  existingPoints?: Array<{ reference: unknown; output: unknown }>;
  /** The profile this light is assigned to, when there is one. */
  profile?: ColorCalibrationProfile | null;
  onSaved?: () => void;
};

const percentText = (value: number) => formatPercent(value);

/**
 * Brightness calibration: pick a reference (or type a curve), build editable
 * points with a live preview, then review what the curve does at the edges
 * before saving. Nothing is saved automatically and no light is commanded
 * except through the clearly labelled preview.
 */
export function BrightnessCalibrationWizard({
  device,
  devices,
  existingPoints = [],
  profile = null,
  onSaved,
}: BrightnessCalibrationWizardProps) {
  const { apiEndpoint } = useAppConfig();
  const assignCalibration = useAssignCalibrationProfile();
  const deviceKey = getDeviceKey(device);

  const [step, setStep] = useState<Step>('mode');
  const [mode, setMode] = useState<'reference' | 'manual'>('reference');
  const [referenceKey, setReferenceKey] = useState('');
  const [previewLogical, setPreviewLogical] = useState<number | null>(null);
  const [points, setPoints] = useState<BrightnessPoint[]>(() =>
    suggestedBrightnessPoints(),
  );
  const [preview, setPreview] = useState<{
    state: 'idle' | 'starting' | 'active' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const [name, setName] = useState(
    `${device.name || 'Light'} brightness`.slice(0, 200),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const dimmable = isDimmableDevice(device);
  const ordered = useMemo(() => sortBrightnessPoints(points), [points]);
  const curveError = brightnessCurveError(points);
  const clamp = brightnessClampSummary(points);

  const referenceOptions = useMemo(
    () =>
      devices
        .filter((candidate) => isDimmableDevice(candidate))
        .filter((candidate) => getDeviceKey(candidate) !== deviceKey)
        .map((candidate) => ({
          key: getDeviceKey(candidate),
          name: candidate.name || getDeviceKey(candidate),
          id: getDeviceKey(candidate),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [deviceKey, devices],
  );
  const reference = useMemo(
    () =>
      referenceOptions.find((option) => option.key === referenceKey) ?? null,
    [referenceKey, referenceOptions],
  );

  const stopPreview = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setPreview({ state: 'idle' });
    if (!session) return;
    // Cancel restores the runtime state of both lights server-side.
    await fetch(
      `${apiEndpoint}/api/v1/config/calibration-sessions/${encodeURIComponent(session)}`,
      { method: 'DELETE' },
    ).catch(() => undefined);
  }, [apiEndpoint]);

  // Never leave a preview running: unmount, or the browser closing the tab.
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session) {
        void fetch(
          `${apiEndpoint}/api/v1/config/calibration-sessions/${encodeURIComponent(session)}`,
          { method: 'DELETE', keepalive: true },
        ).catch(() => undefined);
      }
    };
  }, [apiEndpoint]);

  const startPreview = async (point: BrightnessPoint) => {
    setPreview({ state: 'starting' });
    setError(null);
    const session = `${deviceKey.replace(/[^a-zA-Z0-9]+/g, '-')}-brightness`;
    const start = sessionRef.current !== session;
    const body = {
      target_key: deviceKey,
      reference_key: mode === 'reference' && referenceKey ? referenceKey : null,
      output: point.output,
      reference_logical:
        mode === 'reference' && referenceKey ? point.logical : null,
    };
    const response = await fetch(
      `${apiEndpoint}/api/v1/config/calibration-brightness-sessions/${encodeURIComponent(session)}`,
      {
        method: start ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.success === false) {
      setPreview({
        state: 'error',
        message:
          payload?.error ??
          'The preview could not start. The numbers you typed are still here.',
      });
      return;
    }
    sessionRef.current = session;
    setPreviewLogical(point.logical);
    setPreview({ state: 'active' });
  };

  // A slow heartbeat keeps the session alive while a person compares lights.
  useEffect(() => {
    if (preview.state !== 'active') return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      void fetch(
        `${apiEndpoint}/api/v1/config/calibration-sessions/${encodeURIComponent(session)}/heartbeat`,
        { method: 'POST' },
      ).catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [apiEndpoint, preview.state]);

  const updateRow = (
    index: number,
    field: 'logical' | 'output',
    text: string,
  ) => {
    const value = parsePercent(text);
    // An unparsable entry keeps the old number: the field reports the reason
    // instead of silently jumping to zero.
    if (value === null) return;
    setPoints((current) => setBrightnessPoint(current, index, field, value));
  };

  const save = async () => {
    if (curveError) return;
    setSaving(true);
    setError(null);
    const id = `${deviceKey.replace(/[^a-zA-Z0-9]+/g, '_')}_brightness_${Date.now()
      .toString(36)
      .slice(-4)}`;
    const profileBody = {
      id,
      name: name.trim(),
      // The other channel is preserved: a colour match this light already has
      // travels into the new profile, and the old profile is left alone.
      points: profile?.points ?? existingPoints,
      reference_device_key:
        mode === 'reference' && referenceKey ? referenceKey : null,
      brightness: profile?.brightness ?? 1,
      brightness_points: ordered,
    };
    const create = await fetch(
      `${apiEndpoint}/api/v1/config/calibration-profiles`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileBody),
      },
    ).catch(() => null);
    const payload = create ? await create.json().catch(() => null) : null;
    if (!create || !create.ok || payload?.success === false) {
      setSaving(false);
      setError(payload?.error ?? 'The profile could not be saved');
      return;
    }
    try {
      await assignCalibration.mutateAsync({
        deviceKeys: [deviceKey],
        profileId: id,
      });
      setSaved(id);
      onSaved?.();
    } catch (assignError) {
      setError(
        assignError instanceof Error
          ? assignError.message
          : 'The profile was saved but could not be assigned to this light',
      );
    } finally {
      setSaving(false);
    }
  };

  const removeCalibration = async () => {
    setSaving(true);
    setError(null);
    try {
      // Removing only the brightness channel: a colour match this light has is
      // kept by assigning a profile that still carries it.
      if (existingPoints.length > 0 || (profile?.points ?? []).length > 0) {
        const id = `${deviceKey.replace(/[^a-zA-Z0-9]+/g, '_')}_color_only`;
        const keep = await fetch(
          `${apiEndpoint}/api/v1/config/calibration-profiles`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              name: `${device.name || 'Light'} color only`,
              points: profile?.points ?? existingPoints,
              reference_device_key: profile?.reference_device_key ?? null,
              brightness: profile?.brightness ?? 1,
              brightness_points: [],
            }),
          },
        ).catch(() => null);
        if (!keep || !keep.ok) {
          throw new Error('That calibration could not be changed');
        }
        await assignCalibration.mutateAsync({
          deviceKeys: [deviceKey],
          profileId: id,
        });
      } else {
        await assignCalibration.mutateAsync({
          deviceKeys: [deviceKey],
          profileId: null,
        });
      }
      setSaved('removed');
      onSaved?.();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'That calibration could not be removed',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!dimmable) {
    return (
      <p className="text-sm text-muted-foreground">
        This light cannot dim, so it has no brightness to calibrate.
      </p>
    );
  }

  if (saved) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm text-foreground">
          {saved === 'removed'
            ? 'Brightness calibration removed'
            : 'Brightness calibration saved'}
          {saved !== 'removed' ? ' and assigned to this light' : ''}.
        </p>
        {saved !== 'removed' ? (
          <dl className="space-y-1 text-sm">
            {brightnessReviewRows(ordered).map((row) => (
              <div key={row.logical} className="flex items-center gap-2">
                <dt className="text-muted-foreground">Desired {row.logical}</dt>
                <dd>→ send {row.output}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSaved(null);
              setStep('points');
            }}
          >
            Change brightness calibration
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void removeCalibration()}
          >
            Remove brightness calibration
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Apply this curve to more lights from the lights list, where you can
          see what the profile contains before choosing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {(['mode', 'points', 'review'] as Step[]).map((entry, index) => (
          <li key={entry} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden>/</span> : null}
            <span
              className={cn(entry === step && 'font-medium text-foreground')}
            >
              {index + 1}.{' '}
              {entry === 'mode'
                ? 'What to match'
                : entry === 'points'
                  ? 'Build points'
                  : 'Review and save'}
            </span>
          </li>
        ))}
      </ol>

      {step === 'mode' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Brightness calibration changes the command this light receives, so a
            level in homectl looks like the same level on another light. Compare
            under the same conditions — brightness also depends on the room, the
            shade, and the ambient light.
          </p>
          {profile?.brightness_points?.length ||
          (profile?.points?.length ?? 0) > 0 ? (
            <p className="text-sm">
              This light is calibrated for{' '}
              {[
                (profile?.points?.length ?? 0) > 0 ? 'Color' : null,
                (profile?.brightness_points?.length ?? 0) > 0
                  ? 'Brightness'
                  : null,
              ]
                .filter(Boolean)
                .join(' and ')}
              . Saving a new profile keeps the other part.
            </p>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              How do you want to work?
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="brightness-mode"
                className="mt-1 size-4 accent-primary"
                checked={mode === 'reference'}
                onChange={() => setMode('reference')}
              />
              <span>
                Match a reference light
                <span className="block text-xs text-muted-foreground">
                  Set both lights to a level and adjust this one until they look
                  alike.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="brightness-mode"
                className="mt-1 size-4 accent-primary"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
              />
              <span>
                Enter a curve manually
                <span className="block text-xs text-muted-foreground">
                  You already know the numbers. No reference light is needed.
                </span>
              </span>
            </label>
          </fieldset>
          {mode === 'reference' ? (
            <div className="space-y-2">
              <label className="block space-y-1.5 text-sm font-medium">
                Reference light
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={referenceKey}
                  onChange={(event) => setReferenceKey(event.target.value)}
                >
                  <option value="">Choose a light…</option>
                  {referenceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.name} — {option.id}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Use a light you like the look of at a given level. Its own
                calibration is kept, and it is set to the level you choose.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={mode === 'reference' && !referenceKey}
              onClick={() => setStep('points')}
            >
              Continue
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              {mode === 'reference' && !referenceKey
                ? 'Choose a reference light, or switch to entering a curve manually'
                : 'Nothing is saved until you review'}
            </span>
          </div>
        </div>
      ) : null}

      {step === 'points' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Desired brightness is what you choose in homectl. Target output is
            the command this light receives. Edit either number, or add a point
            anywhere.
          </p>
          <div className="space-y-3">
            {points.map((point, index) => {
              const rowError = brightnessPointError(points, index);
              const previewing =
                preview.state === 'active' &&
                previewLogical !== null &&
                Math.abs(previewLogical - point.logical) < 1e-9;
              const mirrors =
                Math.abs(point.logical - point.output) > 1e-9 ||
                index < ordered.length - 1 ||
                index === 0;
              const isExtraLow =
                ordered.length > 0 &&
                point.logical < ordered[0].logical + 1e-9 &&
                point.output < point.logical;
              return (
                <div
                  key={`${point.logical}-${index}`}
                  className="space-y-2 rounded-xl border border-border/70 p-3"
                >
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="block text-xs text-muted-foreground">
                        Desired brightness
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.1}
                          max={100}
                          step={0.1}
                          inputMode="decimal"
                          aria-label={`Desired brightness for point ${index + 1}`}
                          className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          value={formatPercent(point.logical).replace('%', '')}
                          onChange={(event) =>
                            updateRow(index, 'logical', event.target.value)
                          }
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Decrease desired brightness for point ${index + 1} by 1%`}
                          onClick={() =>
                            setPoints((current) =>
                              setBrightnessPoint(
                                current,
                                index,
                                'logical',
                                stepBrightnessValue(point.logical, 'down'),
                              ),
                            )
                          }
                        >
                          −1%
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Increase desired brightness for point ${index + 1} by 0.1%`}
                          onClick={() =>
                            setPoints((current) =>
                              setBrightnessPoint(
                                current,
                                index,
                                'logical',
                                stepBrightnessValue(
                                  point.logical,
                                  'up',
                                  BRIGHTNESS_FINE_STEP,
                                ),
                              ),
                            )
                          }
                        >
                          +0.1%
                        </Button>
                      </div>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-xs text-muted-foreground">
                        Target output
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.1}
                          max={100}
                          step={0.1}
                          inputMode="decimal"
                          aria-label={`Target output for point ${index + 1}`}
                          className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          value={formatPercent(point.output).replace('%', '')}
                          onChange={(event) =>
                            updateRow(index, 'output', event.target.value)
                          }
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Decrease target output for point ${index + 1} by 1%`}
                          onClick={() =>
                            setPoints((current) =>
                              setBrightnessPoint(
                                current,
                                index,
                                'output',
                                stepBrightnessValue(point.output, 'down'),
                              ),
                            )
                          }
                        >
                          −1%
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Increase target output for point ${index + 1} by 0.1%`}
                          onClick={() =>
                            setPoints((current) =>
                              setBrightnessPoint(
                                current,
                                index,
                                'output',
                                stepBrightnessValue(
                                  point.output,
                                  'up',
                                  BRIGHTNESS_FINE_STEP,
                                ),
                              ),
                            )
                          }
                        >
                          +0.1%
                        </Button>
                      </div>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove point ${index + 1}`}
                      disabled={points.length <= 1}
                      onClick={() =>
                        setPoints((current) =>
                          removeBrightnessPoint(current, point.logical),
                        )
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                      Remove
                    </Button>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={100}
                    step={0.1}
                    aria-label={`Target output slider for point ${index + 1}`}
                    className="w-full accent-primary"
                    value={Math.round(point.output * 1000) / 10}
                    onChange={(event) => {
                      const value = Number(event.target.value) / 100;
                      setPoints((current) =>
                        setBrightnessPoint(current, index, 'output', value),
                      );
                    }}
                  />
                  {isExtraLow ? (
                    <p className="text-xs text-muted-foreground">
                      This is an authored extra-low point: the reference light
                      cannot reach this level, so it is your own choice rather
                      than a visual match.
                    </p>
                  ) : null}
                  {rowError ? (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-300"
                      role="alert"
                    >
                      {rowError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        preview.state === 'starting' || Boolean(rowError)
                      }
                      onClick={() => void startPreview(point)}
                    >
                      {preview.state === 'starting' ? (
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                      ) : null}
                      {previewing
                        ? 'Previewing this point'
                        : 'Preview this point'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={preview.state !== 'active'}
                      onClick={() => void stopPreview()}
                    >
                      Stop preview
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPoints((current) => {
                          const next = [...current];
                          next[index] = { ...point, output: point.logical };
                          return next;
                        })
                      }
                    >
                      Looks matched
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {mirrors
                        ? `sends ${percentText(mapBrightnessOutput(ordered, point.logical))}`
                        : 'identity'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPoints((current) =>
                  addBrightnessPoint(
                    current,
                    Math.max(0.001, (ordered[0]?.logical ?? 0.5) / 2),
                  ),
                )
              }
            >
              <Plus aria-hidden className="size-4" />
              Add a point
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPoints(suggestedBrightnessPoints())}
            >
              Reset suggestions
            </Button>
          </div>
          {preview.state === 'error' ? (
            <p
              className="text-sm text-amber-700 dark:text-amber-300"
              role="alert"
            >
              {preview.message}
            </p>
          ) : null}
          {curveError ? (
            <p
              className="text-sm text-amber-700 dark:text-amber-300"
              role="alert"
            >
              {curveError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={Boolean(curveError)}
              onClick={() => setStep('review')}
            >
              Review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep('mode')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-4">
          <table className="w-full text-sm">
            <caption className="sr-only">
              What the brightness curve sends for each desired level
            </caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1">
                  Desired brightness
                </th>
                <th scope="col" className="py-1">
                  Send
                </th>
              </tr>
            </thead>
            <tbody>
              {brightnessReviewRows(ordered).map((row) => (
                <tr key={row.logical} className="border-t border-border/60">
                  <td className="py-1">{row.logical}</td>
                  <td className="py-1">
                    {row.output}
                    {row.changes ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        authored
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">
                        unchanged
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>{clamp.floor}</li>
            <li>{clamp.ceiling}</li>
            <li>
              {mode === 'reference' && reference
                ? `Compared against ${reference.name}; matched points are your visual match.`
                : 'Entered by hand; no reference light was used.'}
            </li>
            <li>
              {(profile?.points?.length ?? 0) > 0 || existingPoints.length > 0
                ? 'Color calibration is preserved in the new profile.'
                : 'No color calibration to preserve on this light.'}
            </li>
            <li>Saving assigns the new profile to this light only.</li>
          </ul>
          <label className="block space-y-1.5 text-sm font-medium">
            Profile name
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Details
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              The profile id is generated from this light. Existing profiles are
              never changed: this is a new profile for this light.
            </p>
          </details>
          {error ? (
            <p
              className="text-sm text-amber-700 dark:text-amber-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : null}
              Save and assign
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep('points')}>
              Back
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => void removeCalibration()}
            >
              Remove brightness calibration
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
