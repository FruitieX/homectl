import { useEffect, useState } from 'react';

const imageCache = new Map<string, HTMLImageElement>();

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

    const cachedImage = imageCache.get(src);
    if (cachedImage?.complete && cachedImage.naturalWidth > 0) {
      setImage(cachedImage);
      return;
    }

    // Reset while the new URL is loading so stale images do not leak through.
    setImage(undefined);

    const img = cachedImage ?? new Image();
    if (!cachedImage) {
      imageCache.set(src, img);
    }
    let cancelled = false;

    const handleLoad = () => {
      if (!cancelled) {
        setImage(img);
      }
    };
    const handleError = () => {
      if (!cancelled) {
        setImage(undefined);
      }
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);
    if (!cachedImage) {
      img.src = src;
    }

    return () => {
      cancelled = true;
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [src]);

  return image;
};
