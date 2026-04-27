import { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  summary: ReactNode;
  dialogTitle: ReactNode;
  dialogSubtitle?: ReactNode;
  dialogBoxClassName?: string;
  cardClassName?: string;
  children: ReactNode;
};

export function ExpandableConfigCard({
  open,
  onOpen,
  onClose,
  summary,
  dialogTitle,
  dialogSubtitle,
  dialogBoxClassName,
  cardClassName,
  children,
}: Props) {
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={handleCardKeyDown}
        className={cn(
          'cursor-pointer transition hover:border-primary/40 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          cardClassName,
        )}
      >
        <CardContent className="p-6">{summary}</CardContent>
      </Card>

      <ResponsiveOverlay
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            onOpen();
          } else {
            onClose();
          }
        }}
        title={dialogTitle}
        description={dialogSubtitle}
        presentation="fullscreen"
        className={cn('max-w-6xl', dialogBoxClassName)}
      >
        <div className="px-5 pb-5 md:px-0 md:pb-0">{children}</div>
      </ResponsiveOverlay>
    </>
  );
}
