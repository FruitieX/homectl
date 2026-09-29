import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import {
  useCalibrationEditor,
  deviceCalibration,
  type CalibrationEditorView,
} from '@/hooks/useCalibrationEditor';
import { useCalibrationDraft } from '@/hooks/useCalibrationDraft';
import { useCalibrationPreview } from '@/hooks/useCalibrationPreview';
import { createUuid } from '@/lib/uuid';
import { configItemHref } from '@/lib/configItemHref';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { CalibrationConflict } from '@/ui/settings/CalibrationConflict';
import { StatePreview } from '@/ui/settings/StatePreview';
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
  /** The brightness curve this light resolves to today, when it has one. */
  existingBrightnessPoints?: BrightnessPoint[];
  /** How many lights share the profile, so a shared edit is not a surprise. */
  profileUsage?: number;
  onSaved?: () => void;
};

const percentText = (value: number) => formatPercent(value);

/**
 * Brightness calibration: pick a reference (or type a curve), build editable
 * points with a live preview, then review what the curve does at the edges
 * before saving. Nothing is saved automatically and no light is commanded
 * except through the clearly labelled preview.
 */
export function BrightnessCalibrationWizard(
  props: BrightnessCalibrationWizardProps,
) {
  const query = useCalibrationEditor();
  if (!query.data)
    return (
      <div
        className="space-y-2 text-sm"
        role={query.error ? 'alert' : 'status'}
      >
        {query.error ? query.error.message : 'Loading calibration…'}
        {query.error && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        )}
      </div>
    );
  return (
    <BrightnessCalibrationForm
      key={getDeviceKey(props.device)}
      {...props}
      initial={query.data}
    />
  );
}

type BrightnessDraft = {
  id: string;
  name: string;
  step: Step;
  mode: 'reference' | 'manual';
  referenceKey: string;
  pointInputs: Array<{ logical: string; output: string }>;
  remove: boolean;
};

const numericPoints = (form: BrightnessDraft): BrightnessPoint[] =>
  form.pointInputs.map((row) => ({
    logical: parsePercent(row.logical) ?? NaN,
    output: parsePercent(row.output) ?? NaN,
  }));
const pointText = (value: number) => formatPercent(value).replace('%', '');

function BrightnessCalibrationForm({
  device,
  devices,
  onSaved,
  initial,
}: BrightnessCalibrationWizardProps & { initial: CalibrationEditorView }) {
  const deviceKey = getDeviceKey(device);
  const session = useCalibrationPreview('brightness');
  const draft = useCalibrationDraft<BrightnessDraft>({
    kind: 'brightness',
    deviceKey,
    label: device.name,
    initial,
    form: () => {
      const existing =
        deviceCalibration(initial, deviceKey).resolved?.brightness_points ?? [];
      return {
        id: createUuid(),
        name: `${device.name || 'Light'} brightness`.slice(0, 200),
        step: 'mode',
        mode: 'reference',
        referenceKey: '',
        remove: false,
        pointInputs: (existing.length >= 2
          ? sortBrightnessPoints(existing)
          : suggestedBrightnessPoints()
        ).map((row) => ({
          logical: pointText(row.logical),
          output: pointText(row.output),
        })),
      };
    },
    beforeSave: session.stop,
    validate: (form) => {
      if (form.remove) return [];
      const error = brightnessCurveError(numericPoints(form));
      return [
        ...(!form.name.trim()
          ? [{ field: 'calibration_name', message: 'Give the profile a name.' }]
          : []),
        ...(error ? [{ field: 'calibration_points', message: error }] : []),
      ];
    },
    prepare: (form, basis) => {
      const { profile, resolved } = deviceCalibration(basis, deviceKey);
      const points = resolved?.points ?? [];
      if (form.remove && !points.length)
        return { device_keys: [deviceKey], profile_id: null };
      return {
        device_keys: [deviceKey],
        profile_id: form.id,
        profile: {
          id: form.id,
          name: form.remove
            ? `${device.name || 'Light'} color only`
            : form.name.trim(),
          points,
          // Matching brightness must not overwrite the color reference metadata.
          reference_device_key: points.length
            ? (profile?.reference_device_key ?? null)
            : form.mode === 'reference'
              ? form.referenceKey || null
              : null,
          brightness: profile?.brightness ?? 1,
          brightness_points: form.remove
            ? []
            : sortBrightnessPoints(numericPoints(form)),
        },
      };
    },
    onSaved: () => {
      setSaved(draft.value.form.remove ? 'removed' : draft.value.form.id);
      onSaved?.();
    },
  });
  const [step, setStep] = draft.field('step');
  const [mode, setMode] = draft.field('mode');
  const [referenceKey, setReferenceKey] = draft.field('referenceKey');
  const points = useMemo(
    () => numericPoints(draft.value.form),
    [draft.value.form],
  );
  const setPoints = (
    next:
      BrightnessPoint[] | ((points: BrightnessPoint[]) => BrightnessPoint[]),
  ) =>
    draft.change((current) => {
      const previous = numericPoints(current.form);
      const updated = typeof next === 'function' ? next(previous) : next;
      return {
        ...current,
        form: {
          ...current.form,
          pointInputs: updated.map((row, index) => ({
            logical: Object.is(row.logical, previous[index]?.logical)
              ? current.form.pointInputs[index].logical
              : pointText(row.logical),
            output: Object.is(row.output, previous[index]?.output)
              ? current.form.pointInputs[index].output
              : pointText(row.output),
          })),
        },
      };
    });
  const [name, setName] = draft.field('name');
  const { profile, resolved } = deviceCalibration(draft.value.basis, deviceKey);
  const existingPoints = resolved?.points ?? [];
  const profileUsage = draft.value.basis.assignments.filter(
    (row) => row.profile_id === profile?.id,
  ).length;
  const [previewLogical, setPreviewLogical] = useState<number | null>(null);
  const saving = draft.saving;
  const preview = {
    state: session.pending
      ? 'starting'
      : session.error
        ? 'error'
        : session.active
          ? 'active'
          : 'idle',
    message: session.error,
  };
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const stopPreview = async () => {
    try {
      await session.stop();
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not stop preview',
      );
    }
  };
  const startPreview = async (point: BrightnessPoint) => {
    setError(null);
    try {
      await session.preview({
        target_key: deviceKey,
        reference_key: mode === 'reference' ? referenceKey || null : null,
        output: point.output,
        reference_logical:
          mode === 'reference' && referenceKey ? point.logical : null,
      });
      setPreviewLogical(point.logical);
    } catch {
      /* The shared session exposes the failure. */
    }
  };

  const updateRow = (
    index: number,
    field: 'logical' | 'output',
    text: string,
  ) => {
    draft.change((current) => ({
      ...current,
      form: {
        ...current.form,
        pointInputs: current.form.pointInputs.map((row, i) =>
          i === index ? { ...row, [field]: text } : row,
        ),
      },
    }));
  };

  const removeCalibration = () => {
    setSaved(null);
    draft.change((current) => ({
      ...current,
      form: { ...current.form, id: createUuid(), remove: true, step: 'review' },
    }));
  };
  const discard = () => {
    void session
      .stop()
      .then(() => {
        draft.discard();
        setSaved(null);
        setError(null);
      })
      .catch((error) =>
        setError(
          error instanceof Error ? error.message : 'Could not stop preview',
        ),
      );
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
              draft.change((current) => ({
                ...current,
                form: {
                  ...current.form,
                  id: createUuid(),
                  remove: false,
                  step: 'points',
                },
              }));
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
    <div className="space-y-4" aria-label="Brightness calibration">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status">
          {draft.dirty ? 'Unsaved calibration' : 'Calibration draft'} ·{' '}
          {session.active ? 'Live preview active' : 'Preview stopped'}
        </span>
        {referenceKey && (
          <Link
            className="settings-link"
            to={configItemHref('device', referenceKey)}
          >
            Open reference light
          </Link>
        )}
        {step !== 'review' && draft.dirty && (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={discard}
          >
            Discard
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {draft.value.form.remove && (
        <p role="status" className="text-sm">
          Brightness calibration will be removed on Save. Existing color
          calibration is kept.
        </p>
      )}
      <CalibrationConflict
        before={draft.value.basis}
        current={draft.conflictCatalog}
        onReview={draft.reviewLatest}
      />
      <fieldset disabled={saving} className="min-w-0 space-y-4">
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
              Brightness calibration changes the command this light receives, so
              a level in homectl looks like the same level on another light.
              Compare under the same conditions — brightness also depends on the
              room, the shade, and the ambient light.
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
                {profileUsage > 1
                  ? ` ${profileUsage} lights share this profile; they keep it.`
                  : null}
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
                    Set both lights to a level and adjust this one until they
                    look alike.
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
              the command this light receives. Edit either number, or add a
              point anywhere.
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
                    key={index}
                    className="space-y-2 rounded-xl border border-border/70 p-3"
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <StatePreview
                        brightness={point.output}
                        power
                        label={
                          Number.isFinite(point.output)
                            ? `Target output ${formatPercent(point.output)}`
                            : 'Enter a valid target output'
                        }
                      />
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
                            value={draft.value.form.pointInputs[index].logical}
                            onChange={(event) =>
                              updateRow(index, 'logical', event.target.value)
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            %
                          </span>
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
                            value={draft.value.form.pointInputs[index].output}
                            onChange={(event) =>
                              updateRow(index, 'output', event.target.value)
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            %
                          </span>
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
                      value={
                        Number.isFinite(point.output)
                          ? Math.round(point.output * 1000) / 10
                          : 0
                      }
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
                          <Loader2
                            aria-hidden
                            className="size-4 animate-spin"
                          />
                        ) : null}
                        {previewing
                          ? 'Previewing this point'
                          : 'Preview this point'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={preview.state === 'idle'}
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
                        Reset this point
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {rowError
                          ? 'Correct the point before previewing.'
                          : mirrors
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
                data-field="calibration_name"
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
                A new profile is created for this light. Other lights keep their
                current assignments.
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
                variant="ghost"
                onClick={() => setStep('points')}
              >
                Back
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={removeCalibration}
              >
                Remove brightness calibration
              </Button>
            </div>
          </div>
        ) : null}
      </fieldset>
      {step === 'review' && (
        <EntitySaveBar
          inline
          draft={{ ...draft, discard }}
          saveDisabled={Boolean(draft.conflictCatalog) || session.pending}
        />
      )}
    </div>
  );
}
