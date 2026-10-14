/** Shared light-glow styling for the Pixi renderer and static SVG thumbnails. */

/** Radial falloff of a light's glow, from its centre (0) to its radius (1). */
export const lightGradientStops: ReadonlyArray<
  readonly [offset: number, opacity: number]
> = [
  [0, 1],
  [0.18, 0.72],
  [0.48, 0.28],
  [0.78, 0.07],
  [1, 0],
];

function srgbToLinear(component: number) {
  const normalized = Math.max(0, Math.min(255, component)) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(component: number) {
  const clamped = Math.max(0, component);
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, encoded * 255));
}

/** Glow colour for a light, tone mapped so bright lights don't clip to white. */
export function toneMapLightRgb(
  rgb: readonly [number, number, number],
  intensity: number,
): [number, number, number] {
  const exposure = 0.65 + intensity * 0.55;
  const toneMapped = rgb.map((component) => {
    const linear = srgbToLinear(component) * exposure;
    return linearToSrgb(linear / (1 + linear));
  });

  return [toneMapped[0] ?? 0, toneMapped[1] ?? 0, toneMapped[2] ?? 0];
}

export function getLightAlpha(intensity: number) {
  return Math.min(0.58, 0.14 + intensity * 0.36);
}
