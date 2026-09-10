import { useState } from 'react';
import type { Device } from '@/bindings/Device';
import type { ColorCalibrationPoint } from '@/bindings/ColorCalibrationPoint';
import type { Hs } from '@/bindings/Hs';
import { useDeviceColorCalibrations, useIntegrations } from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { getDeviceKey } from '@/lib/device';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { createUuid } from '@/lib/uuid';
import { seedCircadianCalibration } from '@/lib/colorCalibration';
import { ConfigFormSection } from '@/ui/config-form';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

export function DeviceColorCalibrationEditor({
  device,
  devices,
}: {
  device: Device;
  devices: Device[];
}) {
  const { data, loading, error, update, remove, refetch } =
    useDeviceColorCalibrations();
  const { data: integrations } = useIntegrations();
  const { apiEndpoint } = useAppConfig();
  const key = getDeviceKey(device);
  const saved = data.find((row) => row.device_key === key);
  const [draft, setDraft] = useState<ColorCalibrationPoint[] | null>(null);
  const points = draft ?? saved?.points ?? [];
  const [referenceProfile, setReferenceProfile] = useState('circadian');
  const [outputProfile, setOutputProfile] = useState('');
  const [referenceDevice, setReferenceDevice] = useState('');
  const [brightness, setBrightness] = useState(50);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const profiles = integrations.filter((row) => row.plugin === 'circadian');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Calibration failed');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    await update(key, { device_key: key, points });
    await refetch();
    setDraft(null);
  };
  const test = async (deviceKey: string, color: Hs) => {
    if (!Number.isFinite(brightness) || brightness < 1 || brightness > 100) {
      throw new Error('Test brightness must be between 1 and 100%.');
    }
    const response = await fetch(`${apiEndpoint}/api/v1/commands/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: createUuid(),
        device_key: deviceKey,
        power: true,
        color,
        brightness: brightness / 100,
        transition: 0,
        preserve_scene: false,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.applied)
      throw new Error(result.error ?? 'Could not test color');
  };
  const change = (
    index: number,
    side: 'reference' | 'output',
    field: 'h' | 's',
    value: number,
  ) => {
    setDraft(
      points.map((point, i) =>
        i === index
          ? { ...point, [side]: { ...point[side], [field]: value } }
          : point,
      ),
    );
  };
  return (
    <ConfigFormSection
      title="Color calibration"
      description="Match this lamp to a reference lamp using HSV colors."
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reference is the color used by scenes. Lamp output is the HSV value
          that makes this lamp look the same. Corrections blend between matching
          points; add saturated red, green, blue and intermediate colors to
          improve the match. Color temperature, XY/RGB commands and brightness
          are not calibrated.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            Reference circadian profile
            <select
              className="w-full rounded border bg-background p-2"
              value={referenceProfile}
              onChange={(event) => setReferenceProfile(event.target.value)}
            >
              <option value="">Select profile</option>
              {profiles.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Existing lamp circadian profile
            <select
              className="w-full rounded border bg-background p-2"
              value={outputProfile}
              onChange={(event) => setOutputProfile(event.target.value)}
            >
              <option value="">Select profile</option>
              {profiles.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || loading || !referenceProfile || !outputProfile}
          onClick={() => {
            try {
              const reference = profiles.find(
                (row) => row.id === referenceProfile,
              );
              const output = profiles.find((row) => row.id === outputProfile);
              if (!reference || !output)
                throw new Error('Select both profiles');
              setDraft(seedCircadianCalibration(reference, output));
              setMessage('Day and night points loaded into the draft.');
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : 'Could not load points',
              );
            }
          }}
        >
          Use day/night points (replace draft)
        </Button>
        <p className="text-sm text-muted-foreground">
          After saving, change this lamp’s scene links to the reference
          circadian profile. Keeping its old compensated profile would apply the
          correction twice. Two day/night points are only an initial
          approximation.
        </p>
        {points.map((point, index) => (
          <fieldset
            key={index}
            className="space-y-2 rounded-xl border p-3"
            disabled={busy || loading}
          >
            <legend className="px-1 text-sm">Matching point {index + 1}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['reference', 'output'] as const).map((side) => (
                <div key={side} className="space-y-2">
                  <div className="text-sm font-medium">
                    {side === 'reference' ? 'Reference' : 'Lamp output'}
                  </div>
                  <label className="block text-sm">
                    Hue (°)
                    <Input
                      type="number"
                      min={0}
                      max={359}
                      step={1}
                      value={
                        Number.isFinite(point[side].h) ? point[side].h : ''
                      }
                      onChange={(event) =>
                        change(index, side, 'h', event.target.valueAsNumber)
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    Saturation (%)
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={
                        Number.isFinite(point[side].s)
                          ? Number((point[side].s * 100).toFixed(3))
                          : ''
                      }
                      onChange={(event) =>
                        change(
                          index,
                          side,
                          's',
                          event.target.valueAsNumber / 100,
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void run(async () => {
                    await save();
                    await test(key, point.reference);
                    if (referenceDevice)
                      await test(referenceDevice, point.reference);
                    setMessage(
                      'Saved and sent test color. Adjust lamp output until the lamps match, then test again.',
                    );
                  })
                }
              >
                Save & test
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(points.filter((_, i) => i !== index))}
              >
                Remove point
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={busy || loading || points.length >= 64}
          onClick={() =>
            setDraft([
              ...points,
              { reference: { h: 0, s: 1 }, output: { h: 0, s: 1 } },
            ])
          }
        >
          Add matching point
        </Button>
        <div className="space-y-2">
          <label className="block text-sm">
            Reference lamp for testing (optional)
            <select
              className="w-full rounded border bg-background p-2"
              value={referenceDevice}
              onChange={(event) => setReferenceDevice(event.target.value)}
            >
              <option value="">Test this lamp only</option>
              {devices
                .filter(
                  (candidate) =>
                    getDeviceKey(candidate) !== key &&
                    'Controllable' in candidate.data &&
                    candidate.data.Controllable.capabilities.hs &&
                    !isDeviceReadOnly(candidate),
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
          <label className="block text-sm">
            Test brightness (%)
            <Input
              type="number"
              min={1}
              max={100}
              value={brightness}
              onChange={(event) => setBrightness(event.target.valueAsNumber)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Testing turns on the selected lamps and removes their active scene
            links. Use a fixed brightness and compare light on the same neutral
            surface. Reactivate their scenes when finished.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || loading || !!error}
            onClick={() =>
              void run(async () => {
                await save();
                setMessage(
                  'Calibration saved. It applies on the next color command.',
                );
              })
            }
          >
            Save calibration
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || loading || !!error}
            onClick={() =>
              void run(async () => {
                await remove(key);
                await refetch();
                setDraft(null);
                setMessage('Calibration removed.');
              })
            }
          >
            Reset calibration
          </Button>
          {draft && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Discard draft
            </Button>
          )}
        </div>
        {(message || error) && (
          <p role="status" className="text-sm">
            {message || error}
          </p>
        )}
      </div>
    </ConfigFormSection>
  );
}
