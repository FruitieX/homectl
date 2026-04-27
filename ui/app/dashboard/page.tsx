import {
  DashboardWidget,
  defaultDashboardWidgets,
  useDashboardLayouts,
  useDashboardWidgets,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';

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
        <Card>
          <CardHeader>
            <CardTitle>{widget.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm opacity-70">
              Custom widgets are not runtime-rendered yet.
            </p>
          </CardContent>
        </Card>
      );
  }
}

function getWidgetSpanClass(width: number) {
  const normalizedWidth = Math.min(8, Math.max(1, Math.round(width)));

  switch (normalizedWidth) {
    case 1:
      return 'col-span-4 sm:col-span-2 lg:col-span-1';
    case 2:
      return 'col-span-4 sm:col-span-3 lg:col-span-2';
    case 3:
      return 'col-span-4 sm:col-span-3 lg:col-span-3';
    case 4:
      return 'col-span-4 sm:col-span-6 lg:col-span-4';
    case 5:
      return 'col-span-4 sm:col-span-6 lg:col-span-5';
    case 6:
      return 'col-span-4 sm:col-span-6 lg:col-span-6';
    case 7:
      return 'col-span-4 sm:col-span-6 lg:col-span-7';
    default:
      return 'col-span-4 sm:col-span-6 lg:col-span-8';
  }
}

function DashboardLoadingGrid() {
  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
      <Skeleton className="col-span-4 h-44 rounded-3xl sm:col-span-3 lg:col-span-2" />
      <Skeleton className="col-span-4 h-44 rounded-3xl sm:col-span-3 lg:col-span-2" />
      <Skeleton className="col-span-4 h-64 rounded-3xl lg:col-span-4" />
      <Skeleton className="col-span-4 h-64 rounded-3xl lg:col-span-4" />
    </div>
  );
}

export default function Page() {
  const {
    layouts,
    loading: layoutsLoading,
    error: layoutsError,
  } = useDashboardLayouts();
  const activeLayout =
    layouts.find((layout) => layout.is_default) ?? layouts[0] ?? null;
  const {
    widgets,
    loading: widgetsLoading,
    error: widgetsError,
  } = useDashboardWidgets(activeLayout?.id ?? null);
  const hasConfiguredLayout = activeLayout !== null;
  const dashboardLoading =
    layoutsLoading || (hasConfiguredLayout && widgetsLoading);
  const dashboardError = layoutsError ?? widgetsError;

  const renderedWidgets = [
    ...(hasConfiguredLayout ? widgets : defaultDashboardWidgets),
  ].sort((left, right) => left.position - right.position);

  if (dashboardLoading) {
    return (
      <div className="mx-2 overflow-y-auto py-2 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
        <DashboardLoadingGrid />
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="mx-2 py-3">
        <Alert variant="destructive">
          <AlertTitle>Dashboard configuration failed to load</AlertTitle>
          <AlertDescription>{dashboardError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (hasConfiguredLayout && renderedWidgets.length === 0) {
    return (
      <div className="mx-2 py-3">
        <EmptyState
          title="No dashboard widgets configured"
          description={`The ${activeLayout.name} layout is empty. Add widgets in Config → Dashboard.`}
        />
      </div>
    );
  }

  return (
    <div className="mx-2 grid auto-rows-[minmax(9rem,auto)] grid-cols-4 gap-3 overflow-y-auto py-2 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:grid-cols-6 lg:grid-cols-8">
      {renderedWidgets.map((widget) => (
        <div
          key={widget.id}
          className={cn('min-w-0 *:h-full', getWidgetSpanClass(widget.width))}
          style={{
            gridRow: `span ${Math.min(4, Math.max(1, Math.round(widget.height)))} / span ${Math.min(4, Math.max(1, Math.round(widget.height)))}`,
          }}
        >
          <DashboardWidgetCard widget={widget} />
        </div>
      ))}
    </div>
  );
}
