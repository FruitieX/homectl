import { Device } from '@/bindings/Device';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DeviceSensorConfig,
  getSensorButtonValue,
  getSensorDetails,
  getSensorInteractionLabel,
  resolveSensorInteraction,
  stringifySensorPayload,
} from '@/lib/sensorInteraction';
import { useEffect, useMemo, useState } from 'react';

type Props = {
  device: Device;
  sensorConfig?: DeviceSensorConfig | null;
};

const sendSensorPayload = async (
  apiEndpoint: string,
  device: Device,
  payload: unknown,
) => {
  const response = await fetch(
    `${apiEndpoint}/api/v1/devices/${encodeURIComponent(device.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: device.id,
        name: device.name,
        integration_id: device.integration_id,
        data: { Sensor: payload },
        raw: null,
      }),
    },
  );

  const result = (await response.json()) as {
    devices?: unknown[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || 'Failed to send sensor payload');
  }

  if (!Array.isArray(result.devices) || result.devices.length === 0) {
    throw new Error('Sensor update was accepted but no device state was returned');
  }
};

const controlButtonClass =
  'btn h-16 min-h-16 border-base-300 bg-base-100 text-sm font-semibold shadow-sm hover:border-primary';

export function SensorActionPanel({ device, sensorConfig }: Props) {
  const { apiEndpoint } = useAppConfig();
  const [customPayload, setCustomPayload] = useState('{}');
  const [numberValue, setNumberValue] = useState('0');
  const [textValue, setTextValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensor = useMemo(() => getSensorDetails(device), [device]);
  const resolvedInteraction = useMemo(
    () => resolveSensorInteraction(device, sensorConfig),
    [device, sensorConfig],
  );

  useEffect(() => {
    setCustomPayload(stringifySensorPayload(sensor.payload));
    setNumberValue(
      sensor.kind === 'number'
        ? String(sensor.value)
        : sensor.kind === 'state' && typeof sensor.value.brightness === 'number'
          ? String(sensor.value.brightness)
          : '0',
    );
    setTextValue(sensor.kind === 'text' ? sensor.value : '');
    setError(null);
  }, [device, sensor]);

  const runAction = async (payload: unknown) => {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sendSensorPayload(apiEndpoint, device, payload);
      setCustomPayload(stringifySensorPayload(payload));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to send sensor payload');
    } finally {
      setSubmitting(false);
    }
  };

  const runBooleanPulse = async () => {
    if (sensor.kind !== 'boolean' || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sendSensorPayload(apiEndpoint, device, { value: true });
      await sendSensorPayload(apiEndpoint, device, { value: false });
      setCustomPayload(stringifySensorPayload({ value: false }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to pulse sensor');
    } finally {
      setSubmitting(false);
    }
  };

  const runStatePatch = async (patch: Record<string, unknown>) => {
    if (sensor.kind !== 'state') {
      return;
    }

    await runAction({ ...sensor.value, ...patch });
  };

  const runConfiguredButton = async (button: 'on' | 'off' | 'up' | 'down') => {
    if (
      resolvedInteraction.kind !== 'on_off_buttons' &&
      resolvedInteraction.kind !== 'hue_dimmer'
    ) {
      return;
    }

    await runAction({
      value: getSensorButtonValue(resolvedInteraction.kind, button, resolvedInteraction.config),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide opacity-70">
        <span className="badge badge-outline">{getSensorInteractionLabel(resolvedInteraction.kind)}</span>
        <span className="badge badge-outline">
          {resolvedInteraction.source === 'saved' ? 'Saved mapping' : 'Auto detected'}
        </span>
      </div>

      {error && (
        <div className="alert alert-error py-2">
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-lg bg-base-200 p-3 text-sm">
        <div className="font-medium">Current sensor payload</div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs opacity-80">
          {stringifySensorPayload(sensor.payload)}
        </pre>
      </div>

      {resolvedInteraction.kind === 'on_off_buttons' && (
        <div className="space-y-2">
          <div className="font-medium">Button panel</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className={`${controlButtonClass} btn-primary`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('on')}
            >
              On
            </button>
            <button
              className={`${controlButtonClass} btn-outline`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('off')}
            >
              Off
            </button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'hue_dimmer' && (
        <div className="space-y-2">
          <div className="font-medium">Hue dimmer</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className={`${controlButtonClass} btn-primary`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('on')}
            >
              On
            </button>
            <button
              className={`${controlButtonClass} btn-outline`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('up')}
            >
              Dim Up
            </button>
            <button
              className={`${controlButtonClass} btn-outline`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('down')}
            >
              Dim Down
            </button>
            <button
              className={`${controlButtonClass} btn-secondary`}
              disabled={submitting}
              onClick={() => void runConfiguredButton('off')}
            >
              Off
            </button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'boolean' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={submitting}
              onClick={() => void runAction({ value: true })}
            >
              Set On
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => void runAction({ value: false })}
            >
              Set Off
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={submitting}
              onClick={() => void runBooleanPulse()}
            >
              Pulse
            </button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'number' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              className="input input-bordered input-sm w-32"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={submitting}
              onClick={() => void runAction({ value: Number(numberValue) || 0 })}
            >
              Send Value
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => setNumberValue(String((Number(numberValue) || 0) - 1))}
            >
              -1
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => setNumberValue(String((Number(numberValue) || 0) + 1))}
            >
              +1
            </button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'text' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={submitting}
              onClick={() => void runAction({ value: textValue })}
            >
              Send Text
            </button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'state' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true })}
            >
              Power On
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: false })}
            >
              Power Off
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true, brightness: 0.25 })}
            >
              Dim 25%
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true, brightness: 0.5 })}
            >
              Dim 50%
            </button>
            <button
              className="btn btn-sm btn-outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true, brightness: 1 })}
            >
              Dim 100%
            </button>
          </div>
        </div>
      )}

      <details className="collapse collapse-arrow bg-base-200">
        <summary className="collapse-title px-4 py-3 text-sm font-medium">
          Advanced JSON trigger
        </summary>
        <div className="collapse-content space-y-3 px-4 pb-4">
          <textarea
            className="textarea textarea-bordered h-40 w-full font-mono text-xs"
            value={customPayload}
            onChange={(e) => setCustomPayload(e.target.value)}
          />
          <div className="flex justify-end">
            <button
              className={`btn btn-primary ${submitting ? 'loading' : ''}`}
              disabled={submitting}
              onClick={() => {
                try {
                  const payload = JSON.parse(customPayload) as unknown;
                  void runAction(payload);
                } catch {
                  setError('Invalid JSON payload');
                }
              }}
            >
              Send JSON
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}