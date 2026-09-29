import { Link } from 'react-router-dom';
import type { DashboardWidget } from '@/hooks/useDashboard';

export function widgetSettingsHref(widget?: DashboardWidget) {
  return widget?.layoutId
    ? `/config/dashboard/${widget.layoutId}/widgets/${widget.id}`
    : '/config/dashboard';
}

export function WidgetRecovery({
  widget,
  message,
}: {
  widget?: DashboardWidget;
  message: string;
}) {
  return (
    <div className="space-y-2 p-4 text-sm text-muted-foreground">
      <p>{message}</p>
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        to={widgetSettingsHref(widget)}
      >
        Widget settings
      </Link>
    </div>
  );
}
