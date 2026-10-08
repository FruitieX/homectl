import { useState } from 'react';
import {
  Power,
  Plus,
  Minus,
  ArrowUp,
  ArrowDown,
  X,
  SlidersHorizontal,
  LoaderCircle,
} from 'lucide-react';
import type { LightHold } from '@/lib/lightQuickAdjust';
import type { Device } from '@/bindings/Device';
import { useAppConfig } from '@/hooks/appConfig';
import { useConnectionStatus } from '@/hooks/websocket';
import { useSensorInteraction } from '@/hooks/useSensorInteraction';
import {
  getSensorButtonValue,
  type DeviceSensorConfig,
} from '@/lib/sensorInteraction';
import { sendSensorPayload } from './SensorActionPanel';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { QuickControlShell } from './QuickControlShell';
export function SensorQuickPopover({
  device,
  anchor,
  hold,
  onClose,
  onDetails,
  sensorConfig,
}: {
  device: Device;
  anchor: { x: number; y: number };
  hold?: LightHold;
  onClose: () => void;
  onDetails: () => void;
  sensorConfig?: DeviceSensorConfig | null;
}) {
  const { apiEndpoint } = useAppConfig();
  const connected = useConnectionStatus() === 'connected';
  const { sensor, interaction, eventButtons } = useSensorInteraction(
    device,
    sensorConfig,
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [text, setText] = useState(sensor.kind === 'text' ? sensor.value : ''),
    [number, setNumber] = useState(
      sensor.kind === 'number' ? String(sensor.value) : '0',
    );
  const send = async (payload: unknown) => {
    if (pending || !connected) return;
    setPending(true);
    setError('');
    try {
      await sendSensorPayload(apiEndpoint, device, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sensor event failed');
    } finally {
      setPending(false);
    }
  };
  const powered = sensor.kind === 'boolean' && sensor.value;
  const buttons =
    interaction.kind === 'hue_dimmer'
      ? (['on', 'up', 'down', 'off'] as const)
      : interaction.kind === 'on_off_buttons'
        ? (['on', 'off'] as const)
        : [];
  return (
    <QuickControlShell
      anchor={anchor}
      autoFocus={!hold}
      onClose={onClose}
      aria-label={`${device.name} sensor quick controls`}
      aria-busy={pending}
      className="w-52 max-h-[calc(100dvh-24px)] overflow-y-auto"
    >
      <div className="mb-2 flex items-center justify-between rounded-full bg-card/95 pl-3 shadow-md">
        <strong className="truncate text-xs">{device.name}</strong>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close sensor quick controls"
          data-autofocus
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {eventButtons.length > 0 || interaction.kind === 'text' ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card/95 p-2 shadow-lg">
          {eventButtons.map((event) => (
            <Button
              key={event.value}
              variant="ghost"
              className="h-auto min-h-10 w-full justify-between gap-2 whitespace-normal text-left"
              disabled={pending || !connected}
              aria-label={`Send ${event.label} sensor event`}
              onClick={() => void send({ value: event.value })}
            >
              <span>{event.label}</span>
              <span className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
                {event.value}
              </span>
            </Button>
          ))}
          {interaction.kind === 'text' && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void send({ value: text });
              }}
            >
              <Input
                aria-label="Sensor text value"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button type="submit" disabled={pending || !connected}>
                Send
              </Button>
            </form>
          )}
        </div>
      ) : buttons.length > 0 ? (
        <div className="mx-auto flex w-16 flex-col gap-1 rounded-full border border-border bg-card/95 p-1 shadow-lg">
          {buttons.map((name) => (
            <Button
              key={name}
              variant="ghost"
              size="icon"
              className="size-14 rounded-full bg-card"
              disabled={pending || !connected}
              aria-label={`Send ${name} sensor event`}
              onClick={() => {
                if (
                  interaction.kind === 'hue_dimmer' ||
                  interaction.kind === 'on_off_buttons'
                )
                  void send({
                    value: getSensorButtonValue(
                      interaction.kind,
                      name,
                      interaction.config,
                    ),
                  });
              }}
            >
              {name === 'on' ? (
                <Power />
              ) : name === 'off' ? (
                <Power className="text-muted-foreground" />
              ) : name === 'up' ? (
                <ArrowUp />
              ) : (
                <ArrowDown />
              )}
            </Button>
          ))}
        </div>
      ) : interaction.kind === 'boolean' ? (
        <Button
          size="icon"
          className="mx-auto flex size-20 rounded-full"
          variant={powered ? 'default' : 'outline'}
          aria-label={`Set ${device.name} ${powered ? 'off' : 'on'}`}
          disabled={pending || !connected}
          onClick={() => void send({ value: !powered })}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <Power />}
        </Button>
      ) : interaction.kind === 'number' ? (
        <form
          className="space-y-2 rounded-2xl border border-border bg-card/95 p-3 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            if (number.trim() && Number.isFinite(Number(number)))
              void send({ value: Number(number) });
          }}
        >
          <Input
            aria-label="Sensor numeric value"
            type="number"
            step="any"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Decrease sensor value"
              disabled={pending || !connected}
              onClick={() => {
                const v = Number(number) - 1;
                if (Number.isFinite(v)) {
                  setNumber(String(v));
                  void send({ value: v });
                }
              }}
            >
              <Minus />
            </Button>
            <Button
              className="flex-1"
              type="submit"
              disabled={pending || !connected}
            >
              Send
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Increase sensor value"
              disabled={pending || !connected}
              onClick={() => {
                const v = Number(number) + 1;
                if (Number.isFinite(v)) {
                  setNumber(String(v));
                  void send({ value: v });
                }
              }}
            >
              <Plus />
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl bg-card/95 p-3 text-xs text-muted-foreground shadow-md">
          Open details for this sensor's full controls.
        </p>
      )}
      {pending && (
        <span role="status" className="sr-only">
          Sending event…
        </span>
      )}
      {!connected && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Reconnecting…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        className="mt-3 w-full rounded-full bg-card/95 shadow-md"
        variant="ghost"
        onClick={() => {
          onClose();
          onDetails();
        }}
      >
        <SlidersHorizontal />
        Sensor details
      </Button>
    </QuickControlShell>
  );
}
