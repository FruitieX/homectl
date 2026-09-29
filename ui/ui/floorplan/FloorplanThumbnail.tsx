import type { FloorplanScene } from '@/lib/floorplan-scene';

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
        const level = light.power
          ? Math.max(0, Math.min(1, light.intensity))
          : 0;
        const color = `rgb(${light.color.join(',')})`;
        return (
          <g
            key={light.deviceKey}
            transform={`translate(${light.x} ${light.y})`}
          >
            <title>
              {light.label ?? light.deviceKey} ·{' '}
              {light.power ? `${Math.round(level * 100)}%` : 'Off'}
            </title>
            <circle r={radius * 1.4} fill="hsl(var(--card))" />
            <circle
              r={radius}
              fill={light.power ? color : 'hsl(var(--muted))'}
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
          <circle
            r={radius * 0.7}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth={radius * 0.25}
          />
        </g>
      ))}
    </svg>
  );
}
