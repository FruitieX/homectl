import { useState } from 'react';

import { createUuid } from '@/lib/uuid';
import { useSensorData } from '@/hooks/influxdb';
import { useSensorCatalog } from '@/hooks/sensorCatalog';
import { useHelpers } from '@/hooks/useConfig';
import {
  type DashboardWidget,
  widgetRegistry,
  type WidgetType,
} from '@/hooks/useDashboard';
import { DASHBOARD_GRID_HELP } from '@/lib/dashboard-layout';
import {
  DEFAULT_MAX_MINUTES_AHEAD,
  MAX_MAX_MINUTES_AHEAD,
} from '@/lib/trainSchedule';
import { SensorChip } from '@/ui/SensorChip';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigHelpPanel,
} from '@/ui/config-form';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
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

function HelperOptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: helpers } = useHelpers();

  return (
    <ConfigField
      label="Helper"
      description="The mode widget shows this helper's current value and writes new values to it."
    >
      <select
        className={selectClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select a helper…</option>
        {(helpers ?? [])
          .filter((helper) => helper.hidden !== true)
          .map((helper) => (
            <option key={helper.id} value={helper.id}>
              {helper.name || helper.id} ({helper.kind.kind})
            </option>
          ))}
      </select>
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

function SensorPrimaryField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
}) {
  const sensors = useSensorData();
  const selected = typeof value === 'string' ? value : '';

  return (
    <ConfigField
      label="Header sensor"
      description="Shown beside the title in compact cards. Leave empty to use the first shown sensor."
    >
      <select
        className={selectClassName}
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">First shown sensor</option>
        {sensors.map((sensor) => (
          <option key={sensor.device_id} value={sensor.device_id}>
            {sensor.device_name}
          </option>
        ))}
      </select>
    </ConfigField>
  );
}

function SensorVisibilityField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string[]) => void;
}) {
  const sensors = useSensorData();
  const { catalog, saveCatalog } = useSensorCatalog();
  const options = [
    ...(catalog?.sensors ?? []),
    ...sensors
      .filter(
        (sensor) =>
          !(catalog?.sensors ?? []).some(
            (item) => item.id === sensor.device_id,
          ),
      )
      .map((sensor) => ({
        id: sensor.device_id,
        name: sensor.device_name,
        source: 'influxdb',
        enabled: true,
      })),
  ];
  const configured = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  const selected = new Set(
    configured.length > 0 ? configured : options.map((sensor) => sensor.id),
  );

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(
      next.size === options.length
        ? []
        : options
            .filter((sensor) => next.has(sensor.id))
            .map((sensor) => sensor.id),
    );
  };

  return (
    <div className="grid gap-2 md:col-span-2">
      <span className="text-sm font-medium leading-none text-foreground">
        Sensors shown
      </span>
      <span className="text-xs leading-5 text-muted-foreground">
        Choose which known sensors appear in this widget. An empty selection
        means all sensors.
      </span>
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/20 p-3 min-[600px]:grid-cols-4">
        {sensors
          .filter((sensor) =>
            options.some((option) => option.id === sensor.device_id),
          )
          .map((sensor) => (
            <div key={sensor.device_id} className="space-y-1">
              <SensorChip
                sensor={sensor}
                checked={selected.has(sensor.device_id)}
                onCheckedChange={(checked) => toggle(sensor.device_id, checked)}
              />
              <Input
                aria-label={`Name for ${sensor.device_name}`}
                className="h-8 text-xs"
                defaultValue={
                  options.find((option) => option.id === sensor.device_id)
                    ?.name ?? sensor.device_name
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (!name || !catalog) return;
                  const existing = catalog.sensors.find(
                    (item) => item.id === sensor.device_id,
                  );
                  const sensors = existing
                    ? catalog.sensors.map((item) =>
                        item.id === sensor.device_id ? { ...item, name } : item,
                      )
                    : [
                        ...catalog.sensors,
                        {
                          id: sensor.device_id,
                          name,
                          source: 'influxdb',
                          enabled: true,
                        },
                      ];
                  void saveCatalog({ sensors, groups: catalog.groups });
                }}
              />
            </div>
          ))}
      </div>
    </div>
  );
}

function SensorGroupsField() {
  const sensors = useSensorData();
  const { catalog, saveCatalog } = useSensorCatalog();
  const groups: Record<string, string[]> = Object.fromEntries(
    (catalog?.groups ?? []).map((group) => [group.name, group.sensorIds]),
  );
  const [newGroup, setNewGroup] = useState('');
  const addGroup = () => {
    const name = newGroup.trim();
    if (!name || groups[name]) return;
    const nextGroups = [
      ...(catalog?.groups ?? []),
      { id: createUuid(), name, sensorIds: [] },
    ];
    void saveCatalog({ sensors: catalog?.sensors ?? [], groups: nextGroups });
    setNewGroup('');
  };
  const updateGroup = (groupId: string, ids: string[]) => {
    const nextGroups = (catalog?.groups ?? []).map((group) =>
      group.id === groupId ? { ...group, sensorIds: ids } : group,
    );
    void saveCatalog({ sensors: catalog?.sensors ?? [], groups: nextGroups });
  };
  const renameGroup = (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !catalog) return;
    void saveCatalog({
      sensors: catalog.sensors,
      groups: catalog.groups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed } : group,
      ),
    });
  };

  return (
    <div className="grid gap-2 md:col-span-2">
      <span className="text-sm font-medium leading-none text-foreground">
        Sensor groups
      </span>
      <span className="text-xs leading-5 text-muted-foreground">
        Create your own groups for filtering the detail view, such as Upstairs
        or Bedrooms.
      </span>
      <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
        {(catalog?.groups ?? []).map((group) => (
          <div
            key={group.id}
            className="space-y-2 rounded-xl border border-border/70 bg-background p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label="Sensor group name"
                className="h-8 min-w-0 flex-1 text-sm font-medium"
                defaultValue={group.name}
                onBlur={(event) => renameGroup(group.id, event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void saveCatalog({
                    sensors: catalog?.sensors ?? [],
                    groups: (catalog?.groups ?? []).filter(
                      (item) => item.id !== group.id,
                    ),
                  });
                }}
              >
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 min-[600px]:grid-cols-4">
              {sensors.map((sensor) => (
                <SensorChip
                  key={sensor.device_id}
                  sensor={sensor}
                  checked={group.sensorIds.includes(sensor.device_id)}
                  onCheckedChange={(checked) =>
                    updateGroup(
                      group.id,
                      checked
                        ? [...group.sensorIds, sensor.device_id]
                        : group.sensorIds.filter(
                            (id) => id !== sensor.device_id,
                          ),
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newGroup}
            placeholder="New group name"
            onChange={(event) => setNewGroup(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addGroup();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addGroup}
            disabled={!newGroup.trim() || !catalog}
          >
            Add group
          </Button>
        </div>
      </div>
    </div>
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
          value={getString('outdoorSensorId')}
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
        <OptionCheckboxField
          label="Show 3-day forecast on widget"
          checked={getBoolean('showWidgetForecast', false)}
          onChange={(value) => onChange('showWidgetForecast', value)}
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

  if (widgetType === 'helper_mode') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <HelperOptionField
          value={getString('helperId')}
          onChange={(value) => onChange('helperId', value)}
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
        <SensorVisibilityField
          value={options.sensorIds}
          onChange={(value) => onChange('sensorIds', value)}
        />
        <SensorPrimaryField
          value={options.primarySensorId}
          onChange={(value) => onChange('primarySensorId', value)}
        />
        <SensorGroupsField />
        <OptionCheckboxField
          label="Wrap preview sensor chips"
          checked={getBoolean('wrapPreview', true)}
          onChange={(value) => onChange('wrapPreview', value)}
        />
      </div>
    );
  }

  if (widgetType === 'controls') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Group id"
          value={getString('groupId')}
          placeholder="living_room"
          onChange={(value) => onChange('groupId', value)}
        />
        <OptionCsvField
          label="Specific device keys"
          value={options.deviceKeys}
          onChange={(value) => onChange('deviceKeys', value)}
        />
        <ConfigHelpPanel>
          Specific device keys override the group. Leave both empty to show the
          first six controllable devices.
        </ConfigHelpPanel>
      </div>
    );
  }

  if (widgetType === 'spot_price') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <OptionTextField
          label="Spot price endpoint path"
          value={getString('spotPricePath', '/api/influxdb/spot-prices')}
          onChange={(value) => onChange('spotPricePath', value)}
        />
        <ConfigHelpPanel>
          Bars fade smoothly from green through amber to red as the price moves
          between these thresholds. Values are in c/kWh.
        </ConfigHelpPanel>
        <OptionNumberField
          label="Low price threshold"
          value={getNumber('lowPriceThreshold', 2)}
          onChange={(value) => onChange('lowPriceThreshold', value)}
        />
        <OptionNumberField
          label="Medium price threshold"
          value={getNumber('mediumPriceThreshold', 5)}
          onChange={(value) => onChange('mediumPriceThreshold', value)}
        />
        <OptionNumberField
          label="High price threshold"
          value={getNumber('highPriceThreshold', 8)}
          onChange={(value) => onChange('highPriceThreshold', value)}
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
        <OptionTextField
          label="Destination contains"
          value={getString('destination', '')}
          onChange={(value) => onChange('destination', value)}
        />
        <label className="space-y-2 text-sm">
          <span className="block font-medium">Direction</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            value={getString('directionId', '')}
            onChange={(event) => onChange('directionId', event.target.value)}
          >
            <option value="">Both directions</option>
            <option value="0">Direction 0</option>
            <option value="1">Direction 1</option>
          </select>
          <span className="block text-xs text-muted-foreground">
            Direction numbers vary by route. Use a destination such as Helsinki
            to filter several routes together.
          </span>
        </label>
        <OptionNumberField
          label="Walk minutes"
          value={getNumber('walkMinutes', 12)}
          min={0}
          max={240}
          onChange={(value) => onChange('walkMinutes', value)}
        />
        <OptionNumberField
          label="Show departures overdue by (minutes)"
          value={getNumber('overdueMinutes', 3)}
          min={0}
          max={60}
          onChange={(value) => onChange('overdueMinutes', value)}
        />
        <OptionNumberField
          label="Show departures up to (minutes ahead)"
          value={getNumber('maxMinutesAhead', DEFAULT_MAX_MINUTES_AHEAD)}
          min={0}
          max={MAX_MAX_MINUTES_AHEAD}
          onChange={(value) => onChange('maxMinutesAhead', value)}
        />
        <OptionNumberField
          label="Result limit"
          value={getNumber('limit', 5)}
          min={1}
          max={20}
          onChange={(value) => onChange('limit', value)}
        />
        <OptionNumberField
          label="Departures visible in card"
          value={getNumber('displayLimit', 3)}
          min={1}
          max={20}
          onChange={(value) => onChange('displayLimit', value)}
        />
        <OptionCheckboxField
          label="Scroll for additional departures"
          checked={getBoolean('scrollMore', false)}
          onChange={(value) => onChange('scrollMore', value)}
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

export function WidgetOverlay({
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
          : 'Adjust widget settings, layout, and advanced options.'
      }
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
            <TabsTrigger value="options">Advanced</TabsTrigger>
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
            <ConfigFormSection
              title="Widget settings"
              description="Common options for this widget instance. Use Advanced for raw JSON fields."
            >
              <WidgetOptionFields
                widgetType={widgetType}
                options={parsedOptions}
                onChange={setOption}
              />
            </ConfigFormSection>
          </TabsContent>

          <TabsContent value="layout" className="mt-4">
            <ConfigFormSection
              title="Layout footprint"
              description="Control how many grid cells this widget occupies."
            >
              <ConfigHelpPanel>
                {DASHBOARD_GRID_HELP} Keep critical widgets at the top by
                ordering them first on the dashboard.
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
