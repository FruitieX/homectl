'use client';

import { ClockCard } from './ClockCard';
import { ControlsCard } from './ControlsCard';
import { TrainScheduleCard } from './TrainScheduleCard';
import { WeatherCard } from './WeatherCard';

export default function Page() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <WeatherCard />
      <ClockCard />
      <ControlsCard />
      <TrainScheduleCard />
    </div>
  );
}
