import { useEffect, useRef, useState } from 'react';
import type { Device } from '@/bindings/Device';
import type { LightHold } from '@/lib/lightQuickAdjust';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { LiveStatePreview, devicePreviewState } from './LiveStatePreview';
import { LightQuickPopover } from './LightQuickPopover';

export function LightQuickIndicator({
  device,
  displayNames,
  onDetails,
}: {
  device: Device;
  displayNames: Record<string, string>;
  onDetails: () => void;
}) {
  const [quick, setQuick] = useState<{
    anchor: { x: number; y: number };
    hold?: LightHold;
  } | null>(null);
  const cancel = useRef<() => void>(() => {});
  const suppressClick = useRef(false);
  useEffect(() => () => cancel.current(), []);
  return (
    <>
      <button
        type="button"
        className="grid size-11 shrink-0 touch-none place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Quick controls for ${getDeviceDisplayLabel(device, displayNames)}`}
        aria-haspopup="dialog"
        aria-expanded={Boolean(quick)}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          cancel.current();
          suppressClick.current = false;
          const { pointerId, clientX, clientY } = event;
          const rect = event.currentTarget.getBoundingClientRect();
          const anchor = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          const timer = setTimeout(() => {
            cleanup();
            suppressClick.current = true;
            setQuick({ anchor, hold: { ...anchor, pointerId } });
          }, 500);
          const move = (next: PointerEvent) => {
            if (
              next.pointerId === pointerId &&
              Math.hypot(next.clientX - clientX, next.clientY - clientY) > 8
            ) {
              suppressClick.current = true;
              cleanup();
            }
          };
          const cleanup = () => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
          };
          cancel.current = cleanup;
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', cleanup);
          window.addEventListener('pointercancel', cleanup);
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setQuick({
            anchor: {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            },
          });
        }}
      >
        <LiveStatePreview states={[devicePreviewState(device)]} />
      </button>
      {quick && (
        <LightQuickPopover
          device={device}
          displayNames={displayNames}
          anchor={quick.anchor}
          hold={quick.hold}
          onClose={() => setQuick(null)}
          onDetails={onDetails}
        />
      )}
    </>
  );
}
