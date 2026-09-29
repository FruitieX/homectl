import {
  Timer,
  Car,
  Lightbulb,
  Flame,
  Plug,
  Coffee,
  Fan,
  Moon,
  Sun,
  Droplets,
} from 'lucide-react';
export const timerIcons = {
  timer: Timer,
  car: Car,
  light: Lightbulb,
  heat: Flame,
  plug: Plug,
  coffee: Coffee,
  fan: Fan,
  moon: Moon,
  sun: Sun,
  water: Droplets,
};
export function TimerIcon({
  name,
  className = 'size-5',
}: {
  name: string;
  className?: string;
}) {
  const Icon = timerIcons[name as keyof typeof timerIcons] ?? Timer;
  return <Icon className={className} aria-hidden />;
}
