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
import {
  useDashboardEditingSettings,
  type DashboardGridSnap,
  type DashboardScreenSimulation,
} from '@/hooks/dashboardEditing';
import { cn } from '@/lib/cn';
import { useDashboardScroll } from '@/hooks/dashboardScroll';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import { getDashboardWidgetResponsiveGridStyle } from '@/lib/dashboard-layout';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { DashboardWidgetCard } from '@/ui/DashboardWidgetCard';
import { DashboardGridEditor } from '@/ui/DashboardGridEditor';
import { DashboardSettingsOverlay } from '@/ui/DashboardSettingsOverlay';
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
  const [editingSettings, setEditingSettings] = useDashboardEditingSettings();
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
    createLayout,
    deleteLayout,
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
    addWidget,
    removeWidget,
    updateWidget,
    reorderWidgets,
  } = useDashboardWidgets(activeLayout?.id ?? null);
  const hasConfiguredLayout = activeLayout !== null;
  const dashboardLoading =
    layoutsLoading || (hasConfiguredLayout && widgetsLoading);
  const dashboardError = layoutsError ?? widgetsError;
  const showSettings = isEditing && searchParams.get('settings') === '1';
  const showAddWidget = isEditing && searchParams.get('add-widget') === '1';

  const renderedWidgets = [...(hasConfiguredLayout ? widgets : [])].sort(
    (left, right) => left.position - right.position,
  );

  const closeSettings = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('settings');
    setSearchParams(nextParams, { replace: true });
  };

  const closeAddWidget = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('add-widget');
    setSearchParams(nextParams, { replace: true });
  };

  const dashboardSettingsOverlay = showSettings ? (
    <DashboardSettingsOverlay
      open
      onClose={closeSettings}
      layouts={layouts}
      layoutsLoading={layoutsLoading}
      layoutsError={layoutsError}
      activeLayout={activeLayout}
      selectedLayoutId={selectedLayoutId}
      onSelectLayout={setSelectedLayoutId}
      onCreateLayout={(name) => createLayout({ name })}
      onDeleteLayout={async (layoutId) => {
        await deleteLayout(layoutId);
        setSelectedLayoutId((current) =>
          current === layoutId ? null : current,
        );
      }}
      gridSnap={editingSettings.gridSnap}
      screenSimulation={editingSettings.screenSimulation}
      onGridSnapChange={(gridSnap: DashboardGridSnap) =>
        setEditingSettings((current) => ({ ...current, gridSnap }))
      }
      onScreenSimulationChange={(screenSimulation: DashboardScreenSimulation) =>
        setEditingSettings((current) => ({ ...current, screenSimulation }))
      }
    />
  ) : null;

  const dashboardAddWidgetOverlay = showAddWidget ? (
    <WidgetOverlay
      mode="add"
      onClose={closeAddWidget}
      onSubmit={async (widget) => {
        await addWidget(widget);
        closeAddWidget();
      }}
    />
  ) : null;

  if (dashboardLoading) {
    return (
      <>
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
        {dashboardAddWidgetOverlay}
        {dashboardSettingsOverlay}
      </>
    );
  }

  if (dashboardError) {
    return (
      <>
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
        {dashboardAddWidgetOverlay}
        {dashboardSettingsOverlay}
      </>
    );
  }

  if (!hasConfiguredLayout || renderedWidgets.length === 0) {
    return (
      <>
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
                  ? `The ${activeLayout.name} layout is empty. Open the dashboard editor to add widgets.`
                  : 'Open the dashboard editor to create a layout and add widgets.'
              }
              action={
                !isFullscreen ? (
                  <Button asChild>
                    <Link to="/?edit=1&settings=1">Edit dashboard</Link>
                  </Button>
                ) : undefined
              }
            />
          </div>
        </div>
        {dashboardAddWidgetOverlay}
        {dashboardSettingsOverlay}
      </>
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
          {isEditing ? (
            <DashboardGridEditor
              variant="inline"
              widgets={renderedWidgets}
              dashboardScrollEnabled={dashboardScrollEnabled}
              gridSnap={editingSettings.gridSnap}
              screenSimulation={editingSettings.screenSimulation}
              onEdit={setEditingWidget}
              onRemove={(widget) => {
                void confirmDialog({
                  title: `Remove widget "${widget.title}"?`,
                  description:
                    'The widget is removed from this dashboard layout. You can add it again later.',
                  confirmLabel: 'Remove',
                  destructive: true,
                }).then((confirmed) => {
                  if (confirmed) void removeWidget(widget.id);
                });
              }}
              onUpdateWidget={updateWidget}
              onReorderWidgets={reorderWidgets}
            />
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
      {dashboardAddWidgetOverlay}
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
      {dashboardSettingsOverlay}
    </div>
  );
}
