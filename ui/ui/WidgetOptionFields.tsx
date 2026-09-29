import { Link } from 'react-router-dom';
import { useSensorData } from '@/hooks/influxdb';
import { useSensorCatalog } from '@/hooks/sensorCatalog';
import { useGroups, useHelpers } from '@/hooks/useConfig';
import { type WidgetType } from '@/hooks/useDashboard';
import {
  DEFAULT_MAX_MINUTES_AHEAD,
  MAX_MAX_MINUTES_AHEAD,
} from '@/lib/trainSchedule';
import { SearchableMultiPicker } from '@/ui/SearchablePicker';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigField, ConfigHelpPanel } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';

const selectClassName = 'settings-select';

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
        aria-label={label}
        data-field={`option-${label}`}
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
  value: number | string;
  min?: number;
  max?: number;
  onChange: (value: number | string) => void;
}) {
  return (
    <ConfigField label={label}>
      <Input
        type="number"
        aria-label={label}
        data-field={`option-${label}`}
        value={value}
        min={min}
        max={max}
        onChange={(event) =>
          onChange(
            Number.isFinite(event.target.valueAsNumber)
              ? event.target.valueAsNumber
              : event.target.value,
          )
        }
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
        {value && !helpers?.some((helper) => helper.id === value) && (
          <option value={value}>{value} · Unavailable</option>
        )}
        {(helpers ?? [])
          .filter((helper) => helper.hidden !== true || helper.id === value)
          .map((helper) => (
            <option key={helper.id} value={helper.id}>
              {helper.name || helper.id} ({helper.kind.kind})
            </option>
          ))}
      </select>
      {value && (
        <Link
          className="settings-link text-xs"
          to={configItemHref('helper', value)}
        >
          Open helper
        </Link>
      )}
    </ConfigField>
  );
}

function GroupOptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: groups } = useGroups();

  return (
    <ConfigField
      label="Group"
      description="Show controls for this group. Specific device keys below override it."
    >
      <select
        className={selectClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All controllable devices</option>
        {value && !groups?.some((group) => group.id === value) && (
          <option value={value}>{value} · Unavailable</option>
        )}
        {(groups ?? []).map((group) => (
          <option key={group.id} value={group.id}>
            {group.name} ({group.id})
          </option>
        ))}
      </select>
      {value && (
        <Link
          className="settings-link text-xs"
          to={configItemHref('group', value)}
        >
          Open room or group
        </Link>
      )}
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
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
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
        {selected &&
          !sensors.some((sensor) => sensor.device_id === selected) && (
            <option value={selected}>{selected} · Unavailable</option>
          )}
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
  mode,
  onChange,
  onModeChange,
}: {
  value: unknown;
  mode: unknown;
  onChange: (value: string[]) => void;
  onModeChange: (mode: string) => void;
}) {
  const sensors = useSensorData();
  const { catalog } = useSensorCatalog();
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  const options = [
    ...(catalog?.sensors ?? []).map((sensor) => ({
      value: sensor.id,
      label: sensor.name,
    })),
    ...sensors
      .filter(
        (sensor) =>
          !catalog?.sensors.some((item) => item.id === sensor.device_id),
      )
      .map((sensor) => ({
        value: sensor.device_id,
        label: sensor.device_name,
      })),
  ];
  const effectiveMode =
    mode === 'all' || mode === 'selected'
      ? mode
      : selected.length
        ? 'selected'
        : 'all';
  return (
    <div className="space-y-3 md:col-span-2">
      <label className="block space-y-2 text-sm">
        <span className="font-medium">Sensors shown</span>
        <select
          aria-label="Sensors shown"
          className="settings-select"
          value={effectiveMode}
          onChange={(event) => onModeChange(event.target.value)}
        >
          <option value="all">All enabled sensors</option>
          <option value="selected">Selected sensors</option>
        </select>
      </label>
      {effectiveMode === 'selected' && (
        <>
          <SearchableMultiPicker
            options={options}
            value={selected}
            onChange={onChange}
            placeholder="Add sensors…"
          />
          <p className="text-xs text-muted-foreground">
            {selected.length} selected. An empty selection shows no sensors.
          </p>
        </>
      )}
    </div>
  );
}

function DeviceSelectionField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string[]) => void;
}) {
  const api = useDevicesApi();
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Specific devices</span>
      <SearchableMultiPicker
        value={
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : []
        }
        options={api.devices
          .filter((device) => 'Controllable' in device.data)
          .map((device) => ({
            value: device.integration_id + '/' + device.id,
            label: device.name,
          }))}
        onChange={onChange}
        placeholder="Add devices…"
        hrefFor={(key) => configItemHref('device', key)}
      />
      {api.error && (
        <p role="alert">Device catalog unavailable; selections are kept.</p>
      )}
    </div>
  );
}

export function WidgetOptionFields({
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
    return typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
      ? value
      : fallback;
  };
  const getBoolean = (key: string, fallback: boolean) => {
    const value = options[key];
    return typeof value === 'boolean' ? value : fallback;
  };

  if (widgetType === 'home_overview')
    return (
      <p className="text-sm text-muted-foreground">
        Shows the home's scene shortcuts and room summaries. Room and scene
        settings control their content.
      </p>
    );

  if (widgetType === 'clock') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
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
          mode={options.sensorSelection}
          onModeChange={(value) => onChange('sensorSelection', value)}
          value={options.sensorIds}
          onChange={(value) => onChange('sensorIds', value)}
        />
        <SensorPrimaryField
          value={options.primarySensorId}
          onChange={(value) => onChange('primarySensorId', value)}
        />
        <Link
          className="settings-link text-sm md:col-span-2"
          to="/config/sensors"
        >
          Manage sensor names and groups
        </Link>
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
        <GroupOptionField
          value={getString('groupId')}
          onChange={(value) => onChange('groupId', value)}
        />
        <DeviceSelectionField
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

  if (widgetType === 'custom') {
    return (
      <div className="grid gap-4">
        <ConfigField
          label="HTML"
          description="Rendered in a sandboxed frame; scripts do not run."
        >
          <Textarea
            className="min-h-48 font-mono text-xs"
            placeholder="<div style='padding: 1rem'>Hello</div>"
            value={getString('content')}
            onChange={(event) => onChange('content', event.target.value)}
          />
        </ConfigField>
      </div>
    );
  }

  return (
    <ConfigHelpPanel>
      This widget type only exposes advanced JSON options for now.
    </ConfigHelpPanel>
  );
}
