import { useState } from 'react';
import {
  WidgetRecovery,
  widgetSettingsHref,
} from '../app/dashboard/WidgetRecovery';
import { TimersCard } from '../app/dashboard/TimersCard';
import type { DashboardWidget } from '@/hooks/useDashboard';
import { Link } from 'react-router-dom';
import { getDashboardWidgetOptionString } from '@/hooks/useDashboard';
import { CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { ClockCard } from '../app/dashboard/ClockCard';
import { ControlsCard } from '../app/dashboard/ControlsCard';
import { HelperModeCard } from '../app/dashboard/HelperModeCard';
import { HomeOverview } from '../app/dashboard/HomeOverview';
import { SensorsCard } from '../app/dashboard/SensorsCard';
import { SpotPriceCard } from '../app/dashboard/SpotPriceCard';
import { TrainScheduleCard } from '../app/dashboard/TrainScheduleCard';
import { WeatherCard } from '../app/dashboard/WeatherCard';
import { DashboardCard } from '../app/dashboard/WidgetChrome';
import {
  RoomsCard,
  ScenesCard,
  IndoorClimateCard,
} from '../app/dashboard/EverydayWidgets';

export function DashboardWidgetCard({
  widget,
  preview = false,
}: {
  widget: DashboardWidget;
  preview?: boolean;
}) {
  if (widget.unsupportedType)
    return (
      <DashboardCard>
        <CardContent className="overflow-auto p-4">
          <EmptyState
            title="Widget unavailable"
            description={`This version cannot display “${widget.unsupportedType}”. Its saved configuration is kept.`}
            action={
              <Button variant="outline" asChild>
                <Link
                  to={
                    widget.layoutId
                      ? `/config/dashboard/${widget.layoutId}/widgets/${widget.id}`
                      : '/config/dashboard'
                  }
                >
                  Widget settings
                </Link>
              </Button>
            }
          />
        </CardContent>
      </DashboardCard>
    );
  switch (widget.widget_type) {
    case 'timers':
      return <TimersCard widget={widget} />;
    case 'rooms':
      return <RoomsCard widget={widget} />;
    case 'scenes':
      return <ScenesCard widget={widget} />;
    case 'indoor_climate':
      return <IndoorClimateCard widget={widget} />;
    case 'home_overview':
      return <HomeOverview title={widget.title} />;
    case 'clock':
      return <ClockCard widget={widget} />;
    case 'controls':
      return <ControlsCard widget={widget} />;
    case 'helper_mode':
      return <HelperModeCard widget={widget} />;
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
          <CardContent className="dashboard-text-content min-h-0 flex-1 overflow-auto">
            {getDashboardWidgetOptionString(widget, 'body', '') ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {getDashboardWidgetOptionString(widget, 'body', '')}
              </p>
            ) : (
              <WidgetRecovery
                widget={widget}
                message="Add text to this widget."
              />
            )}
          </CardContent>
        </DashboardCard>
      );
    case 'link':
      if (!getDashboardWidgetOptionString(widget, 'url', ''))
        return (
          <DashboardCard>
            <WidgetRecovery
              widget={widget}
              message="Choose a destination for this link."
            />
          </DashboardCard>
        );
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
    case 'iframe': {
      const url = getDashboardWidgetOptionString(widget, 'url', '');
      return (
        <DashboardCard className="dashboard-iframe-card">
          {url ? (
            <>
              <iframe
                title={getDashboardWidgetOptionString(
                  widget,
                  'title',
                  widget.title || 'Embedded page',
                )}
                src={url}
                sandbox={preview ? '' : undefined}
                className="min-h-0 w-full flex-1 border-0"
                loading="lazy"
              />
              <div className="flex shrink-0 justify-between gap-3 border-t border-border px-3 text-xs">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center text-primary underline"
                >
                  Open page
                </a>
                <Link
                  to={widgetSettingsHref(widget)}
                  className="inline-flex min-h-9 items-center text-primary underline"
                >
                  Widget settings
                </Link>
              </div>
            </>
          ) : (
            <WidgetRecovery widget={widget} message="Choose a page to embed." />
          )}
        </DashboardCard>
      );
    }
    case 'image':
      return (
        <ImageWidget
          key={getDashboardWidgetOptionString(widget, 'imageUrl', '')}
          widget={widget}
        />
      );
    case 'custom': {
      const content = getDashboardWidgetOptionString(widget, 'content', '');
      return (
        <DashboardCard className="dashboard-custom-card">
          <CardHeader className="dashboard-widget-title shrink-0">
            <CardTitle>{widget.title}</CardTitle>
          </CardHeader>
          <CardContent className="dashboard-text-content min-h-0 flex-1 overflow-hidden p-0">
            {content.trim() ? (
              <iframe
                className="h-full w-full border-0 bg-background"
                sandbox=""
                srcDoc={content}
                title={widget.title}
              />
            ) : (
              <WidgetRecovery
                widget={widget}
                message="Add HTML in widget settings; scripts do not run."
              />
            )}
          </CardContent>
        </DashboardCard>
      );
    }
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

function ImageWidget({ widget }: { widget: DashboardWidget }) {
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const url = getDashboardWidgetOptionString(widget, 'imageUrl', '');
  return (
    <DashboardCard className="dashboard-image-card">
      {!url || failed ? (
        <div className="min-h-0 overflow-auto">
          <WidgetRecovery
            widget={widget}
            message={
              failed
                ? 'Image unavailable. Check its address or try again.'
                : 'Choose an image for this widget.'
            }
          />
          {failed && (
            <Button
              variant="outline"
              className="mx-4 mb-4"
              onClick={() => {
                setAttempt((n) => n + 1);
                setFailed(false);
              }}
            >
              Retry image
            </Button>
          )}
        </div>
      ) : (
        <img
          key={attempt}
          src={url}
          alt={getDashboardWidgetOptionString(widget, 'alt', widget.title)}
          className="h-full min-h-0 w-full flex-1 object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </DashboardCard>
  );
}
