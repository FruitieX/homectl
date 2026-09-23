import { useMediaQuery } from 'usehooks-ts';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FloorplanInspector } from '@/ui/FloorplanInspector';

import { cn } from '@/lib/cn';
import { useUnsavedChanges } from '@/hooks/unsavedChanges';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/ui/primitives/drawer';

interface ResponsiveOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  presentation?: 'default' | 'fullscreen';
  desktopPresentation?: 'dialog' | 'sidepanel' | 'floorplan';
  /**
   * Size the sheet from the visual viewport instead of letting the drawer
   * reposition itself for the software keyboard. Opting out lets the drawer
   * write an inline height measured while the keyboard was open, which then
   * sticks after it closes and leaves the sheet too short — so this is on by
   * default and only turned off for a sheet that genuinely needs the drawer's
   * own keyboard handling.
   */
  sizeToVisualViewport?: boolean;
  /**
   * Drop the drawer description on phones. A keyboard-sized sheet needs the
   * room for content that the user is actually working with.
   */
  hideDescriptionOnMobile?: boolean;
  /**
   * When `dirty` is true, closing the overlay (Esc, overlay click, drawer
   * drag, or an explicit onOpenChange(false)) asks for confirmation first.
   */
  guard?: {
    dirty: boolean;
    title?: ReactNode;
    description?: ReactNode;
    confirmLabel?: string;
  };
}

/**
 * Live numbers for debugging sheet sizing on a phone, where the software
 * keyboard shrinks the visual viewport but not the layout viewport. Open a
 * sheet with `?viewport-debug` in the URL to see them.
 */
function ViewportDebugReadout() {
  const [, force] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => force((tick) => tick + 1);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!window.location.search.includes('viewport-debug')) return null;

  const viewport = window.visualViewport;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1]?.getBoundingClientRect();
  return (
    <div className="pointer-events-none fixed left-1 top-1 z-[9999] rounded-lg bg-black/85 p-2 font-mono text-[10px] leading-tight text-white">
      <div>innerH {window.innerHeight}</div>
      <div>
        vv {viewport ? Math.round(viewport.height) : '—'} top{' '}
        {viewport ? Math.round(viewport.offsetTop) : '—'}
      </div>
      <div>
        gap {viewport ? window.innerHeight - Math.round(viewport.height) : '—'}
      </div>
      <div>
        cssVar{' '}
        {getComputedStyle(document.documentElement)
          .getPropertyValue('--app-visual-viewport-height')
          .trim() || 'unset'}
      </div>
      <div>
        dialog top {dialog ? Math.round(dialog.top) : '—'} h{' '}
        {dialog ? Math.round(dialog.height) : '—'} bottom{' '}
        {dialog ? Math.round(dialog.bottom) : '—'}
      </div>
    </div>
  );
}

export function ResponsiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  presentation = 'default',
  desktopPresentation = 'dialog',
  sizeToVisualViewport = true,
  hideDescriptionOnMobile = false,
  guard,
}: ResponsiveOverlayProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isDirty = guard?.dirty ?? false;

  useUnsavedChanges(isDirty);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next || !isDirty) {
        onOpenChange(next);
        return;
      }

      void confirmDialog({
        title: guard?.title ?? 'Discard unsaved changes?',
        description:
          guard?.description ??
          'This editor has changes that have not been saved yet.',
        confirmLabel: guard?.confirmLabel ?? 'Discard changes',
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) onOpenChange(false);
      });
    },
    [guard, isDirty, onOpenChange],
  );
  const isFullscreen = presentation === 'fullscreen';
  const contentClassName = cn(
    'grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden',
    className,
    isFullscreen && 'h-[min(86dvh,56rem)] max-w-6xl',
  );
  const bodyClassName = cn(
    'min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain',
    isFullscreen && 'flex flex-col',
  );
  const isSidePanel = isDesktop && desktopPresentation === 'sidepanel';

  if (desktopPresentation === 'floorplan') {
    return open ? (
      <FloorplanInspector title={title} onClose={() => handleOpenChange(false)}>
        {children}
      </FloorplanInspector>
    ) : null;
  }

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange} modal={!isSidePanel}>
        <DialogContent
          showOverlay={!isSidePanel}
          onInteractOutside={
            isSidePanel ? (event) => event.preventDefault() : undefined
          }
          className={cn(
            contentClassName,
            isSidePanel &&
              'left-auto right-0 top-0 h-dvh max-h-dvh w-[min(32rem,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 rounded-l-3xl rounded-r-none p-5 sm:p-6',
          )}
        >
          <DialogHeader className={isFullscreen ? 'shrink-0' : undefined}>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <div className={bodyClassName}>{children}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      repositionInputs={!sizeToVisualViewport}
    >
      <DrawerContent
        className={cn(
          'h-auto max-h-[calc(var(--app-visual-viewport-height,100dvh)-1rem)] overflow-hidden',
          isFullscreen && 'h-[calc(var(--app-visual-viewport-height,100dvh)-1rem)]',
          className,
        )}
      >
        <DrawerHeader className="shrink-0">
          <DrawerTitle>{title}</DrawerTitle>
          {description && !hideDescriptionOnMobile && (
            <DrawerDescription>{description}</DrawerDescription>
          )}
        </DrawerHeader>
        <ViewportDebugReadout />
        <div
          data-vaul-no-drag
          className={cn(
            bodyClassName,
            'flex-1 pb-[env(safe-area-inset-bottom)] touch-pan-y',
          )}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
