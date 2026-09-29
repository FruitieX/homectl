import type { Device } from '@/bindings/Device';
import type { ControllableState } from '@/bindings/ControllableState';
import { summarizeLiveStates } from '@/lib/liveStateSummary';
import { StatePreview } from '@/ui/settings/StatePreview';

export function LiveStatePreview({
  states,
  size = 36,
}: {
  states: ReadonlyArray<ControllableState | undefined>;
  size?: number;
}) {
  return <StatePreview {...summarizeLiveStates(states)} size={size} />;
}

export function devicePreviewState(
  device: Device,
): ControllableState | undefined {
  if ('Controllable' in device.data)
    return device.data.Controllable.disabled
      ? undefined
      : device.data.Controllable.state;
  return 'power' in device.data.Sensor ? device.data.Sensor : undefined;
}
