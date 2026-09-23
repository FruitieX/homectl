/**
 * Hue/saturation to 0–255 RGB bytes.
 *
 * `hsToRgb` in colorCalibration returns the same hue/saturation scaled to 0..1.
 * The floorplan renderer (and the stored device colours) read tuples as 0–255,
 * so a 0..1 tuple renders as near-black — that is what made proposed lights in
 * the assistant preview black. Use this helper for anything the renderer reads.
 *
 * Kept free of app imports so it can be unit tested with the node test runner.
 */
export const hsToRgbBytes = ({
  h,
  s,
}: {
  h: number;
  s: number;
}): [number, number, number] => {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, s));
  const chroma = saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 1 - chroma;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] =
    sector === 0
      ? [chroma, x, 0]
      : sector === 1
        ? [x, chroma, 0]
        : sector === 2
          ? [0, chroma, x]
          : sector === 3
            ? [0, x, chroma]
            : sector === 4
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
};
