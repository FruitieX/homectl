import { useCallback, useEffect, useState } from 'react';
import { useAppConfig } from './appConfig';

// Widget type definitions
export type WidgetType =
  | 'clock'
  | 'weather'
  | 'sensors'
  | 'controls'
  | 'spot_price'
  | 'train_schedule'
  | 'custom';

export interface DashboardWidget {
  id: string;
  widget_type: WidgetType;
  title: string;
  position: number;
  width: number;
  height: number;
  options: Record<string, unknown>;
}

export interface DashboardLayout {
  id: string;
  name: string;
  is_default: boolean;
}

const ABSOLUTE_URL_PATTERN = /^[a-z]+:\/\//i;

export function getDashboardWidgetOptionString(
  widget: DashboardWidget | null | undefined,
  optionKey: string,
  fallbackValue: string,
) {
  const value = widget?.options[optionKey];
  return typeof value === 'string' && value.trim() ? value : fallbackValue;
}

export function resolveDashboardWidgetUrl(apiEndpoint: string, path: string) {
  return ABSOLUTE_URL_PATTERN.test(path) ? path : `${apiEndpoint}${path}`;
}

type DashboardLayoutRow = {
  id: number;
  name: string;
  is_default: boolean;
};

type DashboardWidgetRow = {
  id: number;
  layout_id: number;
  widget_type: string;
  config: unknown;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  sort_order: number;
};

// Widget registry - maps widget types to their metadata
export const widgetRegistry: Record<
  WidgetType,
  { name: string; description: string; defaultOptions: Record<string, unknown> }
> = {
  clock: {
    name: 'Clock',
    description: 'Displays current time and date',
    defaultOptions: {
      showSeconds: false,
      showDate: true,
      calendarPath: '/api/calendar',
    },
  },
  weather: {
    name: 'Weather',
    description: 'Shows weather forecast',
    defaultOptions: {
      location: '',
      units: 'metric',
      weatherPath: '/api/weather',
      sensorPath: '/api/influxdb/temp-sensors',
    },
  },
  sensors: {
    name: 'Sensors',
    description: 'Displays sensor data charts',
    defaultOptions: {
      sensorIds: [],
      sensorPath: '/api/influxdb/temp-sensors',
    },
  },
  controls: {
    name: 'Controls',
    description: 'Quick control buttons for scenes and devices',
    defaultOptions: { groupId: null },
  },
  spot_price: {
    name: 'Spot Price',
    description: 'Electricity spot price display',
    defaultOptions: {
      region: 'FI',
      spotPricePath: '/api/influxdb/spot-prices',
    },
  },
  train_schedule: {
    name: 'Train Schedule',
    description: 'Upcoming train departures',
    defaultOptions: {
      stationCode: '',
      limit: 5,
      trainSchedulePath: '/api/train-schedule',
    },
  },
  custom: {
    name: 'Custom',
    description: 'Custom widget with HTML/JS',
    defaultOptions: { content: '' },
  },
};

export const defaultDashboardWidgets: DashboardWidget[] = [
  {
    id: 'default-weather',
    widget_type: 'weather',
    title: widgetRegistry.weather.name,
    position: 0,
    width: 1,
    height: 1,
    options: widgetRegistry.weather.defaultOptions,
  },
  {
    id: 'default-controls',
    widget_type: 'controls',
    title: widgetRegistry.controls.name,
    position: 1,
    width: 1,
    height: 1,
    options: widgetRegistry.controls.defaultOptions,
  },
  {
    id: 'default-clock',
    widget_type: 'clock',
    title: widgetRegistry.clock.name,
    position: 2,
    width: 2,
    height: 1,
    options: widgetRegistry.clock.defaultOptions,
  },
  {
    id: 'default-sensors',
    widget_type: 'sensors',
    title: widgetRegistry.sensors.name,
    position: 3,
    width: 4,
    height: 1,
    options: widgetRegistry.sensors.defaultOptions,
  },
  {
    id: 'default-spot-price',
    widget_type: 'spot_price',
    title: widgetRegistry.spot_price.name,
    position: 4,
    width: 4,
    height: 1,
    options: widgetRegistry.spot_price.defaultOptions,
  },
  {
    id: 'default-train-schedule',
    widget_type: 'train_schedule',
    title: widgetRegistry.train_schedule.name,
    position: 5,
    width: 4,
    height: 1,
    options: widgetRegistry.train_schedule.defaultOptions,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWidgetType(widgetType: string): WidgetType {
  return widgetType in widgetRegistry ? (widgetType as WidgetType) : 'custom';
}

function toDashboardLayout(row: DashboardLayoutRow): DashboardLayout {
  return {
    id: String(row.id),
    name: row.name,
    is_default: row.is_default,
  };
}

function toDashboardLayoutRow(layout: Partial<DashboardLayout>): DashboardLayoutRow {
  return {
    id: layout.id ? Number(layout.id) : 0,
    name: layout.name ?? 'New layout',
    is_default: layout.is_default ?? false,
  };
}

function toDashboardWidget(row: DashboardWidgetRow): DashboardWidget {
  const widgetType = getWidgetType(row.widget_type);
  const config = isRecord(row.config) ? row.config : {};
  const title = typeof config.title === 'string' ? config.title : widgetRegistry[widgetType].name;
  const options = isRecord(config.options) ? config.options : config;

  return {
    id: String(row.id),
    widget_type: widgetType,
    title,
    position: row.sort_order,
    width: row.grid_w,
    height: row.grid_h,
    options,
  };
}

function toDashboardWidgetRow(
  layoutId: string,
  widget: Partial<DashboardWidget>,
  existingRow?: DashboardWidgetRow,
): DashboardWidgetRow {
  const widgetType = widget.widget_type ?? getWidgetType(existingRow?.widget_type ?? 'custom');
  const registryEntry = widgetRegistry[widgetType];
  const existingConfig = isRecord(existingRow?.config) ? existingRow.config : {};
  const existingOptions = isRecord(existingConfig.options) ? existingConfig.options : {};

  return {
    id: widget.id ? Number(widget.id) : existingRow?.id ?? 0,
    layout_id: Number(layoutId),
    widget_type: widgetType,
    config: {
      ...existingConfig,
      title:
        widget.title ??
        (typeof existingConfig.title === 'string' ? existingConfig.title : registryEntry.name),
      options: widget.options ?? existingOptions ?? registryEntry.defaultOptions,
    },
    grid_x: existingRow?.grid_x ?? 0,
    grid_y: existingRow?.grid_y ?? 0,
    grid_w: widget.width ?? existingRow?.grid_w ?? 2,
    grid_h: widget.height ?? existingRow?.grid_h ?? 2,
    sort_order: widget.position ?? existingRow?.sort_order ?? 0,
  };
}

// Hook for managing dashboard layouts
export function useDashboardLayouts() {
  const { apiEndpoint } = useAppConfig();
  const [layouts, setLayouts] = useState<DashboardLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `${apiEndpoint}/api/v1/config/dashboard/layouts`;

  const fetchLayouts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(baseUrl);
      const result = await response.json();
      if (result.success) {
        setLayouts((result.data as DashboardLayoutRow[]).map(toDashboardLayout));
      } else {
        setError(result.error || 'Failed to fetch layouts');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchLayouts();
  }, [fetchLayouts]);

  const createLayout = useCallback(
    async (layout: Partial<DashboardLayout>) => {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toDashboardLayoutRow(layout)),
      });
      const result = await response.json();
      if (result.success) {
        await fetchLayouts();
        return toDashboardLayout(result.data as DashboardLayoutRow);
      }
      throw new Error(result.error || 'Failed to create layout');
    },
    [baseUrl, fetchLayouts],
  );

  const deleteLayout = useCallback(
    async (id: string) => {
      const response = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        await fetchLayouts();
      } else {
        throw new Error(result.error || 'Failed to delete layout');
      }
    },
    [baseUrl, fetchLayouts],
  );

  return { layouts, loading, error, refetch: fetchLayouts, createLayout, deleteLayout };
}

// Hook for managing widgets in a layout
export function useDashboardWidgets(layoutId: string | null) {
  const { apiEndpoint } = useAppConfig();
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [widgetRows, setWidgetRows] = useState<DashboardWidgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `${apiEndpoint}/api/v1/config/dashboard`;

  const fetchWidgets = useCallback(async () => {
    if (!layoutId) {
      setWidgets([]);
      setWidgetRows([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${baseUrl}/layouts/${layoutId}/widgets`);
      const result = await response.json();
      if (result.success) {
        const nextRows = result.data as DashboardWidgetRow[];
        setWidgetRows(nextRows);
        setWidgets(nextRows.map(toDashboardWidget));
      } else {
        setError(result.error || 'Failed to fetch widgets');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, layoutId]);

  useEffect(() => {
    fetchWidgets();
  }, [fetchWidgets]);

  const addWidget = useCallback(
    async (widget: Partial<DashboardWidget>) => {
      if (!layoutId) {
        throw new Error('A layout must be selected before adding a widget');
      }

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toDashboardWidgetRow(layoutId, widget)),
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
        return toDashboardWidget(result.data as DashboardWidgetRow);
      }
      throw new Error(result.error || 'Failed to add widget');
    },
    [baseUrl, layoutId, fetchWidgets],
  );

  const updateWidget = useCallback(
    async (id: string, widget: Partial<DashboardWidget>) => {
      if (!layoutId) {
        throw new Error('A layout must be selected before updating a widget');
      }

      const existingRow = widgetRows.find((row) => String(row.id) === id);
      const response = await fetch(`${baseUrl}/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          toDashboardWidgetRow(layoutId, { ...widget, id }, existingRow),
        ),
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
        return toDashboardWidget(result.data as DashboardWidgetRow);
      }
      throw new Error(result.error || 'Failed to update widget');
    },
    [baseUrl, fetchWidgets, layoutId, widgetRows],
  );

  const removeWidget = useCallback(
    async (id: string) => {
      const response = await fetch(`${baseUrl}/widgets/${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
      } else {
        throw new Error(result.error || 'Failed to remove widget');
      }
    },
    [baseUrl, fetchWidgets],
  );

  const reorderWidgets = useCallback(
    async (widgetIds: string[]) => {
      if (!layoutId) {
        throw new Error('A layout must be selected before reordering widgets');
      }

      const nextRows = widgetIds.map((id, index) => {
        const existingRow = widgetRows.find((row) => String(row.id) === id);
        if (!existingRow) {
          throw new Error(`Failed to reorder widgets: missing widget ${id}`);
        }

        return toDashboardWidgetRow(
          layoutId,
          {
            id,
            position: index,
          },
          existingRow,
        );
      });

      await Promise.all(
        nextRows.map(async (row) => {
          const response = await fetch(`${baseUrl}/widgets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row),
          });
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || 'Failed to reorder widgets');
          }
        }),
      );

      await fetchWidgets();
    },
    [baseUrl, fetchWidgets, layoutId, widgetRows],
  );

  return {
    widgets,
    loading,
    error,
    refetch: fetchWidgets,
    addWidget,
    updateWidget,
    removeWidget,
    reorderWidgets,
  };
}
