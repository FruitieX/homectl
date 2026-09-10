import * as SliderPrimitive from '@radix-ui/react-slider';
import { type ComponentProps, type CSSProperties } from 'react';

import { cn } from '@/lib/cn';

type SliderProps = ComponentProps<typeof SliderPrimitive.Root> & {
  trackStyle?: CSSProperties;
  rangeClassName?: string;
};

export function Slider({
  className,
  trackStyle,
  rangeClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        style={trackStyle}
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"
      >
        <SliderPrimitive.Range
          className={cn('absolute h-full bg-primary', rangeClassName)}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="block size-5 rounded-full border-2 border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  );
}
