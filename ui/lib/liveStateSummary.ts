import type { ControllableState } from '../bindings/ControllableState';
import type { DeviceColor } from '../bindings/DeviceColor';

const colorKey = (color: DeviceColor | null) =>
  color == null
    ? 'null'
    : JSON.stringify(
        Object.entries(color).sort(([a], [b]) => a.localeCompare(b)),
      );

/** Aggregate only states actually known; never present an average as a shared value. */
export function summarizeLiveStates(
  states: ReadonlyArray<ControllableState | undefined>,
) {
  const known = states.filter((state): state is ControllableState => !!state);
  const first = known[0];
  if (!first)
    return { certainty: 'unresolved' as const, reason: 'No state available' };
  const complete = known.length === states.length;
  const samePower = complete && known.every((s) => s.power === first.power);
  const sameBrightness =
    complete && known.every((s) => s.brightness === first.brightness);
  const sameColor =
    complete && known.every((s) => colorKey(s.color) === colorKey(first.color));
  return {
    certainty:
      samePower && sameBrightness && sameColor
        ? ('known' as const)
        : ('mixed' as const),
    power: samePower ? first.power : null,
    brightness: sameBrightness ? first.brightness : null,
    color: sameColor ? first.color : null,
    samples: known
      .flatMap((s) => (s.power && s.color ? [s.color] : []))
      .slice(0, 3),
  };
}
