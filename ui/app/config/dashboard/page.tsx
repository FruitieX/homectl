import { useEffect, useState } from 'react';
import {
  useDashboardSpacing,
  useDashboardSpacingSettings,
  type DashboardSpacing,
} from '@/hooks/dashboardSpacing';
import { useDashboardScroll } from '@/hooks/dashboardScroll';

import { ConfigPageHeader } from '../page-header';
import {
  useDashboardLayouts,
  useDashboardWidgets,
  type DashboardWidget,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
} from '@/ui/config-form';
import { DashboardGridEditor } from '@/ui/DashboardGridEditor';
import { WidgetOverlay } from '@/ui/DashboardWidgetSettingsOverlay';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Switch } from '@/ui/primitives/switch';

export default function DashboardConfigPage() {
  const [spacing, setSpacing] = useDashboardSpacing();
  const [spacingSettings, setSpacingSettings] = useDashboardSpacingSettings();
  const [dashboardScrollEnabled, setDashboardScrollEnabled] =
    useDashboardScroll();
  const {
    layouts,
    loading: layoutsLoading,
    error: layoutsError,
    createLayout,
    deleteLayout,
  } = useDashboardLayouts();
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const {
    widgets,
    loading: widgetsLoading,
    error: widgetsError,
    addWidget,
    updateWidget,
    removeWidget,
    reorderWidgets,
  } = useDashboardWidgets(selectedLayoutId);
  const [showAddLayout, setShowAddLayout] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(
    null,
  );

  useEffect(() => {
    if (!selectedLayoutId && layouts.length > 0) {
      setSelectedLayoutId(
        layouts.find((layout) => layout.is_default)?.id ?? layouts[0].id,
      );
    }
  }, [layouts, selectedLayoutId]);

  const selectedLayout = layouts.find(
    (layout) => layout.id === selectedLayoutId,
  );
  const sortedWidgets = [...widgets].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      <ConfigPageHeader
        title="Dashboard Configuration"
        description="Compose mobile-first dashboards from reusable widgets and layouts."
        actions={
          <Button onClick={() => setShowAddLayout(true)}>Add Layout</Button>
        }
      />

      <ConfigField
        label="Spacing on this screen"
        description="Saved in this browser. Compact fits more widgets on an info display."
      >
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={spacing}
          onChange={(event) =>
            setSpacing(event.target.value as DashboardSpacing)
          }
        >
          <option value="compact">Compact</option>
          <option value="balanced">Balanced</option>
          <option value="spacious">Spacious</option>
        </select>
      </ConfigField>
      <ConfigField
        label="Dashboard scrolling"
        description="Stored in this browser only. Disable it for wall displays; widgets fit the viewport and long lists scroll inside their own widget."
      >
        <div className="flex items-center gap-3">
          <Switch
            type="button"
            checked={dashboardScrollEnabled}
            onCheckedChange={setDashboardScrollEnabled}
            aria-label="Enable dashboard scrolling"
          />
          <span className="text-sm text-muted-foreground">
            {dashboardScrollEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </ConfigField>
      <ConfigField
        label="Card spacing"
        description="Adjust edge padding and the gap between cards on this device."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['outer', 'Edge padding'],
              ['gap', 'Gap between cards'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="grid gap-1 text-sm">
              <span className="flex justify-between">
                <span>{label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {spacingSettings[key]} px
                </span>
              </span>
              <input
                type="range"
                min={4}
                max={32}
                step={1}
                value={spacingSettings[key]}
                onChange={(event) =>
                  setSpacingSettings({
                    ...spacingSettings,
                    [key]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      </ConfigField>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Layouts</CardTitle>
            <CardDescription>
              Create multiple dashboard layouts for different use cases.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {layoutsError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load layouts</AlertTitle>
                <AlertDescription>{layoutsError}</AlertDescription>
              </Alert>
            ) : null}
            {layoutsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : layouts.length === 0 ? (
              <EmptyState
                title="No layouts yet"
                description="Create a layout before adding widgets."
              />
            ) : (
              <div className="space-y-2">
                {layouts.map((layout) => (
                  <button
                    key={layout.id}
                    type="button"
                    className={cn(
                      'w-full rounded-2xl border p-3 text-left transition hover:bg-accent hover:text-accent-foreground',
                      selectedLayoutId === layout.id
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-background',
                    )}
                    onClick={() => setSelectedLayoutId(layout.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {layout.name}
                        </div>
                        <div className="truncate text-xs opacity-75">
                          {layout.id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {layout.is_default && (
                          <Badge variant="secondary">Default</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (confirm(`Delete layout "${layout.name}"?`)) {
                              void deleteLayout(layout.id);
                              setSelectedLayoutId((current) =>
                                current === layout.id ? null : current,
                              );
                            }
                          }}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Widgets</CardTitle>
              <CardDescription>
                {selectedLayout
                  ? `Manage widgets in ${selectedLayout.name}.`
                  : 'Select a layout to manage widgets.'}
              </CardDescription>
            </div>
            <Button
              size="sm"
              disabled={!selectedLayoutId}
              onClick={() => setShowAddWidget(true)}
            >
              Add Widget
            </Button>
          </CardHeader>
          <CardContent>
            {widgetsError ? (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Could not load widgets</AlertTitle>
                <AlertDescription>{widgetsError}</AlertDescription>
              </Alert>
            ) : null}
            {!selectedLayoutId ? (
              <EmptyState
                title="No layout selected"
                description="Pick a layout from the list to edit its widgets."
              />
            ) : widgetsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : sortedWidgets.length === 0 ? (
              <EmptyState
                title="No widgets in this layout"
                description="Add the first widget to start building the dashboard."
              />
            ) : (
              <div className="space-y-3">
                <DashboardGridEditor
                  widgets={sortedWidgets}
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
            )}
          </CardContent>
        </Card>
      </div>

      {showAddLayout && (
        <AddLayoutOverlay
          isDefault={layouts.length === 0}
          onClose={() => setShowAddLayout(false)}
          onCreate={async (name) => {
            const layout = await createLayout({
              name,
              is_default: layouts.length === 0,
            });
            setSelectedLayoutId(layout.id);
            setShowAddLayout(false);
          }}
        />
      )}

      {showAddWidget && (
        <WidgetOverlay
          mode="add"
          onClose={() => setShowAddWidget(false)}
          onSubmit={async (widget) => {
            await addWidget({
              ...widget,
              position: widgets.length,
            });
            setShowAddWidget(false);
          }}
        />
      )}

      {editingWidget && (
        <WidgetOverlay
          mode="edit"
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSubmit={async (updated) => {
            await updateWidget(editingWidget.id, updated);
            setEditingWidget(null);
          }}
        />
      )}
    </div>
  );
}

function AddLayoutOverlay({
  isDefault,
  onClose,
  onCreate,
}: {
  isDefault: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Layout"
      description={
        isDefault
          ? 'This will become the default dashboard layout.'
          : 'Create another dashboard layout.'
      }
      className="max-w-xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <ConfigFormSection
          title="Layout details"
          description="Create a named dashboard layout that can hold widgets."
        >
          <ConfigField label="Layout name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main dashboard"
            />
          </ConfigField>
        </ConfigFormSection>
        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
