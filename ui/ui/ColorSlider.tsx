import { useId, type ComponentProps } from 'react';
import Color from 'color';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<'input'>, 'type' | 'value' | 'color'> & {
  label: string;
  value: number;
  color: Color;
  channel: 'hue' | 'saturation' | 'brightness';
};

export function ColorSlider({
  label,
  value,
  color,
  channel,
  className,
  ...props
}: Props) {
  const id = useId();
  const stops = Array.from({ length: 7 }, (_, index) => {
    const position = index / 6;
    if (channel === 'hue') return Color.hsv(position * 360, 44, 85).hex();
    if (channel === 'saturation')
      return color
        .saturationv(position * 100)
        .value(100)
        .mix(Color('#b0b0b0'), 0.2)
        .hex();
    return color
      .value(position * 100)
      .mix(Color('#b0b0b0'), 0.2)
      .hex();
  });
  return (
    <div className={cn('min-w-0 shrink-0', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-muted-foreground">
          {label}
        </label>
        <output htmlFor={id} className="tabular-nums text-foreground">
          {Math.round(value)}
          {channel === 'hue' ? '°' : '%'}
        </output>
      </div>
      <div className="relative h-11">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full shadow-inner ring-1 ring-inset ring-black/15"
          style={{
            backgroundImage: `linear-gradient(to right, ${stops.join(', ')})`,
          }}
        />
        <input
          {...props}
          id={id}
          type="range"
          value={value}
          aria-valuetext={`${Math.round(value)}${channel === 'hue' ? ' degrees' : ' percent'}`}
          className="relative m-0 block h-11 w-full cursor-pointer appearance-none rounded-lg bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent"
        />
      </div>
    </div>
  );
}
