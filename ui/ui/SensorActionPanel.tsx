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
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';
import { useEffect, useState } from 'react';

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
    throw new Error(
      'Sensor update was accepted but no device state was returned',
    );
  }
};

const controlButtonClass = 'h-16 min-h-16 rounded-2xl text-sm font-semibold';

export function SensorActionPanel({ device, sensorConfig }: Props) {
  const { apiEndpoint } = useAppConfig();
  const [customPayload, setCustomPayload] = useState('{}');
  const [numberValue, setNumberValue] = useState('0');
  const [textValue, setTextValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensor = getSensorDetails(device);
  const resolvedInteraction = resolveSensorInteraction(device, sensorConfig);
  const sensorPayloadJson = stringifySensorPayload(sensor.payload);
  const initialNumberValue =
    sensor.kind === 'number'
      ? String(sensor.value)
      : sensor.kind === 'state' && typeof sensor.value.brightness === 'number'
        ? String(sensor.value.brightness)
        : '0';
  const initialTextValue = sensor.kind === 'text' ? sensor.value : '';

  useEffect(() => {
    setCustomPayload(sensorPayloadJson);
    setNumberValue(initialNumberValue);
    setTextValue(initialTextValue);
    setError(null);
  }, [device.id, initialNumberValue, initialTextValue, sensorPayloadJson]);

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
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to send sensor payload',
      );
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
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to pulse sensor',
      );
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
      value: getSensorButtonValue(
        resolvedInteraction.kind,
        button,
        resolvedInteraction.config,
      ),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide opacity-70">
        <Badge variant="outline">
          {getSensorInteractionLabel(resolvedInteraction.kind)}
        </Badge>
        <Badge variant="outline">
          {resolvedInteraction.source === 'saved'
            ? 'Saved mapping'
            : 'Auto detected'}
        </Badge>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-5 text-sm">
          <div className="font-medium">Current sensor payload</div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {sensorPayloadJson}
          </pre>
        </CardContent>
      </Card>

      {resolvedInteraction.kind === 'on_off_buttons' && (
        <div className="space-y-2">
          <div className="font-medium">Button panel</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('on')}
            >
              On
            </Button>
            <Button
              variant="outline"
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('off')}
            >
              Off
            </Button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'hue_dimmer' && (
        <div className="space-y-2">
          <div className="font-medium">Hue dimmer</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('on')}
            >
              On
            </Button>
            <Button
              variant="outline"
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('up')}
            >
              Dim Up
            </Button>
            <Button
              variant="outline"
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('down')}
            >
              Dim Down
            </Button>
            <Button
              variant="secondary"
              className={controlButtonClass}
              disabled={submitting}
              onClick={() => void runConfiguredButton('off')}
            >
              Off
            </Button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'boolean' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => void runAction({ value: true })}
            >
              Set On
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void runAction({ value: false })}
            >
              Set Off
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={submitting}
              onClick={() => void runBooleanPulse()}
            >
              Pulse
            </Button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'number' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              className="w-32"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={submitting}
              onClick={() =>
                void runAction({ value: Number(numberValue) || 0 })
              }
            >
              Send Value
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() =>
                setNumberValue(String((Number(numberValue) || 0) - 1))
              }
            >
              -1
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() =>
                setNumberValue(String((Number(numberValue) || 0) + 1))
              }
            >
              +1
            </Button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'text' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              className="min-w-48 flex-1"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => void runAction({ value: textValue })}
            >
              Send Text
            </Button>
          </div>
        </div>
      )}

      {resolvedInteraction.kind === 'state' && (
        <div className="space-y-2">
          <div className="font-medium">Quick actions</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true })}
            >
              Power On
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: false })}
            >
              Power Off
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() =>
                void runStatePatch({ power: true, brightness: 0.25 })
              }
            >
              Dim 25%
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() =>
                void runStatePatch({ power: true, brightness: 0.5 })
              }
            >
              Dim 50%
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void runStatePatch({ power: true, brightness: 1 })}
            >
              Dim 100%
            </Button>
          </div>
        </div>
      )}

      <details className="rounded-2xl border border-border bg-muted/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Advanced JSON trigger
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-4">
          <Textarea
            className="h-40 font-mono text-xs"
            value={customPayload}
            onChange={(e) => setCustomPayload(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              disabled={submitting}
              onClick={() => {
                let payload: unknown;
                try {
                  payload = JSON.parse(customPayload);
                } catch {
                  setError('Invalid JSON payload');
                  return;
                }

                void runAction(payload);
              }}
            >
              {submitting ? 'Sending…' : 'Send JSON'}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
