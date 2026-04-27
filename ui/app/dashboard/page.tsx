import { useState } from 'react';

import {
  DashboardWidget,
  getDashboardWidgetOptionString,
  defaultDashboardWidgets,
  useDashboardLayouts,
  useDashboardWidgets,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import {
  DASHBOARD_GRID_HELP,
  getDashboardWidgetRowSpanStyle,
  getDashboardWidgetSpanClass,
} from '@/lib/dashboard-layout';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
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
    case 'text':
      return (
        <Card>
          <CardHeader>
            <CardTitle>{widget.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {getDashboardWidgetOptionString(widget, 'body', '')}
            </p>
          </CardContent>
        </Card>
      );
    case 'link':
      return (
        <Card className="overflow-hidden">
          <Button
            asChild
            variant="ghost"
            className="h-full w-full justify-start p-0 text-left"
          >
            <a href={getDashboardWidgetOptionString(widget, 'url', '/')}>
              <CardContent className="flex h-full flex-col justify-center gap-2 p-5">
                <div className="text-lg font-semibold">
                  {getDashboardWidgetOptionString(
                    widget,
                    'label',
                    widget.title,
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {getDashboardWidgetOptionString(widget, 'description', '')}
                </p>
              </CardContent>
            </a>
          </Button>
        </Card>
      );
    case 'iframe':
      return (
        <Card className="overflow-hidden">
          <iframe
            title={getDashboardWidgetOptionString(
              widget,
              'title',
              widget.title,
            )}
            src={getDashboardWidgetOptionString(widget, 'url', 'about:blank')}
            className="h-full min-h-40 w-full border-0"
            loading="lazy"
          />
        </Card>
      );
    case 'image':
      return (
        <Card className="overflow-hidden">
          <img
            src={getDashboardWidgetOptionString(widget, 'imageUrl', '')}
            alt={getDashboardWidgetOptionString(widget, 'alt', widget.title)}
            className="h-full min-h-40 w-full object-cover"
          />
        </Card>
      );
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

function DashboardLoadingGrid() {
  return (
    <div className="grid grid-cols-4 gap-3 min-[37.5rem]:grid-cols-6 lg:grid-cols-8">
      <Skeleton className="col-span-4 h-44 rounded-3xl min-[37.5rem]:col-span-3 lg:col-span-2" />
      <Skeleton className="col-span-4 h-44 rounded-3xl min-[37.5rem]:col-span-3 lg:col-span-2" />
      <Skeleton className="col-span-4 h-64 rounded-3xl lg:col-span-4" />
      <Skeleton className="col-span-4 h-64 rounded-3xl lg:col-span-4" />
    </div>
  );
}

export default function Page() {
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const {
    layouts,
    loading: layoutsLoading,
    error: layoutsError,
  } = useDashboardLayouts();
  const activeLayout =
    layouts.find((layout) => layout.id === selectedLayoutId) ??
    layouts.find((layout) => layout.is_default) ??
    layouts[0] ??
    null;
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
    <div className="mx-2 space-y-3 overflow-y-auto py-2 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
      {layouts.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/80 p-2">
          <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Layout
          </span>
          {layouts.map((layout) => (
            <Button
              key={layout.id}
              size="sm"
              variant={activeLayout?.id === layout.id ? 'default' : 'ghost'}
              onClick={() => setSelectedLayoutId(layout.id)}
            >
              {layout.name}
              {layout.is_default ? (
                <Badge variant="secondary">Default</Badge>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div
        className="grid auto-rows-[minmax(9rem,auto)] grid-cols-4 gap-3 min-[37.5rem]:grid-cols-6 lg:grid-cols-8"
        title={DASHBOARD_GRID_HELP}
      >
        {renderedWidgets.map((widget) => (
          <div
            key={widget.id}
            className={cn(
              'min-w-0 *:h-full',
              getDashboardWidgetSpanClass(widget.width),
            )}
            style={getDashboardWidgetRowSpanStyle(widget.height)}
          >
            <DashboardWidgetCard widget={widget} />
          </div>
        ))}
      </div>
    </div>
  );
}
