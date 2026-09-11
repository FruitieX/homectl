import { useEffect, useRef, useState } from 'react';
import type { Device } from '@/bindings/Device';
import type { Hs } from '@/bindings/Hs';
import {
  useAssignCalibrationProfile,
  useCalibrationAssignments,
  useCalibrationProfiles,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { getDeviceKey } from '@/lib/device';
import { createUuid } from '@/lib/uuid';
import {
  calibratedHsv,
  canAmendReferencePoint,
  canCalibrateDevice,
  getCurrentHsColor,
  matchingPointsFromProfile,
  suggestedMatchingPoints,
  verificationColors,
} from '@/lib/colorCalibration';
import { ConfigFormSection } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

type Phase = 'setup' | 'match' | 'review' | 'saved';
const selectClass =
  'w-full rounded-xl border border-input bg-background p-3 text-sm';

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
            <label className="block space-y-2 text-sm">
              Test brightness (%)
              <Input
                type="number"
                min={1}
                max={100}
                value={Number.isFinite(brightness) ? brightness : ''}
                onChange={(event) => setBrightness(event.target.valueAsNumber)}
                disabled={busy}
              />
            </label>
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
              onClick={() =>
                void run(async () => {
                  const id = createUuid();
                  session.current = id;
                  try {
                    await enqueue(() =>
                      request(
                        `calibration-sessions/${id}`,
                        'POST',
                        previewBody(point.reference, point.output),
                      ),
                    );
                    setPhase('match');
                  } catch (error) {
                    await stop();
                    throw error;
                  }
                })
              }
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
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                Lamp hue · {point.output.h}°
                <input
                  aria-label="Lamp hue"
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={point.output.h}
                  className="h-12 min-h-12 w-full touch-none accent-primary"
                  disabled={busy}
                  onChange={(event) => adjust('h', event.target.valueAsNumber)}
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
              </label>
              <label className="space-y-2 text-sm">
                Lamp saturation · {Math.round(point.output.s * 1000) / 10}%
                <input
                  aria-label="Lamp saturation"
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={point.output.s * 100}
                  className="h-12 min-h-12 w-full touch-none accent-primary"
                  disabled={busy}
                  onChange={(event) =>
                    adjust('s', event.target.valueAsNumber / 100)
                  }
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
              </label>
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
              {device.name}. Other lights can be selected together in the
              devices list.
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
              Saved “{name}” and applied it to {device.name}. Both lights have
              returned to normal control.
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
