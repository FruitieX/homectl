import { useCallback, useEffect, useRef, useState } from 'react';
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;
import type { Device } from '@/bindings/Device';
import type { Hs } from '@/bindings/Hs';
import {
  useCalibrationEditor,
  deviceCalibration,
  type CalibrationEditorView,
} from '@/hooks/useCalibrationEditor';
import { useCalibrationDraft } from '@/hooks/useCalibrationDraft';
import { CalibrationConflict } from '@/ui/settings/CalibrationConflict';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { StatePreview } from '@/ui/settings/StatePreview';
import { CalibrationCatalogStatus } from '@/ui/settings/CalibrationCatalogStatus';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { useAppConfig } from '@/hooks/appConfig';
import { getDeviceKey } from '@/lib/device';
import { compareDeviceNames } from '@/lib/deviceLabel';
import { createUuid } from '@/lib/uuid';
import {
  calibrationPointToUv,
  calibratedHsv,
  canAmendReferencePoint,
  canCalibrateDevice,
  getCurrentHsColor,
  matchingPointsFromProfile,
  nextManualCalibrationPoint,
  pointForCurrentReference,
  removeCalibrationPoint,
  stepCalibrationValue,
  suggestedMatchingPoints,
  verificationColors,
} from '@/lib/colorCalibration';
import { ConfigFormSection } from '@/ui/config-form';
import { ColorSlider } from '@/ui/ColorSlider';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

type Phase = 'setup' | 'match' | 'review' | 'saved';

function SliderStepButtons({
  disabled = false,
  label,
  onStep,
}: {
  disabled?: boolean;
  label: string;
  onStep: (delta: number) => void;
}) {
  return (
    <div
      className="grid grid-cols-4 gap-2"
      role="group"
      aria-label={`${label} step controls`}
    >
      {[-1, -5, 1, 5].map((delta) => (
        <Button
          key={delta}
          type="button"
          variant="outline"
          className="min-h-11 flex-1 px-2 text-base"
          disabled={disabled}
          onClick={() => onStep(delta)}
        >
          {delta > 0 ? `+${delta}` : delta}
        </Button>
      ))}
    </div>
  );
}

type ColorDraft = {
  id: string;
  editingProfileId: string | null;
  phase: Phase;
  referenceKey: string;
  name: string;
  brightness: number;
  numberEdits: Record<string, string>;
  points: ReturnType<typeof suggestedMatchingPoints>;
  index: number;
};
export function ColorCalibrationWizard(props: {
  device: Device;
  devices: Device[];
}) {
  const query = useCalibrationEditor();
  return (
    <div className="space-y-3">
      <CalibrationCatalogStatus query={query} />
      {query.data && (
        <ColorCalibrationForm
          key={getDeviceKey(props.device)}
          {...props}
          initial={query.data}
        />
      )}
    </div>
  );
}
function ColorCalibrationForm({
  device,
  devices,
  initial,
}: {
  device: Device;
  devices: Device[];
  initial: CalibrationEditorView;
}) {
  const { apiEndpoint } = useAppConfig();
  const targetKey = getDeviceKey(device);
  const [savedNotice, setSavedNotice] = useState(false);
  const draft = useCalibrationDraft<ColorDraft>({
    kind: 'color',
    deviceKey: targetKey,
    label: device.name,
    initial,
    form: () => ({
      id: createUuid(),
      editingProfileId: null,
      phase: 'setup',
      referenceKey: '',
      name: device.name + ' color match',
      brightness: 50,
      numberEdits: {},
      points: suggestedMatchingPoints(),
      index: 0,
    }),
    beforeSave: (): Promise<void> => stop(),
    validate: (form) => [
      ...(Object.keys(form.numberEdits ?? {}).length
        ? [
            {
              field: 'calibration_numbers',
              message:
                'Finish the brightness, hue or saturation entry before saving.',
            },
          ]
        : []),
      ...(!form.points.length ||
      !Number.isFinite(form.brightness) ||
      form.brightness < 1 ||
      form.brightness > 100
        ? [
            {
              field: 'calibration_points',
              message:
                'Add color points and choose brightness between 1% and 100%.',
            },
          ]
        : []),
      ...(!form.name.trim()
        ? [{ field: 'calibration_name', message: 'Give the profile a name.' }]
        : []),
      ...(form.points.some((p) => !p.matched)
        ? [
            {
              field: 'calibration_points',
              message: 'Match each color point before saving.',
            },
          ]
        : []),
    ],
    prepare: (form, basis) => ({
      device_keys: [targetKey],
      profile_id: form.editingProfileId ?? form.id,
      profile: {
        id: form.editingProfileId ?? form.id,
        name: form.name.trim(),
        reference_device_key: form.referenceKey || null,
        brightness: form.brightness / 100,
        points: form.points.map(({ reference, output }) =>
          calibrationPointToUv({ reference, output }),
        ),
        brightness_points:
          deviceCalibration(basis, targetKey).resolved?.brightness_points ?? [],
      },
    }),
    onSaved: () => setSavedNotice(true),
  });
  const currentProfile = deviceCalibration(
    draft.value.basis,
    targetKey,
  ).profile;
  const [storedPhase, changePhase] = draft.field('phase');
  const phase = savedNotice ? 'saved' : storedPhase;
  const setPhase = (value: Phase) => {
    setSavedNotice(false);
    changePhase(value);
  };
  const [referenceKey, setReferenceKey] = draft.field('referenceKey');
  const [editingProfileId, setEditingProfileId] =
    draft.field('editingProfileId');
  const [name, setName] = draft.field('name');
  const [brightness, setBrightnessValue] = draft.field('brightness');
  const [numberEditsValue, setNumberEdits] = draft.field('numberEdits');
  const numberEdits = numberEditsValue ?? {};
  const invalidNumbers = Object.keys(numberEdits).length > 0;
  const clearNumber = (key: string) =>
    setNumberEdits((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  const setBrightness = (value: number | ((current: number) => number)) => {
    clearNumber('brightness');
    setBrightnessValue(value);
  };
  const numberInput = (
    key: string,
    raw: string,
    min: number,
    max: number,
    apply: (n: number) => void,
  ) => {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n < min || n > max) {
      setNumberEdits((previous) => ({ ...previous, [key]: raw }));
      setPreviewed(false);
    } else {
      clearNumber(key);
      apply(n);
    }
  };
  const [points, setPoints] = draft.field('points');
  const [index, setIndex] = draft.field('index');
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState('');
  const [checkIndex, setCheckIndex] = useState<number | null>(null);
  const session = useRef<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const point = points[index];
  const referenceDevice = devices.find(
    (candidate) => getDeviceKey(candidate) === referenceKey,
  );
  const previewIssue: string | null = !canCalibrateDevice(device)
    ? 'This light cannot be previewed for color calibration. It must support color and be enabled and writable.'
    : !referenceDevice ||
        !canCalibrateDevice(referenceDevice) ||
        referenceKey === targetKey
      ? 'Choose an available, writable reference light that supports color. Your matching points are kept.'
      : null;
  const currentReferenceColor = referenceDevice
    ? getCurrentHsColor(referenceDevice)
    : null;
  const currentReferencePoint = currentReferenceColor
    ? pointForCurrentReference(points, currentReferenceColor)
    : null;
  const canAmendCurrentPoint = canAmendReferencePoint(
    currentReferenceColor,
    points,
    index,
  );
  const baseUrl = `${apiEndpoint}/api/v1/config`;

  const enqueue = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    const next = queue.current.catch(() => undefined).then(action);
    queue.current = next;
    return next;
  }, []);
  const request = useCallback(
    async (path: string, method: string, body?: unknown) => {
      if (body !== undefined && previewIssue) throw new Error(previewIssue);
      const response = await fetch(`${baseUrl}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive: method === 'DELETE',
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error ?? 'Could not contact the lights');
    },
    [baseUrl, previewIssue],
  );
  const previewBody = (reference: Hs, output: Hs) => ({
    target_key: targetKey,
    reference_key: referenceKey,
    reference,
    output,
    brightness: brightness / 100,
  });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Calibration failed');
    } finally {
      setBusy(false);
    }
  };
  const stop = useCallback(async () => {
    const id = session.current;
    if (id) {
      await enqueue(() => request(`calibration-sessions/${id}`, 'DELETE'));
      session.current = null;
      setSessionActive(false);
    }
  }, [enqueue, request]);
  useEffect(() => {
    if (previewIssue && session.current) {
      setPreviewed(false);
      void stop().catch((error: unknown) =>
        setError(
          error instanceof Error ? error.message : 'Could not stop preview',
        ),
      );
    }
  }, [previewIssue, sessionActive, stop]);
  const startMatching = (startingPoint: (typeof points)[number]) => {
    void run(async () => {
      const id = createUuid();
      session.current = id;
      try {
        await enqueue(() =>
          request(
            `calibration-sessions/${id}`,
            'POST',
            previewBody(startingPoint.reference, startingPoint.output),
          ),
        );
        setSessionActive(true);
        setPhase('match');
      } catch (error) {
        await stop();
        throw error;
      }
    });
  };

  const editCurrentProfile = () => {
    if (!currentProfile) return;
    setNumberEdits({});
    setEditingProfileId(currentProfile.id);
    setName(currentProfile.name);
    setReferenceKey(currentProfile.reference_device_key ?? '');
    setBrightness(Math.round(currentProfile.brightness * 100));
    setPoints(
      currentProfile.points.length
        ? matchingPointsFromProfile(currentProfile)
        : suggestedMatchingPoints(),
    );
    setIndex(0);
    setCheckIndex(null);
    setPreviewed(false);
    setError('');
    setPhase('setup');
  };

  // Requests run in order: dragging cannot make an older response overwrite a
  // newer test. Only the latest acknowledged adjustment enables Next.
  useEffect(() => {
    if (phase !== 'match' || !session.current || invalidNumbers || previewIssue)
      return;
    let disposed = false;
    setPreviewed(false);
    const id = session.current;
    const timer = setTimeout(() => {
      void enqueue(() =>
        request(
          `calibration-sessions/${id}`,
          'PUT',
          previewBody(point.reference, point.output),
        ),
      )
        .then(() => {
          if (!disposed) {
            setPreviewed(true);
            setError('');
          }
        })
        .catch((error: unknown) => {
          if (!disposed)
            setError(error instanceof Error ? error.message : 'Preview failed');
        });
    }, 180);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
    // Include the output object so Reset also resends an unchanged color.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phase,
    invalidNumbers,
    previewIssue,
    index,
    point.reference.h,
    point.reference.s,
    point.output,
    brightness,
    referenceKey,
    targetKey,
    baseUrl,
  ]);

  useEffect(() => {
    const heartbeat = setInterval(() => {
      const id = session.current;
      if (id)
        void fetch(`${baseUrl}/calibration-sessions/${id}/heartbeat`, {
          method: 'POST',
        })
          .then((response) => {
            if (!response.ok) {
              setPreviewed(false);
              setError('The test session ended. Cancel and start again.');
            }
          })
          .catch(() => {
            setPreviewed(false);
            setError(
              'Connection lost. The lights will return to normal automatically.',
            );
          });
    }, 30000);
    return () => {
      clearInterval(heartbeat);
      const id = session.current;
      session.current = null;
      if (id)
        void queue.current
          .catch(() => undefined)
          .then(() =>
            fetch(`${baseUrl}/calibration-sessions/${id}`, {
              method: 'DELETE',
              keepalive: true,
            }),
          )
          .catch(() => undefined);
    };
  }, [baseUrl]);

  const adjust = (field: 'h' | 's', value: number) => {
    if (!Number.isFinite(value)) return;
    clearNumber(`${index}.${field}`);
    setPreviewed(false);
    setPoints((previous) =>
      previous.map((item, i) =>
        i === index
          ? {
              ...item,
              matched: false,
              output: {
                ...item.output,
                [field]:
                  field === 'h'
                    ? Math.max(0, Math.min(359, Math.round(value)))
                    : Math.max(0, Math.min(1, value)),
              },
            }
          : item,
      ),
    );
  };

  const stepOutput = (field: 'h' | 's', delta: number) => {
    const value = field === 'h' ? point.output.h : point.output.s * 100;
    const stepped = stepCalibrationValue(
      value,
      delta,
      0,
      field === 'h' ? 359 : 100,
      field === 'h' ? 1 : 10,
    );
    adjust(field, field === 'h' ? stepped : stepped / 100);
  };

  const stepBrightness = (delta: number) => {
    setBrightness((value) => stepCalibrationValue(value, delta, 1, 100));
  };

  const addPoint = () => {
    const added = nextManualCalibrationPoint(points, currentReferenceColor);
    setPoints((previous) => [...previous, added]);
    setIndex(points.length);
    setPreviewed(false);
  };

  const calibrateCurrentReference = () => {
    if (!currentReferenceColor || !currentReferencePoint) return;
    const { index: currentIndex, point: startingPoint } = currentReferencePoint;
    setPoints((previous) =>
      currentIndex === previous.length
        ? [...previous, startingPoint]
        : previous.map((item, pointIndex) =>
            pointIndex === currentIndex ? startingPoint : item,
          ),
    );
    setIndex(currentIndex);
    setCheckIndex(null);
    setPreviewed(false);
    startMatching(startingPoint);
  };

  const deleteCurrentPoint = () => {
    const result = removeCalibrationPoint(points, index);
    if (result.points === points) return;
    setNumberEdits((previous) =>
      Object.fromEntries(
        Object.entries(previous ?? {}).flatMap(([key, value]) => {
          if (key === 'brightness') return [[key, value]];
          const [pointIndex, field] = key.split('.');
          const n = Number(pointIndex);
          return n === index
            ? []
            : [[`${n > index ? n - 1 : n}.${field}`, value]];
        }),
      ),
    );
    setPoints(result.points);
    setIndex(result.index);
    setPreviewed(false);
  };

  return (
    <ConfigFormSection
      title="Color calibration"
      description={
        currentProfile
          ? `Using ${currentProfile.name}`
          : 'Match this lamp to a reference light and save a reusable profile.'
      }
    >
      <div className="space-y-5">
        {previewIssue && (referenceKey || !canCalibrateDevice(device)) && (
          <div
            role="status"
            className="space-y-2 text-sm text-muted-foreground"
          >
            <p>{previewIssue}</p>
            {phase !== 'setup' && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await stop();
                    setPhase('setup');
                  })
                }
              >
                Change reference
              </Button>
            )}
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive p-3 text-sm"
          >
            {error}
          </p>
        )}
        {phase === 'setup' && (
          <>
            <p className="text-sm text-muted-foreground">
              Choose a light whose colors you like. We’ll guide you through
              whites, vivid colors and softer colors, then check a few colors
              between them. Compare the light on the same neutral surface.
            </p>
            {currentProfile && !editingProfileId && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm">
                  This light uses <strong>{currentProfile.name}</strong>.
                  Editing or adding points updates every light that uses this
                  profile.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={editCurrentProfile}
                >
                  Edit profile / add points
                </Button>
              </div>
            )}
            {editingProfileId && currentReferencePoint && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm">
                  Calibrate the reference light’s current color without starting
                  from the first saved point. Existing points stay loaded, and a
                  new point starts from this profile’s current output.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={calibrateCurrentReference}
                >
                  Calibrate current reference state
                </Button>
              </div>
            )}
            <label className="block space-y-2 text-sm">
              Reference light
              <SearchablePicker
                ariaLabel="Color reference light"
                value={referenceKey}
                onChange={setReferenceKey}
                disabled={busy}
                placeholder="Choose a reference light"
                options={devices
                  .filter(
                    (candidate) =>
                      getDeviceKey(candidate) !== targetKey &&
                      canCalibrateDevice(candidate),
                  )
                  .sort(compareDeviceNames)
                  .map((candidate) => ({
                    value: getDeviceKey(candidate),
                    label: candidate.name,
                    detail: getDeviceKey(candidate),
                  }))}
              />
            </label>
            <label className="block space-y-2 text-sm">
              Profile name
              <Input
                aria-label="Profile name"
                data-field="calibration_name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="space-y-2">
              <ColorSlider
                label="Test brightness"
                channel="brightness"
                color={Color.hsv(point.output.h, point.output.s * 100, 100)}
                value={brightness}
                min={1}
                max={100}
                step={1}
                sliderClassName="h-12 min-h-12 touch-none"
                disabled={busy}
                onChange={(event) =>
                  setBrightness(event.currentTarget.valueAsNumber)
                }
              />
              <SliderStepButtons
                label="Test brightness"
                disabled={busy}
                onStep={stepBrightness}
              />
              <Input
                aria-label="Test brightness percent"
                type="number"
                min={1}
                max={100}
                value={numberEdits.brightness ?? brightness}
                aria-invalid={'brightness' in numberEdits || undefined}
                onChange={(event) =>
                  numberInput(
                    'brightness',
                    event.target.value,
                    1,
                    100,
                    setBrightness,
                  )
                }
                disabled={busy}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Both lights will temporarily turn on. Finish or Cancel returns
              them to normal control. Use the brightness you usually use; color
              matching can change at very low brightness.
            </p>
            <Button
              type="button"
              disabled={
                busy ||
                Boolean(previewIssue) ||
                'brightness' in numberEdits ||
                !referenceDevice ||
                !canCalibrateDevice(referenceDevice) ||
                !name.trim() ||
                !Number.isFinite(brightness) ||
                brightness < 1 ||
                brightness > 100
              }
              onClick={() => startMatching(point)}
            >
              {editingProfileId
                ? `Start editing · ${points.length} points`
                : `Start matching · ${points.length} points`}
            </Button>
            <p className="text-sm text-muted-foreground">
              To reuse a saved profile, select lights in the devices list and
              choose Apply calibration profile. Profiles work best on lamps of
              the same model.
            </p>
          </>
        )}

        {phase === 'match' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{point.label}</h3>
              <span className="text-sm text-muted-foreground">
                Point {index + 1} of {points.length}
              </span>
            </div>
            <progress
              className="h-2 w-full"
              max={points.length}
              value={points.filter((item) => item.matched).length}
              aria-label="Matching progress"
            />
            <p className="text-sm">
              Keep <strong>{referenceDevice?.name ?? referenceKey}</strong> as
              your reference. Adjust <strong>{device.name}</strong> until its
              light looks the same. Changes preview automatically.
            </p>
            {editingProfileId && (
              <p className="text-sm text-muted-foreground">
                Saved calibration values are loaded for each point as you move
                through the list. Only make changes where the physical lights
                still differ.
              </p>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={addPoint}
                >
                  Add point
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || points.length <= 1}
                  onClick={deleteCurrentPoint}
                >
                  Delete current point
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Add creates a new unique reference anchor. Delete removes the
                selected point; at least one point is required to save.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <ColorSlider
                  label="Lamp hue"
                  channel="hue"
                  color={Color.hsv(point.output.h, point.output.s * 100, 100)}
                  min={0}
                  max={359}
                  step={1}
                  value={point.output.h}
                  sliderClassName="h-12 min-h-12 touch-none"
                  disabled={busy}
                  onChange={(event) =>
                    adjust('h', event.currentTarget.valueAsNumber)
                  }
                />
                <SliderStepButtons
                  label="Lamp hue"
                  disabled={busy}
                  onStep={(delta) => stepOutput('h', delta)}
                />
                <Input
                  aria-label="Lamp hue in degrees"
                  type="number"
                  min={0}
                  max={359}
                  value={numberEdits[`${index}.h`] ?? point.output.h}
                  aria-invalid={`${index}.h` in numberEdits || undefined}
                  disabled={busy}
                  onChange={(event) =>
                    numberInput(`${index}.h`, event.target.value, 0, 359, (n) =>
                      adjust('h', n),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <ColorSlider
                  label="Lamp saturation"
                  channel="saturation"
                  color={Color.hsv(point.output.h, point.output.s * 100, 100)}
                  min={0}
                  max={100}
                  step={0.1}
                  value={point.output.s * 100}
                  sliderClassName="h-12 min-h-12 touch-none"
                  disabled={busy}
                  onChange={(event) =>
                    adjust('s', event.currentTarget.valueAsNumber / 100)
                  }
                />
                <SliderStepButtons
                  label="Lamp saturation"
                  disabled={busy}
                  onStep={(delta) => stepOutput('s', delta)}
                />
                <Input
                  aria-label="Lamp saturation percent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={
                    numberEdits[`${index}.s`] ??
                    Math.round(point.output.s * 1000) / 10
                  }
                  aria-invalid={`${index}.s` in numberEdits || undefined}
                  disabled={busy}
                  onChange={(event) =>
                    numberInput(`${index}.s`, event.target.value, 0, 100, (n) =>
                      adjust('s', n / 100),
                    )
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || !canAmendCurrentPoint}
                onClick={() => {
                  if (!currentReferenceColor) return;
                  setPreviewed(false);
                  setPoints((previous) =>
                    previous.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            reference: { ...currentReferenceColor },
                            matched: false,
                          }
                        : item,
                    ),
                  );
                }}
              >
                Use current reference state
              </Button>
              <p className="text-xs text-muted-foreground">
                {currentReferenceColor
                  ? canAmendCurrentPoint
                    ? 'Replace this point’s reference color with the HSV state currently reported by the reference light.'
                    : 'The current reference color is already used by another point.'
                  : 'The reference light is not currently reporting an HSV color.'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {invalidNumbers
                ? 'Finish the number entry: hue 0–359°, saturation 0–100%, brightness 1–100%.'
                : !sessionActive
                  ? 'Preview is stopped. Your edits are kept.'
                  : previewIssue
                    ? 'Reference unavailable. Stopping preview…'
                    : error
                      ? 'Preview needs attention. See the error above.'
                      : previewed
                        ? 'Adjustment sent. Judge the actual light, not your screen.'
                        : 'Sending adjustment…'}{' '}
              {point.reference.s === 0
                ? 'For white, increase saturation slightly if needed to correct a color tint.'
                : 'Some colors may be outside this lamp’s range; use the closest match.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || index === 0}
                onClick={() => {
                  setPreviewed(false);
                  setIndex(index - 1);
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={busy || invalidNumbers || !previewed || !!error}
                onClick={() => {
                  setPoints((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, matched: true } : item,
                    ),
                  );
                  setPreviewed(false);
                  if (index < points.length - 1) setIndex(index + 1);
                  else setPhase('review');
                }}
              >
                {index === points.length - 1
                  ? 'Looks matched · review'
                  : 'Looks matched · next'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPreviewed(false);
                  clearNumber(`${index}.h`);
                  clearNumber(`${index}.s`);
                  setPoints((previous) =>
                    previous.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            output: { ...item.reference },
                            matched: false,
                          }
                        : item,
                    ),
                  );
                }}
              >
                Reset this point
              </Button>
            </div>
          </>
        )}

        {(phase === 'match' || phase === 'review') && !sessionActive && (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-border p-3 text-sm"
          >
            <p>Your matching points are kept. Preview is stopped.</p>
            <Button
              disabled={busy || Boolean(previewIssue)}
              onClick={() => startMatching(point)}
            >
              Resume live preview
            </Button>
          </div>
        )}
        {phase !== 'setup' && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <StatePreview
              power
              color={point.reference}
              brightness={brightness / 100}
            />
            <span>Reference</span>
            <StatePreview
              power
              color={point.output}
              brightness={brightness / 100}
            />
            <span>Matched output</span>
          </div>
        )}
        {phase === 'review' && (
          <>
            <h3 className="font-semibold">
              Check the colors between your matches
            </h3>
            <p className="text-sm text-muted-foreground">
              Try these additional colors to check the blend. If one looks
              wrong, add it as a matching point. A visual match is an
              approximation, especially near the limits of a lamp’s color range.
            </p>
            <div className="flex flex-wrap gap-2">
              {verificationColors.map((check, i) => (
                <Button
                  key={check.label}
                  type="button"
                  variant={checkIndex === i ? 'default' : 'outline'}
                  disabled={busy || Boolean(previewIssue) || !sessionActive}
                  onClick={() =>
                    void run(async () => {
                      const id = session.current;
                      if (!id) throw new Error('Start a test session first');
                      await enqueue(() =>
                        request(
                          `calibration-sessions/${id}`,
                          'PUT',
                          previewBody(
                            check.color,
                            calibratedHsv(check.color, points),
                          ),
                        ),
                      );
                      setCheckIndex(i);
                    })
                  }
                >
                  {check.label}
                </Button>
              ))}
            </div>
            {checkIndex !== null && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const check = verificationColors[checkIndex];
                  const existing = points.findIndex(
                    (item) =>
                      item.reference.h === check.color.h &&
                      item.reference.s === check.color.s,
                  );
                  if (existing >= 0) setIndex(existing);
                  else {
                    setPoints([
                      ...points,
                      {
                        label: check.label,
                        reference: check.color,
                        output: calibratedHsv(check.color, points),
                        matched: false,
                      },
                    ]);
                    setIndex(points.length);
                  }
                  setPreviewed(false);
                  setPhase('match');
                }}
              >
                Improve this color
              </Button>
            )}
            <label className="block space-y-2 text-sm">
              Profile name
              <Input
                aria-label="Profile name"
                data-field="calibration_name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </label>
            <p className="text-sm">
              {points.filter((item) => item.matched).length} matched points ·{' '}
              {brightness}% brightness. Save applies this profile to{' '}
              {device.name}
              {editingProfileId
                ? ' and every light assigned to this profile'
                : ' using a new profile'}
              . Existing brightness calibration is preserved. Saving ends the
              temporary preview and reapplies the current normal-scene state
              through the profile; it does not pin the lights to the last test
              point.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setIndex(0);
                  setPhase('match');
                }}
              >
                Review matching points
              </Button>
            </div>
          </>
        )}

        {phase === 'saved' && (
          <>
            <p role="status">
              Saved “{name}” and applied it to {device.name}. The temporary
              preview has ended; normal scene state is active again and is now
              routed through this profile.
            </p>
            <p className="text-sm text-muted-foreground">
              Select other lights in the devices list to apply this profile to
              them.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNumberEdits({});
                setEditingProfileId(null);
                draft.field('id')[1](createUuid());
                setPoints(suggestedMatchingPoints());
                setIndex(0);
                setCheckIndex(null);
                setPhase('setup');
              }}
            >
              Create another profile
            </Button>
          </>
        )}
        {(phase === 'match' || phase === 'review') && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await stop();
                setCheckIndex(null);
                setPhase('setup');
              })
            }
          >
            Stop preview & restore lights
          </Button>
        )}
        <CalibrationConflict
          before={draft.value.basis}
          current={draft.conflictCatalog}
          onReview={draft.reviewLatest}
        />
        <EntitySaveBar
          inline
          draft={{
            ...draft,
            discard: () => {
              void run(async () => {
                await stop();
                draft.discard();
                setSavedNotice(false);
              });
            },
          }}
          saveDisabled={busy || phase !== 'review'}
        />
      </div>
    </ConfigFormSection>
  );
}
