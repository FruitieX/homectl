import type { Device } from '@/bindings/Device';
import {
  getSensorConfigRef,
  getSensorDetails,
  getSensorEventButtons,
  resolveSensorInteraction,
  type DeviceSensorConfig,
} from '@/lib/sensorInteraction';
import { useSensorHistory } from './useSensorHistory';

/** Read observed text events without changing a sensor's saved configuration. */
export function useSensorInteraction(
  device: Device,
  config?: DeviceSensorConfig | null,
) {
  const sensor = getSensorDetails(device);
  const history = useSensorHistory(
    sensor.kind === 'text' ? getSensorConfigRef(device) : '',
  );
  const values = [
    sensor.value,
    ...(history.data ?? []).map((entry) => entry.value),
  ];
  const interaction = resolveSensorInteraction(device, config, values);
  return {
    sensor,
    interaction,
    eventButtons: getSensorEventButtons(interaction, values),
  };
}
