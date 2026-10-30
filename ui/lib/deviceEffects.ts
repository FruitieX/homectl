import type { Capabilities } from '@/bindings/Capabilities';
import type { Device } from '@/bindings/Device';
import type { DeviceColor } from '@/bindings/DeviceColor';

/**
 * Effects (presets) and multi-color slots reported by devices such as LED
 * animation controllers. Kept free of UI imports so node tests can load it.
 */

function controllableOf(device: Device | undefined) {
  const data = device?.data as Record<string, unknown> | undefined;
  return (
    (data?.['Controllable'] as
      | {
          capabilities: Capabilities;
          state: { effect?: string; colors?: DeviceColor[] };
        }
      | undefined) ?? null
  );
}

/** Effects every given capability set offers, in the first set's order. */
export function commonEffects(capabilities: Capabilities[]): string[] {
  const lists = capabilities
    .map((cap) => cap.effects ?? [])
    .filter((list) => list.length > 0);
  if (!lists.length) return [];
  return lists[0].filter((effect) =>
    lists.every((list) => list.includes(effect)),
  );
}

export function deviceEffects(device: Device | undefined): string[] {
  return controllableOf(device)?.capabilities.effects ?? [];
}

export function deviceEffect(device: Device | undefined): string | null {
  return controllableOf(device)?.state.effect ?? null;
}

export function deviceColorSlots(device: Device | undefined): DeviceColor[] {
  return controllableOf(device)?.state.colors ?? [];
}

/**
 * The effect shared by every device, `null` when they show a customised
 * look (no named effect), or `'mixed'` when they differ.
 */
export function sharedEffect(devices: Device[]): string | null | 'mixed' {
  const effects = devices.map(deviceEffect);
  if (!effects.length) return null;
  return effects.every((effect) => effect === effects[0])
    ? effects[0]
    : 'mixed';
}

/**
 * Replace one color slot. Missing earlier slots are filled from `fallback`
 * (for example the device's reported colors) so the list never has holes.
 */
export function withColorSlot(
  colors: DeviceColor[] | undefined,
  index: number,
  color: DeviceColor,
  fallback: DeviceColor[] = [],
): DeviceColor[] {
  const next = [...(colors ?? [])];
  for (let slot = next.length; slot < index; slot++)
    next.push(fallback[slot] ?? color);
  next[index] = color;
  return next;
}
