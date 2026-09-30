import { Link } from 'react-router-dom';
import { Button } from '@/ui/primitives/button';
import {
  useDashboardWidgetCatalog,
  widgetOptions,
  widgetTitle,
} from '../dashboard/shared';

export function HelperWidgetUsage({ helperId }: { helperId: string }) {
  const { layouts, widgets } = useDashboardWidgetCatalog();
  const references = widgets.flatMap((query) =>
    (query.data ?? []).filter(
      (widget) =>
        widget.widget_type === 'helper_mode' &&
        widgetOptions(widget).helperId === helperId,
    ),
  );
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium">Widgets</h3>
      {layouts.isError && (
        <p role="alert" className="text-sm">
          Could not load dashboard references.{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void layouts.refetch()}
          >
            Retry dashboard references
          </Button>
        </p>
      )}
      {(layouts.isPending || widgets.some((query) => query.isPending)) && (
        <p role="status" className="text-sm">
          Loading widget references…
        </p>
      )}
      {widgets.map(
        (query, index) =>
          query.isError && (
            <p key={layouts.data?.[index].id} role="alert" className="text-sm">
              Could not refresh widgets for {layouts.data?.[index].name}. Known
              references are kept.{' '}
              <Button
                variant="outline"
                size="sm"
                aria-label={`Retry widget references for ${layouts.data?.[index].name}`}
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </p>
          ),
      )}
      {!!references.length && (
        <div className="divide-y divide-border rounded-lg border border-border">
          {references.map((widget) => (
            <Link
              key={widget.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 hover:bg-muted/40"
              to={`/config/dashboard/${widget.layout_id}/widgets/${widget.id}`}
            >
              <span className="min-w-0 break-words text-sm text-primary underline">
                {widgetTitle(widget) === 'helper_mode'
                  ? 'Mode / helper'
                  : widgetTitle(widget)}
              </span>
              <span className="text-xs text-muted-foreground">
                {layouts.data?.find((layout) => layout.id === widget.layout_id)
                  ?.name ?? `Layout ${widget.layout_id}`}
              </span>
            </Link>
          ))}
        </div>
      )}
      {layouts.isSuccess &&
        widgets.every((query) => query.isSuccess) &&
        !references.length && (
          <p className="text-sm text-muted-foreground">
            No widgets use this helper.
          </p>
        )}
    </div>
  );
}
