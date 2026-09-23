/**
 * Overlay sizing for the software keyboard.
 *
 * iOS (and Android Chrome in its default `resizes-visual` mode) shrink the
 * *visual* viewport when the software keyboard opens while the layout viewport
 * stays put, so sheets sized with `dvh` keep their full height and leave a
 * keyboard-sized dead area under the composer. Overlays that host a text field
 * therefore size themselves from this height instead.
 */

/**
 * Smallest layout-minus-visual difference that counts as a software keyboard.
 * Smaller differences are browser chrome (an auto-hiding URL bar), which must
 * not resize a sheet while the user scrolls.
 */
export const KEYBOARD_MIN_INSET_PX = 100;

/**
 * Height an overlay should use, or `null` to leave it on the dynamic viewport
 * height.
 *
 * Returning `null` when no keyboard is present is deliberate: the stylesheet
 * falls back to `100dvh`, so the sheet never keeps a height measured while the
 * keyboard was open if the platform fails to report the dismissal.
 */
export function resolveVisualViewportHeight({
  layoutHeight,
  visualHeight,
}: {
  layoutHeight: number;
  visualHeight: number;
}): number | null {
  if (!Number.isFinite(visualHeight) || visualHeight <= 0) {
    return null;
  }
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) {
    return null;
  }
  return layoutHeight - visualHeight >= KEYBOARD_MIN_INSET_PX
    ? visualHeight
    : null;
}
