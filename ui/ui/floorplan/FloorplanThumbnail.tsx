import type { FloorplanScene } from '@/lib/floorplan-scene';
import { reachabilityLabels } from '@/lib/deviceReachability';
import { sensorMarkerPaths } from '@/lib/sensorMarker';

/** Lightweight static preview: no GPU context per room and no blurry canvas scaling. */
export function FloorplanThumbnail({
  scene,
  bounds,
  label,
}: {
  scene: FloorplanScene;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  label: string;
}) {
  const view = bounds ?? {
    x: 0,
    y: 0,
    width: scene.width,
    height: scene.height,
  };
  const radius = Math.max(view.width, view.height) * 0.028;
  const colors = {
    empty: 'transparent',
    floor: 'hsl(var(--muted))',
    wall: 'hsl(var(--muted-foreground))',
    door: '#b69b73',
    window: '#86b9c9',
  };
  return (
    <svg
      className="size-full"
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      role="img"
      aria-label={label}
    >
      {scene.backgroundImage && (
        <image
          href={scene.backgroundImage.src}
          width={scene.width}
          height={scene.height}
        />
      )}
      {scene.tiles
        .filter((tile) => tile.type !== 'empty')
        .map((tile, index) => (
          <rect
            key={index}
            x={tile.x}
            y={tile.y}
            width={tile.width}
            height={tile.height}
            fill={colors[tile.type]}
            opacity={
              tile.type === 'floor' && scene.backgroundImage
                ? 0.08
                : tile.type === 'wall'
                  ? 0.7
                  : 1
            }
          />
        ))}
      {scene.lights.map((light) => {
        const disabled = light.health === 'disabled';
        const attention =
          light.health === 'offline' ||
          light.health === 'stale' ||
          light.health === 'unknown';
        const level =
          light.power && !disabled
            ? Math.max(0, Math.min(1, light.intensity))
            : 0;
        const color = disabled
          ? 'hsl(var(--muted-foreground))'
          : `rgb(${light.color.join(',')})`;
        return (
          <g
            key={light.deviceKey}
            transform={`translate(${light.x} ${light.y})`}
          >
            <title>
              {light.label ?? light.deviceKey} ·{' '}
              {disabled
                ? 'Disabled'
                : light.power
                  ? `${Math.round(level * 100)}%`
                  : 'Off'}
              {!disabled && light.health && light.health !== 'online'
                ? ` · ${reachabilityLabels[light.health]}`
                : ''}
            </title>
            <circle r={radius * 1.4} fill="hsl(var(--card))" />
            <circle
              r={radius}
              fill={light.power && !disabled ? color : 'hsl(var(--muted))'}
            />
            <circle
              r={radius * 1.3}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={radius * 0.22}
            />
            <circle
              r={radius * 1.3}
              fill="none"
              stroke={color}
              strokeWidth={radius * 0.22}
              pathLength={100}
              strokeDasharray={`${level * 100} 100`}
              transform="rotate(-90)"
            />
            {disabled && (
              <path
                d={`M ${-radius} ${radius} L ${radius} ${-radius}`}
                stroke={color}
                strokeWidth={radius * 0.25}
              />
            )}
            {attention && (
              <circle
                cx={radius}
                cy={-radius}
                r={radius * 0.45}
                fill="#f59e0b"
                stroke="hsl(var(--card))"
                strokeWidth={radius * 0.15}
              />
            )}
          </g>
        );
      })}
      {scene.sensors.map((sensor) => (
        <g
          key={sensor.deviceKey}
          transform={`translate(${sensor.x} ${sensor.y})`}
        >
          <title>
            {sensor.label} {sensor.statusLabel ?? ''}
          </title>
          <rect
            x={-radius}
            y={-radius}
            width={radius * 2}
            height={radius * 2}
            rx={radius * 0.45}
            fill="#172027"
            stroke="hsl(var(--card))"
            strokeWidth={radius * 0.15}
          />
          <g
            transform={`scale(${(radius * 1.5) / 24}) translate(-12 -12)`}
            fill="none"
            stroke="#d7eee6"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {sensorMarkerPaths[sensor.markerKind ?? 'unknown'].map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
