import { type ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export function FormActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col-reverse gap-2 border-t border-border/70 bg-background/90 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none',
        className,
      )}
      {...props}
    />
  );
}
