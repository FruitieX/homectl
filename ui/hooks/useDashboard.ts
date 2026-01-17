'use client';

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

// Widget registry - maps widget types to their metadata
export const widgetRegistry: Record<
  WidgetType,
  { name: string; description: string; defaultOptions: Record<string, unknown> }
> = {
  clock: {
    name: 'Clock',
    description: 'Displays current time and date',
    defaultOptions: { showSeconds: false, showDate: true },
  },
  weather: {
    name: 'Weather',
    description: 'Shows weather forecast',
    defaultOptions: { location: '', units: 'metric' },
  },
  sensors: {
    name: 'Sensors',
    description: 'Displays sensor data charts',
    defaultOptions: { sensorIds: [] },
  },
  controls: {
    name: 'Controls',
    description: 'Quick control buttons for scenes and devices',
    defaultOptions: { groupId: null },
  },
  spot_price: {
    name: 'Spot Price',
    description: 'Electricity spot price display',
    defaultOptions: { region: 'FI' },
  },
  train_schedule: {
    name: 'Train Schedule',
    description: 'Upcoming train departures',
    defaultOptions: { stationCode: '', limit: 5 },
  },
  custom: {
    name: 'Custom',
    description: 'Custom widget with HTML/JS',
    defaultOptions: { content: '' },
  },
};

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
        setLayouts(result.data);
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
        body: JSON.stringify(layout),
      });
      const result = await response.json();
      if (result.success) {
        await fetchLayouts();
        return result.data;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `${apiEndpoint}/api/v1/config/dashboard/widgets`;

  const fetchWidgets = useCallback(async () => {
    if (!layoutId) {
      setWidgets([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${baseUrl}?layout_id=${layoutId}`);
      const result = await response.json();
      if (result.success) {
        setWidgets(result.data);
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
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...widget, layout_id: layoutId }),
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
        return result.data;
      }
      throw new Error(result.error || 'Failed to add widget');
    },
    [baseUrl, layoutId, fetchWidgets],
  );

  const updateWidget = useCallback(
    async (id: string, widget: Partial<DashboardWidget>) => {
      const response = await fetch(`${baseUrl}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(widget),
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
        return result.data;
      }
      throw new Error(result.error || 'Failed to update widget');
    },
    [baseUrl, fetchWidgets],
  );

  const removeWidget = useCallback(
    async (id: string) => {
      const response = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
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
      const response = await fetch(`${baseUrl}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout_id: layoutId, widget_ids: widgetIds }),
      });
      const result = await response.json();
      if (result.success) {
        await fetchWidgets();
      } else {
        throw new Error(result.error || 'Failed to reorder widgets');
      }
    },
    [baseUrl, layoutId, fetchWidgets],
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
