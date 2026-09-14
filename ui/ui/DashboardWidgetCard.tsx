import type { DashboardWidget } from '@/hooks/useDashboard';
import { getDashboardWidgetOptionString } from '@/hooks/useDashboard';
import { CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { ClockCard } from '../app/dashboard/ClockCard';
import { ControlsCard } from '../app/dashboard/ControlsCard';
import { HomeOverview } from '../app/dashboard/HomeOverview';
import { SensorsCard } from '../app/dashboard/SensorsCard';
import { SpotPriceCard } from '../app/dashboard/SpotPriceCard';
import { TrainScheduleCard } from '../app/dashboard/TrainScheduleCard';
import { WeatherCard } from '../app/dashboard/WeatherCard';
import { DashboardCard } from '../app/dashboard/WidgetChrome';

export function DashboardWidgetCard({ widget }: { widget: DashboardWidget }) {
  switch (widget.widget_type) {
    case 'home_overview':
      return <HomeOverview />;
    case 'clock':
      return <ClockCard widget={widget} />;
    case 'controls':
      return <ControlsCard widget={widget} />;
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
        <DashboardCard className="dashboard-text-card">
          <CardHeader className="dashboard-widget-title shrink-0">
            <CardTitle>{widget.title}</CardTitle>
          </CardHeader>
          <CardContent className="dashboard-text-content min-h-0 flex-1 overflow-hidden">
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {getDashboardWidgetOptionString(widget, 'body', '')}
            </p>
          </CardContent>
        </DashboardCard>
      );
    case 'link':
      return (
        <DashboardCard className="dashboard-link-card">
          <Button
            asChild
            variant="ghost"
            className="h-full w-full justify-start p-0 text-left"
          >
            <a href={getDashboardWidgetOptionString(widget, 'url', '/')}>
              <CardContent className="dashboard-link-content flex h-full min-h-0 flex-col justify-center gap-2 overflow-hidden p-5">
                <div className="dashboard-link-label text-lg font-semibold">
                  {getDashboardWidgetOptionString(
                    widget,
                    'label',
                    widget.title,
                  )}
                </div>
                <p className="dashboard-link-description text-sm text-muted-foreground">
                  {getDashboardWidgetOptionString(widget, 'description', '')}
                </p>
              </CardContent>
            </a>
          </Button>
        </DashboardCard>
      );
    case 'iframe':
      return (
        <DashboardCard className="dashboard-iframe-card">
          <iframe
            title={getDashboardWidgetOptionString(
              widget,
              'title',
              widget.title,
            )}
            src={getDashboardWidgetOptionString(widget, 'url', 'about:blank')}
            className="h-full min-h-0 w-full flex-1 border-0"
            loading="lazy"
          />
        </DashboardCard>
      );
    case 'image':
      return (
        <DashboardCard className="dashboard-image-card">
          <img
            src={getDashboardWidgetOptionString(widget, 'imageUrl', '')}
            alt={getDashboardWidgetOptionString(widget, 'alt', widget.title)}
            className="h-full min-h-0 w-full flex-1 object-cover"
          />
        </DashboardCard>
      );
    case 'custom':
      return (
        <DashboardCard className="dashboard-custom-card">
          <CardHeader className="dashboard-widget-title shrink-0">
            <CardTitle>{widget.title}</CardTitle>
          </CardHeader>
          <CardContent className="dashboard-text-content min-h-0 flex-1 overflow-hidden">
            <p className="text-sm opacity-70">
              Custom widgets are not runtime-rendered yet.
            </p>
          </CardContent>
        </DashboardCard>
      );
    default:
      return (
        <DashboardCard>
          <CardContent className="flex h-full items-center justify-center">
            <EmptyState
              title="Unknown widget"
              description="This widget type is not available in the current UI."
            />
          </CardContent>
        </DashboardCard>
      );
  }
}
