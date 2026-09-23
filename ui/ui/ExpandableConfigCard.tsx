import { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { useLongPress } from '@/hooks/useLongPress';
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
  /**
   * Select-on-hold gesture for touch devices. While a press is held the card
   * fires this instead of opening; a normal tap still opens the card.
   */
  onLongPress?: () => void;
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
  onLongPress,
  children,
}: Props) {
  const longPressEnabled = Boolean(onLongPress);
  const { longPressProps, consumeLongPress } = useLongPress({
    onLongPress,
    enabled: longPressEnabled,
  });

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  const handleCardClick = () => {
    // The click that follows a long press must not also open the card.
    if (longPressEnabled && consumeLongPress()) {
      return;
    }
    onOpen();
  };

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        {...(longPressEnabled ? longPressProps : {})}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        className={cn(
          'cursor-pointer rounded-2xl border-border/70 shadow-sm transition hover:border-primary/40 hover:bg-accent/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          longPressEnabled && 'select-none [-webkit-touch-callout:none]',
          cardClassName,
        )}
      >
        <CardContent className="p-4 sm:p-5">{summary}</CardContent>
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
