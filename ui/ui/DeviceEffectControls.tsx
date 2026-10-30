import type { Device } from '@/bindings/Device';
import { useLiveDeviceLook } from '@/hooks/useLiveDeviceControls';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import {
  commonEffects,
  deviceColorSlots,
  sharedEffect,
  withColorSlot,
} from '@/lib/deviceEffects';
import { SceneColorControl } from '@/ui/settings/SceneColorControl';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';

/**
 * Effect (preset) picker and per-slot colors for devices that report them.
 * Renders nothing for ordinary single-color lights.
 */
export function DeviceEffectControls({
  devices,
  connected,
}: {
  devices: Device[];
  connected: boolean;
}) {
  const setLook = useLiveDeviceLook();
  const writable = devices.filter(
    (device) => 'Controllable' in device.data && !isDeviceReadOnly(device),
  );
  const capabilities = writable.flatMap((device) =>
    'Controllable' in device.data
      ? [device.data.Controllable.capabilities]
      : [],
  );
  const effects = commonEffects(capabilities);
  const withEffects = writable.filter((device) =>
    effects.some((effect) =>
      'Controllable' in device.data
        ? device.data.Controllable.capabilities.effects?.includes(effect)
        : false,
    ),
  );
  const current = sharedEffect(withEffects);
  // Extra color slots are edited per device, like a device's own color.
  const single = writable.length === 1 ? writable[0] : undefined;
  const slots = deviceColorSlots(single);
  if (!effects.length && slots.length < 2) return null;
  return (
    <div className="space-y-3">
      {effects.length > 0 && (
        <label className="block text-sm">
          <span className="mb-1 block">Effect</span>
          <SettingsSelect
            aria-label="Effect"
            className="w-full"
            disabled={!connected}
            value={current && current !== 'mixed' ? current : ''}
            placeholder={current === 'mixed' ? 'Mixed' : 'Custom'}
            onValueChange={(effect) =>
              void Promise.all(
                withEffects.map((device) => setLook(device, { effect })),
              )
            }
            options={effects.map((effect) => ({
              value: effect,
              label: effect,
            }))}
          />
        </label>
      )}
      {single && slots.length > 1 && (
        <div>
          <span className="mb-1 block text-sm">Effect colors</span>
          <div className="grid grid-cols-2 gap-2">
            {slots.map((color, index) => (
              <SceneColorControl
                key={index}
                field={`effect-color-${index}`}
                color={color}
                capabilities={capabilities}
                onChange={(next) => {
                  if (connected && next)
                    void setLook(single, {
                      colors: withColorSlot(slots, index, next),
                    });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
