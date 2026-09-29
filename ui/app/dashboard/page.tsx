import { useMemo } from 'react';
import '@/styles/settings.css';
import { useDashboardArrangement } from '@/hooks/useDashboardArrangement';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { RetainedDrafts } from '@/ui/settings/SettingsDrafts';
import {
  useDashboardSpacing,
  useDashboardSpacingSettings,
  dashboardSpacingStyles,
} from '@/hooks/dashboardSpacing';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { useDashboardLayouts, useDashboardWidgets } from '@/hooks/useDashboard';
import { useDashboardEditingSettings } from '@/hooks/dashboardEditing';
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
  const [searchParams] = useSearchParams();
  const isEditing = searchParams.get('edit') === '1';
  const [storedSpacing] = useDashboardSpacing();
  const [spacingSettings] = useDashboardSpacingSettings();
  const [dashboardScrollEnabled] = useDashboardScroll();
  const [editingSettings] = useDashboardEditingSettings();
  const spacing =
    storedSpacing in dashboardSpacingStyles ? storedSpacing : 'balanced';
  const [isFullscreen] = useIsFullscreen();
  const navigate = useNavigate();
  const {
    layouts,
    loading: layoutsLoading,
    error: layoutsError,
  } = useDashboardLayouts();
  const activeLayout =
    layouts.find((layout) => layout.id === searchParams.get('layout')) ??
    layouts.find((layout) => layout.is_default) ??
    layouts[0] ??
    null;
  const {
    widgets,
    loading: widgetsLoading,
    error: widgetsError,
    refetch: refetchWidgets,
  } = useDashboardWidgets(activeLayout?.id ?? null);
  const arrangement = useDashboardArrangement(
    activeLayout?.id,
    widgets,
    !widgetsLoading && !layoutsLoading && !widgetsError,
    refetchWidgets,
  );
  const draftHeader = (
    <RetainedDrafts activeKey={isEditing ? arrangement.draft.key : undefined} />
  );
  const draftFooter = isEditing ? (
    <div className="shrink-0">
      <EntitySaveBar inline draft={arrangement.draft} />
    </div>
  ) : null;
  const hasConfiguredLayout = activeLayout !== null;
  const dashboardLoading =
    layoutsLoading || (hasConfiguredLayout && widgetsLoading);
  const dashboardError = layoutsError ?? widgetsError;
  const showSettings = isEditing && searchParams.get('settings') === '1';
  const showAddWidget = isEditing && searchParams.get('add-widget') === '1';

  const renderedWidgets = useMemo(
    () =>
      [
        ...(hasConfiguredLayout
          ? isEditing
            ? arrangement.widgets
            : widgets
          : []),
      ].sort((left, right) => left.position - right.position),
    [hasConfiguredLayout, isEditing, arrangement.widgets, widgets],
  );

  const dashboardSettingsOverlay =
    showSettings && !layoutsLoading ? (
      <Navigate
        replace
        to={
          activeLayout
            ? '/config/dashboard/' + activeLayout.id
            : '/config/dashboard'
        }
      />
    ) : null;

  const dashboardAddWidgetOverlay =
    showAddWidget && !layoutsLoading ? (
      <Navigate
        replace
        to={
          activeLayout
            ? '/config/dashboard/' + activeLayout.id + '/widgets/new'
            : '/config/dashboard/new'
        }
      />
    ) : null;

  if (dashboardLoading) {
    return (
      <>
        {draftHeader}
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
        {draftFooter}
      </>
    );
  }

  if (dashboardError) {
    return (
      <>
        {draftHeader}
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
        {draftFooter}
      </>
    );
  }

  if (!hasConfiguredLayout || renderedWidgets.length === 0) {
    return (
      <>
        {draftHeader}
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
        {draftFooter}
      </>
    );
  }

  return (
    <>
      {draftHeader}
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
                onEdit={(widget) =>
                  navigate(
                    '/config/dashboard/' +
                      activeLayout.id +
                      '/widgets/' +
                      widget.id,
                  )
                }
                onRemove={(widget) => {
                  void confirmDialog({
                    title: `Remove widget "${widget.title}"?`,
                    description:
                      'This stages removal from the layout. Save the arrangement to apply it, or Discard to restore it.',
                    confirmLabel: 'Stage removal',
                    destructive: true,
                  }).then((confirmed) => {
                    if (confirmed) arrangement.remove(widget.id);
                  });
                }}
                onUpdateWidget={arrangement.resize}
                onReorderWidgets={arrangement.reorder}
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
        {dashboardSettingsOverlay}
      </div>
      {draftFooter}
    </>
  );
}
