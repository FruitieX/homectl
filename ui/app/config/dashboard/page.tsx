import { useEffect, useState } from 'react';

import {
  useDashboardLayouts,
  useDashboardWidgets,
  widgetRegistry,
  type DashboardWidget,
  type WidgetType,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigHelpPanel,
} from '@/ui/config-form';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';

const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const isWidgetType = (value: string): value is WidgetType =>
  value in widgetRegistry;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export default function DashboardConfigPage() {
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Dashboard Configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            Compose mobile-first dashboards from reusable widgets and layouts.
          </p>
        </div>
        <Button onClick={() => setShowAddLayout(true)}>Add Layout</Button>
      </div>

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
              <div className="grid gap-3">
                {sortedWidgets.map((widget, index) => (
                  <Card key={widget.id} className="rounded-2xl bg-muted/30">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium">{widget.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {widgetRegistry[widget.widget_type]?.name ||
                            widget.widget_type}
                          <span className="ml-2">
                            ({widget.width}×{widget.height})
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Position {widget.position + 1} · grid {widget.x},{' '}
                          {widget.y}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={index === 0}
                          onClick={() => {
                            const nextIds = sortedWidgets.map(
                              (item) => item.id,
                            );
                            [nextIds[index - 1], nextIds[index]] = [
                              nextIds[index],
                              nextIds[index - 1],
                            ];
                            void reorderWidgets(nextIds);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={index === sortedWidgets.length - 1}
                          onClick={() => {
                            const nextIds = sortedWidgets.map(
                              (item) => item.id,
                            );
                            [nextIds[index], nextIds[index + 1]] = [
                              nextIds[index + 1],
                              nextIds[index],
                            ];
                            void reorderWidgets(nextIds);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingWidget(widget)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Remove widget "${widget.title}"?`)) {
                              void removeWidget(widget.id);
                            }
                          }}
                        >
                          ✕
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Available Widget Types</CardTitle>
          <CardDescription>
            These presets can be added to any dashboard layout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(widgetRegistry).map(([type, info]) => (
              <Card key={type} className="rounded-2xl bg-muted/30">
                <CardContent className="p-4">
                  <div className="font-medium">{info.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {info.description}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

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

function WidgetOverlay({
  mode,
  widget,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'edit';
  widget?: DashboardWidget;
  onClose: () => void;
  onSubmit: (widget: Partial<DashboardWidget>) => Promise<void>;
}) {
  const initialWidgetType = widget?.widget_type ?? 'clock';
  const [widgetType, setWidgetType] = useState<WidgetType>(initialWidgetType);
  const [title, setTitle] = useState(
    widget?.title ?? widgetRegistry[initialWidgetType].name,
  );
  const [width, setWidth] = useState(widget?.width ?? 2);
  const [height, setHeight] = useState(widget?.height ?? 2);
  const [options, setOptions] = useState(
    JSON.stringify(
      widget?.options ?? widgetRegistry[initialWidgetType].defaultOptions,
      null,
      2,
    ),
  );
  const [editTab, setEditTab] = useState<'basics' | 'layout' | 'options'>(
    'basics',
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const registryItem = widgetRegistry[widgetType];
  const changeTab = (value: string) => {
    if (value === 'basics' || value === 'layout' || value === 'options') {
      setEditTab(value);
    }
  };

  const submit = async () => {
    setSubmitError(null);
    let parsedOptions: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(options);
      parsedOptions = isRecord(parsed) ? parsed : {};
    } catch {
      setSubmitError('Options must be valid JSON.');
      setEditTab('options');
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        widget_type: widgetType,
        title: title || registryItem.name,
        width,
        height,
        options: parsedOptions,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to save widget.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={mode === 'add' ? 'Add Widget' : 'Edit Widget'}
      description={
        mode === 'add'
          ? 'Choose a widget preset and customize its layout footprint.'
          : 'Adjust widget title, size, and JSON options.'
      }
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
            <TabsTrigger value="options">Options</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="mt-4 space-y-4">
            <ConfigFormSection
              title="Widget basics"
              description="Choose what the widget shows and how it is labeled on the dashboard."
            >
              <ConfigField label="Widget Type">
                {mode === 'add' ? (
                  <select
                    className={selectClassName}
                    value={widgetType}
                    onChange={(event) => {
                      const type = event.target.value;
                      if (!isWidgetType(type)) {
                        return;
                      }
                      setWidgetType(type);
                      setTitle(widgetRegistry[type].name);
                      setOptions(
                        JSON.stringify(
                          widgetRegistry[type].defaultOptions,
                          null,
                          2,
                        ),
                      );
                    }}
                  >
                    {Object.entries(widgetRegistry).map(([type, info]) => (
                      <option key={type} value={type}>
                        {info.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">
                    {registryItem?.name || widget?.widget_type}
                  </Badge>
                )}
              </ConfigField>

              <ConfigField label="Title">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </ConfigField>
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="layout" className="mt-4">
            <ConfigFormSection
              title="Layout footprint"
              description="Control how many grid cells this widget occupies."
            >
              <ConfigHelpPanel>
                Widgets span the full screen width on phones, then use the
                configured width as more columns become available. Keep critical
                widgets at the top by ordering them first in the list.
              </ConfigHelpPanel>
              <div className="grid grid-cols-2 gap-4">
                <ConfigField label="Width">
                  <Input
                    type="number"
                    value={width}
                    onChange={(event) =>
                      setWidth(parseInt(event.target.value) || 1)
                    }
                    min={1}
                    max={8}
                  />
                </ConfigField>
                <ConfigField label="Height">
                  <Input
                    type="number"
                    value={height}
                    onChange={(event) =>
                      setHeight(parseInt(event.target.value) || 1)
                    }
                    min={1}
                    max={8}
                  />
                </ConfigField>
              </div>
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="options" className="mt-4">
            <ConfigFormSection
              title="Widget options"
              description="Advanced per-widget settings stored as JSON."
            >
              <ConfigField label="Options (JSON)">
                <Textarea
                  className="h-96 font-mono text-sm"
                  value={options}
                  onChange={(event) => setOptions(event.target.value)}
                />
              </ConfigField>
            </ConfigFormSection>
          </TabsContent>
        </Tabs>

        {submitError ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Widget was not saved</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={submitting}
            onClick={() => {
              void submit();
            }}
          >
            {submitting ? 'Saving…' : mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
