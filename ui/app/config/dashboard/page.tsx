import { useEffect, useState } from 'react';

import { ConfigPageHeader } from '../page-header';
import {
  useDashboardLayouts,
  useDashboardWidgets,
  widgetRegistry,
  type DashboardWidget,
  type WidgetType,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import { DASHBOARD_GRID_HELP } from '@/lib/dashboard-layout';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigHelpPanel,
} from '@/ui/config-form';
import { DashboardGridEditor } from '@/ui/DashboardGridEditor';
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

const toCsv = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .join(', ')
    : typeof value === 'string'
      ? value
      : '';

const fromCsv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

function OptionTextField({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'url' | 'password';
  onChange: (value: string) => void;
}) {
  return (
    <ConfigField label={label}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </ConfigField>
  );
}

function OptionNumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <ConfigField label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.valueAsNumber || 0)}
      />
    </ConfigField>
  );
}

function OptionCheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4">
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

function OptionCsvField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: unknown;
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <ConfigField label={label} description="Comma-separated values.">
      <Input
        value={toCsv(value)}
        placeholder={placeholder}
        onChange={(event) => onChange(fromCsv(event.target.value))}
      />
    </ConfigField>
  );
}

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
      <ConfigPageHeader
        title="Dashboard Configuration"
        description="Compose mobile-first dashboards from reusable widgets and layouts."
        actions={
          <Button onClick={() => setShowAddLayout(true)}>Add Layout</Button>
        }
      />

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

function WidgetOptionFields({
  widgetType,
  options,
  onChange,
}: {
  widgetType: WidgetType;
  options: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const getString = (key: string, fallback = '') => {
    const value = options[key];
    return typeof value === 'string' ? value : fallback;
  };
  const getNumber = (key: string, fallback: number) => {
    const value = options[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  };
  const getBoolean = (key: string, fallback: boolean) => {
    const value = options[key];
    return typeof value === 'boolean' ? value : fallback;
  };

  if (widgetType === 'clock') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Calendar ICS URL"
          type="url"
          value={getString('calendarUrl')}
          placeholder="https://calendar.google.com/.../basic.ics"
          onChange={(value) => onChange('calendarUrl', value)}
        />
        <OptionTextField
          label="Calendar endpoint path"
          value={getString('calendarPath', '/api/calendar')}
          onChange={(value) => onChange('calendarPath', value)}
        />
        <OptionCheckboxField
          label="Show calendar summary"
          checked={getBoolean('showCalendar', true)}
          onChange={(value) => onChange('showCalendar', value)}
        />
        <OptionCheckboxField
          label="Show date under clock"
          checked={getBoolean('showDate', true)}
          onChange={(value) => onChange('showDate', value)}
        />
        <OptionCheckboxField
          label="Show seconds"
          checked={getBoolean('showSeconds', false)}
          onChange={(value) => onChange('showSeconds', value)}
        />
      </div>
    );
  }

  if (widgetType === 'weather') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Weather API URL"
          type="url"
          value={getString('weatherUrl')}
          onChange={(value) => onChange('weatherUrl', value)}
        />
        <OptionTextField
          label="Weather endpoint path"
          value={getString('weatherPath', '/api/weather')}
          onChange={(value) => onChange('weatherPath', value)}
        />
        <OptionTextField
          label="Outdoor temperature sensor id"
          value={getString('outdoorSensorId', 'D83534387029')}
          onChange={(value) => onChange('outdoorSensorId', value)}
        />
        <OptionTextField
          label="Sensor endpoint path"
          value={getString('sensorPath', '/api/influxdb/temp-sensors')}
          onChange={(value) => onChange('sensorPath', value)}
        />
        <OptionNumberField
          label="Hourly forecast hours"
          value={getNumber('forecastHours', 48)}
          min={1}
          max={120}
          onChange={(value) => onChange('forecastHours', value)}
        />
        <OptionNumberField
          label="Long-term days"
          value={getNumber('forecastDays', 5)}
          min={1}
          max={10}
          onChange={(value) => onChange('forecastDays', value)}
        />
        <OptionNumberField
          label="Refresh seconds"
          value={getNumber('refreshSeconds', 60)}
          min={30}
          onChange={(value) => onChange('refreshSeconds', value)}
        />
      </div>
    );
  }

  if (widgetType === 'sensors') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="InfluxDB URL"
          type="url"
          value={getString('influxUrl')}
          onChange={(value) => onChange('influxUrl', value)}
        />
        <OptionTextField
          label="InfluxDB token"
          type="password"
          value={getString('influxToken')}
          onChange={(value) => onChange('influxToken', value)}
        />
        <OptionTextField
          label="Sensor endpoint path"
          value={getString('sensorPath', '/api/influxdb/temp-sensors')}
          onChange={(value) => onChange('sensorPath', value)}
        />
        <OptionTextField
          label="Range"
          value={getString('range', '-6h')}
          onChange={(value) => onChange('range', value)}
        />
        <OptionTextField
          label="Aggregation window"
          value={getString('window', '10m')}
          onChange={(value) => onChange('window', value)}
        />
        <OptionCsvField
          label="Sensor ids to query"
          value={options.sensorIds}
          onChange={(value) => onChange('sensorIds', value)}
        />
        <OptionCsvField
          label="Indoor sensor ids"
          value={options.indoorSensorIds}
          onChange={(value) => onChange('indoorSensorIds', value)}
        />
        <OptionCsvField
          label="Priority sensor ids"
          value={options.prioritySensorIds}
          onChange={(value) => onChange('prioritySensorIds', value)}
        />
        <OptionCheckboxField
          label="Wrap preview sensor chips"
          checked={getBoolean('wrapPreview', true)}
          onChange={(value) => onChange('wrapPreview', value)}
        />
      </div>
    );
  }

  if (widgetType === 'train_schedule') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Train API URL"
          type="url"
          value={getString('trainApiUrl')}
          onChange={(value) => onChange('trainApiUrl', value)}
        />
        <OptionTextField
          label="Train endpoint path"
          value={getString('trainSchedulePath', '/api/train-schedule')}
          onChange={(value) => onChange('trainSchedulePath', value)}
        />
        <OptionTextField
          label="Station id"
          value={getString('stationId', 'HSL:2131551')}
          onChange={(value) => onChange('stationId', value)}
        />
        <OptionNumberField
          label="Walk minutes"
          value={getNumber('walkMinutes', 12)}
          min={0}
          onChange={(value) => onChange('walkMinutes', value)}
        />
        <OptionNumberField
          label="Result limit"
          value={getNumber('limit', 5)}
          min={1}
          max={20}
          onChange={(value) => onChange('limit', value)}
        />
      </div>
    );
  }

  if (widgetType === 'text') {
    return (
      <ConfigField label="Body text">
        <Textarea
          className="min-h-32"
          value={getString('body')}
          onChange={(event) => onChange('body', event.target.value)}
        />
      </ConfigField>
    );
  }

  if (widgetType === 'link') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="URL"
          value={getString('url', '/')}
          onChange={(value) => onChange('url', value)}
        />
        <OptionTextField
          label="Button label"
          value={getString('label', 'Open')}
          onChange={(value) => onChange('label', value)}
        />
        <OptionTextField
          label="Description"
          value={getString('description')}
          onChange={(value) => onChange('description', value)}
        />
      </div>
    );
  }

  if (widgetType === 'iframe') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Iframe URL"
          type="url"
          value={getString('url')}
          onChange={(value) => onChange('url', value)}
        />
        <OptionTextField
          label="Iframe title"
          value={getString('title', 'Embedded view')}
          onChange={(value) => onChange('title', value)}
        />
      </div>
    );
  }

  if (widgetType === 'image') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Image URL"
          type="url"
          value={getString('imageUrl')}
          onChange={(value) => onChange('imageUrl', value)}
        />
        <OptionTextField
          label="Alt text"
          value={getString('alt', 'Dashboard image')}
          onChange={(value) => onChange('alt', value)}
        />
      </div>
    );
  }

  return (
    <ConfigHelpPanel>
      This widget type only exposes advanced JSON options for now.
    </ConfigHelpPanel>
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
  const parsedOptions = (() => {
    try {
      const parsed: unknown = JSON.parse(options);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })();
  const setOption = (key: string, value: unknown) => {
    setOptions(
      JSON.stringify(
        {
          ...parsedOptions,
          [key]: value,
        },
        null,
        2,
      ),
    );
  };
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
                {DASHBOARD_GRID_HELP} Keep critical widgets at the top by
                ordering them first in the visual editor.
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
              title="Widget settings"
              description="Common options for this widget instance. Advanced JSON below stays in sync with these fields."
              className="mb-4"
            >
              <WidgetOptionFields
                widgetType={widgetType}
                options={parsedOptions}
                onChange={setOption}
              />
            </ConfigFormSection>
            <ConfigFormSection
              title="Advanced JSON"
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
