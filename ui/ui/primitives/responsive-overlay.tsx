import { useMediaQuery } from 'usehooks-ts';
import { type ReactNode } from 'react';

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
}

export function ResponsiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  presentation = 'default',
}: ResponsiveOverlayProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isFullscreen = presentation === 'fullscreen';
  const contentClassName = cn(
    className,
    isFullscreen &&
      'grid h-[min(86dvh,56rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden',
  );
  const bodyClassName = cn(
    'min-h-0',
    isFullscreen && 'flex flex-col overflow-y-auto overscroll-contain',
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={contentClassName}>
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
          isFullscreen && 'h-[92dvh] max-h-[92dvh] overflow-hidden',
          className,
        )}
      >
        <DrawerHeader className={isFullscreen ? 'shrink-0' : undefined}>
          <DrawerTitle>{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <div className={cn(bodyClassName, isFullscreen && 'flex-1')}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
