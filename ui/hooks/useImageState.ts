import { useEffect, useState } from 'react';

/**
 * Load an HTMLImageElement for a given URL and expose it via React state, so
 * consumers re-render when the image finishes loading or when the URL changes.
 *
 * This replaces `use-image`, whose ref-based implementation can drop the
 * "loaded" re-render under React 18 StrictMode, leaving Konva/canvas
 * consumers stuck with a stale `undefined` image until an unrelated
 * re-render (e.g. a mouse hover state change) happens to flush.
 */
export const useImageState = (
  src: string | null | undefined,
): HTMLImageElement | undefined => {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);

  useEffect(() => {
    if (!src) {
      setImage(undefined);
      return;
    }

    // Reset while the new URL is loading so stale images do not leak through.
    setImage(undefined);

    const img = new Image();
    let cancelled = false;

    img.onload = () => {
      if (!cancelled) {
        setImage(img);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setImage(undefined);
      }
    };
    img.src = src;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return image;
};
