import { useEffect, useRef, useState } from 'react';
import Color from 'color';
import type { Device } from '@/bindings/Device';
import type { Hs } from '@/bindings/Hs';
import {
  useAssignCalibrationProfile,
  useCalibrationAssignments,
  useCalibrationProfiles,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { getDeviceKey } from '@/lib/device';
import { compareDeviceNames } from '@/lib/deviceLabel';
import { createUuid } from '@/lib/uuid';
import {
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
const selectClass =
  'w-full rounded-xl border border-input bg-background p-3 text-sm';

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

export function ColorCalibrationWizard({
  device,
  devices,
}: {
  device: Device;
  devices: Device[];
}) {
  const { apiEndpoint } = useAppConfig();
  const { data: profiles, create, update } = useCalibrationProfiles();
  const { data: assignments } = useCalibrationAssignments();
  const assign = useAssignCalibrationProfile();
  const targetKey = getDeviceKey(device);
  const currentProfile = profiles.find(
    (profile) =>
      profile.id ===
      assignments.find((row) => row.device_key === targetKey)?.profile_id,
  );
  const [phase, setPhase] = useState<Phase>('setup');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [referenceKey, setReferenceKey] = useState('');
  const [name, setName] = useState(`${device.name} color match`);
  const [brightness, setBrightness] = useState(50);
  const [points, setPoints] = useState(suggestedMatchingPoints);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState('');
  const [checkIndex, setCheckIndex] = useState<number | null>(null);
  const session = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saved = useRef<{ content: string; id: string } | null>(null);
  const point = points[index];
  const referenceDevice = devices.find(
    (candidate) => getDeviceKey(candidate) === referenceKey,
  );
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

  const enqueue = <T,>(action: () => Promise<T>): Promise<T> => {
    const next = queue.current.catch(() => undefined).then(action);
    queue.current = next;
    return next;
  };
  const request = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: method === 'DELETE',
    });
    const result = await response.json();
    if (!response.ok || !result.success)
      throw new Error(result.error ?? 'Could not contact the lights');
  };
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
  const stop = async () => {
    const id = session.current;
    if (id) {
      await enqueue(() => request(`calibration-sessions/${id}`, 'DELETE'));
      session.current = null;
    }
  };
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
        setPhase('match');
      } catch (error) {
        await stop();
        throw error;
      }
    });
  };

  const editCurrentProfile = () => {
    if (!currentProfile) return;
    setEditingProfileId(currentProfile.id);
    setName(currentProfile.name);
    setReferenceKey(currentProfile.reference_device_key ?? '');
    setBrightness(Math.round(currentProfile.brightness * 100));
    setPoints(matchingPointsFromProfile(currentProfile));
    setIndex(0);
    setCheckIndex(null);
    setPreviewed(false);
    setError('');
    saved.current = null;
    setPhase('setup');
  };

  // Requests run in order: dragging cannot make an older response overwrite a
  // newer test. Only the latest acknowledged adjustment enables Next.
  useEffect(() => {
    if (phase !== 'match' || !session.current) return;
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
                  Editing it updates every light that uses this profile.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={editCurrentProfile}
                >
                  Edit current profile
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
              <select
                className={selectClass}
                value={referenceKey}
                onChange={(event) => setReferenceKey(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose a reference light</option>
                {devices
                  .filter(
                    (candidate) =>
                      getDeviceKey(candidate) !== targetKey &&
                      canCalibrateDevice(candidate),
                  )
                  .sort(compareDeviceNames)
                  .map((candidate) => (
                    <option
                      key={getDeviceKey(candidate)}
                      value={getDeviceKey(candidate)}
                    >
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm">
              Profile name
              <Input
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
                value={Number.isFinite(brightness) ? brightness : ''}
                onChange={(event) => setBrightness(event.target.valueAsNumber)}
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
              Keep <strong>{referenceDevice?.name}</strong> as your reference.
              Adjust <strong>{device.name}</strong> until its light looks the
              same. Changes preview automatically.
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
                  value={point.output.h}
                  disabled={busy}
                  onChange={(event) => adjust('h', event.target.valueAsNumber)}
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
                  value={Math.round(point.output.s * 1000) / 10}
                  disabled={busy}
                  onChange={(event) =>
                    adjust('s', event.target.valueAsNumber / 100)
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
              {previewed
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
                disabled={busy || !previewed || !!error}
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
                  disabled={busy}
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
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </label>
            <p className="text-sm">
              {points.filter((item) => item.matched).length} matched points ·{' '}
              {brightness}% brightness. Save applies this profile to{' '}
              {device.name}. Saving ends the temporary preview and reapplies the
              current normal-scene state through the profile; it does not pin
              the lights to the last test point.
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
              <Button
                type="button"
                disabled={
                  busy || !name.trim() || points.some((item) => !item.matched)
                }
                onClick={() =>
                  void run(async () => {
                    const profile = {
                      name: name.trim(),
                      reference_device_key: referenceKey,
                      brightness: brightness / 100,
                      points: points.map(({ reference, output }) => ({
                        reference,
                        output,
                      })),
                    };
                    const content = JSON.stringify(profile);
                    const profileId = editingProfileId ?? createUuid();
                    if (
                      saved.current?.content !== content ||
                      saved.current?.id !== profileId
                    ) {
                      if (editingProfileId) {
                        await update(editingProfileId, profile);
                      } else {
                        await create({ id: profileId, ...profile });
                      }
                      saved.current = { id: profileId, content };
                    }
                    await assign.mutateAsync({
                      deviceKeys: [targetKey],
                      profileId: saved.current!.id,
                    });
                    await stop();
                    setPhase('saved');
                  })
                }
              >
                Save profile & finish
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
                setEditingProfileId(null);
                saved.current = null;
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
                setPoints(suggestedMatchingPoints());
                setIndex(0);
                setCheckIndex(null);
                setPhase('setup');
              })
            }
          >
            Cancel & restore lights
          </Button>
        )}
      </div>
    </ConfigFormSection>
  );
}
