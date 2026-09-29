import type { DeviceColor } from '@/bindings/DeviceColor';
import { colorToRgb, getColorMode } from '@/lib/deviceColor';
/** Hue stays readable; the separate arc encodes brightness instead of blackening it. */
export function StatePreview({
  color,
  brightness,
  power,
  label,
  source,
  certainty = 'known',
  reason,
  samples,
  size = 30,
}: {
  color?: DeviceColor | null;
  brightness?: number | null;
  power?: boolean | null;
  label?: string;
  source?: string;
  size?: number;
  certainty?: 'known' | 'unchanged' | 'mixed' | 'unresolved';
  reason?: string;
  samples?: DeviceColor[];
}) {
  const knownColor = color && getColorMode(color) ? colorToRgb(color) : null;
  const fill = knownColor
    ? `rgb(${knownColor.r}, ${knownColor.g}, ${knownColor.b})`
    : 'hsl(var(--muted))';
  const level =
    brightness !== undefined &&
    brightness !== null &&
    Number.isFinite(brightness)
      ? Math.max(0, Math.min(1, brightness))
      : null;
  const colorDescription =
    color && 'ct' in color
      ? `${Math.round(color.ct)} K`
      : color && 'h' in color
        ? `Hue ${Math.round(color.h)}°, saturation ${Math.round(color.s * 100)}%`
        : color && 'r' in color
          ? `RGB ${color.r}, ${color.g}, ${color.b}`
          : color && 'x' in color
            ? `XY ${color.x}, ${color.y}`
            : 'Color not specified';
  const description =
    (source ? `${source}: ` : '') +
    (label ??
      (certainty === 'unresolved'
        ? `Unresolved${reason ? ': ' + reason : ''}`
        : certainty === 'unchanged'
          ? 'Unchanged'
          : certainty === 'mixed'
            ? 'Mixed states'
            : `${power === false ? 'Off' : power === true ? 'On' : 'Power not specified'} · ${level === null ? 'Brightness not specified' : `${Math.round(level * 100)}% brightness`} · ${colorDescription}`));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={description}
      className="shrink-0"
    >
      <title>{description}</title>
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        stroke="currentColor"
        className="text-muted-foreground/20"
        strokeWidth="2.5"
        strokeDasharray={
          certainty === 'unresolved' || certainty === 'unchanged'
            ? '2 3'
            : undefined
        }
      />
      {certainty === 'known' && level !== null && (
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="currentColor"
          className={power === false ? 'text-muted-foreground' : 'text-primary'}
          strokeWidth="2.5"
          pathLength="100"
          strokeDasharray={`${level * 100} 100`}
          transform="rotate(-90 16 16)"
          strokeLinecap={level > 0 ? 'round' : 'butt'}
        />
      )}
      <circle
        cx="16"
        cy="16"
        r="9"
        fill={
          power === false || certainty !== 'known' ? 'hsl(var(--muted))' : fill
        }
        stroke="currentColor"
        strokeWidth=".5"
        className="text-foreground/20"
      />
      {certainty === 'mixed' &&
        (samples ?? []).slice(0, 3).map((sample, index) => {
          const rgb = colorToRgb(sample);
          return (
            <circle
              key={index}
              cx={10 + index * 6}
              cy="16"
              r="4.5"
              fill={`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`}
              stroke="hsl(var(--background))"
              strokeWidth="1"
            />
          );
        })}
      {certainty === 'unresolved' && (
        <text
          x="16"
          y="20"
          textAnchor="middle"
          fill="currentColor"
          fontSize="12"
        >
          ?
        </text>
      )}
      {power === false && (
        <path
          d="M10 22L22 10"
          stroke="hsl(var(--foreground))"
          strokeWidth="1.5"
        />
      )}
      {certainty === 'known' && level === null && (
        <circle cx="16" cy="3" r="1.5" fill="hsl(var(--muted-foreground))" />
      )}
    </svg>
  );
}
