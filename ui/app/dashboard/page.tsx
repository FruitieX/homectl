import {
  DashboardWidget,
  defaultDashboardWidgets,
  useDashboardLayouts,
  useDashboardWidgets,
} from '@/hooks/useDashboard';
import { Card } from 'react-daisyui';

import { ClockCard } from './ClockCard';
import { ControlsCard } from './ControlsCard';
import { SensorsCard } from './SensorsCard';
import { SpotPriceCard } from './SpotPriceCard';
import { TrainScheduleCard } from './TrainScheduleCard';
import { WeatherCard } from './WeatherCard';

function DashboardWidgetCard({ widget }: { widget: DashboardWidget }) {
  switch (widget.widget_type) {
    case 'clock':
      return <ClockCard widget={widget} />;
    case 'controls':
      return <ControlsCard />;
    case 'sensors':
      return <SensorsCard widget={widget} />;
    case 'spot_price':
      return <SpotPriceCard widget={widget} />;
    case 'train_schedule':
      return <TrainScheduleCard widget={widget} />;
    case 'weather':
      return <WeatherCard widget={widget} />;
    case 'custom':
      return (
        <Card compact className="bg-base-300">
          <Card.Body>
            <h2 className="card-title">{widget.title}</h2>
            <p className="text-sm opacity-70">
              Custom widgets are not runtime-rendered yet.
            </p>
          </Card.Body>
        </Card>
      );
  }
}

export default function Page() {
  const { layouts } = useDashboardLayouts();
  const activeLayout = layouts.find((layout) => layout.is_default) ?? layouts[0] ?? null;
  const { widgets } = useDashboardWidgets(activeLayout?.id ?? null);

  const renderedWidgets = [...(widgets.length > 0 ? widgets : defaultDashboardWidgets)].sort(
    (left, right) => left.position - right.position,
  );

  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 overflow-y-auto mx-2 py-2">
      {renderedWidgets.map((widget) => (
        <div
          key={widget.id}
          style={{
            gridColumn: `span ${widget.width} / span ${widget.width}`,
          }}
        >
          <DashboardWidgetCard widget={widget} />
        </div>
      ))}
    </div>
  );
}
