import { useMediaQuery } from 'usehooks-ts';
import { type ReactNode } from 'react';
import { FloorplanInspector } from '@/ui/FloorplanInspector';

import { cn } from '@/lib/cn';
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
}: ResponsiveOverlayProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
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
      <FloorplanInspector title={title} onClose={() => onOpenChange(false)}>
        {children}
      </FloorplanInspector>
    ) : null;
  }

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} modal={!isSidePanel}>
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
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={cn(
          'h-auto max-h-[92dvh] overflow-hidden',
          isFullscreen && 'h-[92dvh]',
          className,
        )}
      >
        <DrawerHeader className="shrink-0">
          <DrawerTitle>{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
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
