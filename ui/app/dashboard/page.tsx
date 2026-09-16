import { useState } from 'react';
import {
  useDashboardSpacing,
  useDashboardSpacingSettings,
  dashboardSpacingStyles,
} from '@/hooks/dashboardSpacing';
import { Link, useSearchParams } from 'react-router-dom';

import {
  useDashboardLayouts,
  useDashboardWidgets,
  type DashboardWidget,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import { useDashboardScroll } from '@/hooks/dashboardScroll';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { getDashboardWidgetResponsiveGridStyle } from '@/lib/dashboard-layout';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { DashboardWidgetCard } from '@/ui/DashboardWidgetCard';
import { DashboardGridEditor } from '@/ui/DashboardGridEditor';
import { WidgetOverlay } from '@/ui/DashboardWidgetSettingsOverlay';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const isEditing = searchParams.get('edit') === '1';
  const [storedSpacing] = useDashboardSpacing();
  const [spacingSettings] = useDashboardSpacingSettings();
  const [dashboardScrollEnabled] = useDashboardScroll();
  const spacing =
    storedSpacing in dashboardSpacingStyles ? storedSpacing : 'balanced';
  const [isFullscreen] = useIsFullscreen();
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(
    null,
  );
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
    removeWidget,
    updateWidget,
    reorderWidgets,
  } = useDashboardWidgets(activeLayout?.id ?? null);
  const hasConfiguredLayout = activeLayout !== null;
  const dashboardLoading =
    layoutsLoading || (hasConfiguredLayout && widgetsLoading);
  const dashboardError = layoutsError ?? widgetsError;

  const renderedWidgets = [...(hasConfiguredLayout ? widgets : [])].sort(
    (left, right) => left.position - right.position,
  );

  const stopEditing = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('edit');
    setSearchParams(nextParams, { replace: true });
  };

  if (dashboardLoading) {
    return (
      <div
        className={cn(
          'min-h-0 flex-1 px-2.5 py-2.5 sm:px-5 sm:py-3 lg:px-8 lg:py-6',
          dashboardScrollEnabled ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <div className="mx-auto max-w-[100rem] space-y-8">
          <DashboardLoadingGrid />
        </div>
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div
        className={cn(
          'min-h-0 flex-1 px-2.5 py-2.5 sm:px-5 sm:py-3 lg:px-8 lg:py-6',
          dashboardScrollEnabled ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <div className="mx-auto max-w-[100rem] space-y-6">
          <Alert variant="destructive">
            <AlertTitle>Dashboard configuration failed to load</AlertTitle>
            <AlertDescription>{dashboardError}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!hasConfiguredLayout || renderedWidgets.length === 0) {
    return (
      <div
        className={cn(
          'min-h-0 flex-1 px-3 py-3 sm:px-5 lg:px-8 lg:py-6',
          dashboardScrollEnabled ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <div className="mx-auto max-w-[100rem] space-y-8">
          <EmptyState
            title="Your dashboard is empty"
            description={
              hasConfiguredLayout
                ? `The ${activeLayout.name} layout is empty. Add widgets in Settings → Dashboard to make it your own.`
                : 'Create a layout and add widgets in Settings → Dashboard to make this space your own.'
            }
            action={
              !isFullscreen ? (
                <Button asChild>
                  <Link to="/config/dashboard">Edit dashboard</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-dashboard-spacing={spacing}
      data-dashboard-scroll={dashboardScrollEnabled ? 'enabled' : 'disabled'}
      style={
        {
          ...dashboardSpacingStyles[spacing],
          '--dashboard-outer': `${spacingSettings.outer}px`,
          '--dashboard-gap': `${spacingSettings.gap}px`,
        } as React.CSSProperties
      }
      className={cn(
        'min-h-0 flex-1 overflow-x-hidden px-[var(--dashboard-outer)] py-[var(--dashboard-outer)]',
        isEditing || dashboardScrollEnabled
          ? 'overflow-y-auto overscroll-contain'
          : 'overflow-hidden',
      )}
    >
      <div
        className={cn(
          'mx-auto max-w-[100rem] space-y-8',
          !dashboardScrollEnabled && 'flex h-full min-h-0 flex-col',
        )}
      >
        <section
          className={cn(
            !dashboardScrollEnabled && 'flex min-h-0 flex-1 flex-col',
          )}
        >
          {layouts.length > 1 ? (
            <div className="mb-3 flex items-center justify-end gap-3 px-1">
              <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/50 bg-card/55 p-1.5 backdrop-blur-xl">
                <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Layout
                </span>
                {layouts.map((layout) => (
                  <Button
                    key={layout.id}
                    size="sm"
                    variant={
                      activeLayout?.id === layout.id ? 'default' : 'ghost'
                    }
                    onClick={() => setSelectedLayoutId(layout.id)}
                  >
                    {layout.name}
                    {layout.is_default ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {isEditing ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/config/dashboard">Widget settings</Link>
                  </Button>
                  <Button size="sm" onClick={stopEditing}>
                    Done
                  </Button>
                </div>
              </div>
              <DashboardGridEditor
                variant="inline"
                widgets={renderedWidgets}
                onEdit={setEditingWidget}
                onRemove={(widget) => {
                  if (confirm(`Remove widget "${widget.title}"?`)) {
                    void removeWidget(widget.id);
                  }
                }}
                onUpdateWidget={updateWidget}
                onReorderWidgets={reorderWidgets}
              />
            </div>
          ) : (
            <div
              className={cn(
                'dashboard-layout-grid grid min-w-0 gap-0',
                dashboardScrollEnabled
                  ? 'auto-rows-[minmax(calc(var(--dashboard-row)/4),auto)]'
                  : 'min-h-0 flex-1 overflow-hidden',
              )}
              style={{
                gridAutoRows: dashboardScrollEnabled
                  ? 'minmax(calc(var(--dashboard-row) / 4), auto)'
                  : 'minmax(0, 1fr)',
              }}
            >
              {renderedWidgets.map((widget) => (
                <div
                  key={widget.id}
                  className={cn(
                    'dashboard-layout-item min-h-0 min-w-0 *:h-full',
                  )}
                  style={{
                    ...getDashboardWidgetResponsiveGridStyle(
                      widget.width,
                      widget.height,
                    ),
                    margin: 'calc(var(--dashboard-gap) / 2)',
                  }}
                >
                  <DashboardWidgetCard widget={widget} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {editingWidget ? (
        <WidgetOverlay
          mode="edit"
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSubmit={async (updated) => {
            await updateWidget(editingWidget.id, updated);
            setEditingWidget(null);
          }}
        />
      ) : null}
    </div>
  );
}
