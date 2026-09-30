/** The outer ring follows StatePreview: clockwise from twelve o'clock. */
export function ringBrightness(x: number, y: number): number {
  const angle = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return Math.round((angle / (Math.PI * 2)) * 100);
}

export type LightHold = {
  pointerId: number;
  x: number;
  y: number;
};
