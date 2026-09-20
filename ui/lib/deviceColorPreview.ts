import type { DeviceColor } from '@/bindings/DeviceColor';

/// Approximate CSS preview for a device color. Kelvin is mapped to a warm
/// ramp (2000K amber to 6500K daylight) rather than a physical conversion;
/// this is an editor aid, not a rendering contract.
export function deviceColorPreview(color?: DeviceColor): string {
  if (!color) {
    return '#888888';
  }
  if ('ct' in color) {
    const warmth = Math.min(1, Math.max(0, (color.ct - 2000) / 4500));
    const r = Math.round(255 - warmth * 20);
    const g = Math.round(180 + warmth * 55);
    const b = Math.round(120 + warmth * 135);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if ('h' in color && 's' in color) {
    return `hsl(${color.h}, ${Math.round(color.s * 100)}%, 55%)`;
  }
  return '#888888';
}
