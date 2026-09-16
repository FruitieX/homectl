import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

import {
  DASHBOARD_COMPACT_BREAKPOINT_PX,
  DASHBOARD_COMPACT_COLUMNS,
  DASHBOARD_MOBILE_COLUMNS,
  DASHBOARD_WIDE_BREAKPOINT_PX,
  DASHBOARD_WIDE_COLUMNS,
} from '@/lib/dashboard-layout';

export type DashboardGridSnap = 0.25 | 0.5 | 1;
export type DashboardScreenSimulation =
  | 'device'
  | 'phone'
  | 'tablet'
  | 'desktop';

export interface DashboardEditingSettings {
  gridSnap: DashboardGridSnap;
  screenSimulation: DashboardScreenSimulation;
}

export const DASHBOARD_GRID_SNAP_OPTIONS: Array<{
  value: DashboardGridSnap;
  label: string;
}> = [
  { value: 0.25, label: 'Quarter columns (0.25)' },
  { value: 0.5, label: 'Half columns (0.5)' },
  { value: 1, label: 'Whole columns (1)' },
];

export const DASHBOARD_SCREEN_SIMULATION_OPTIONS: Array<{
  value: DashboardScreenSimulation;
  label: string;
  description: string;
}> = [
  {
    value: 'device',
    label: 'Device size',
    description: 'Use this device’s actual responsive dashboard size.',
  },
  {
    value: 'phone',
    label: 'Phone',
    description: 'Simulate a narrow four-column dashboard.',
  },
  {
    value: 'tablet',
    label: 'Tablet',
    description: 'Simulate a six-column dashboard.',
  },
  {
    value: 'desktop',
    label: 'Desktop',
    description: 'Simulate a wide eight-column dashboard.',
  },
];

const dashboardEditingSettingsAtom = atomWithStorage<DashboardEditingSettings>(
  'homectl-dashboard-editing-settings',
  {
    gridSnap: 0.25,
    screenSimulation: 'device',
  },
);

export const useDashboardEditingSettings = () =>
  useAtom(dashboardEditingSettingsAtom);

export function getDashboardColumnsForScreen(
  screenSimulation: DashboardScreenSimulation,
  viewportWidth: number,
) {
  if (screenSimulation === 'phone') {
    return DASHBOARD_MOBILE_COLUMNS;
  }
  if (screenSimulation === 'tablet') {
    return DASHBOARD_COMPACT_COLUMNS;
  }
  if (screenSimulation === 'desktop') {
    return DASHBOARD_WIDE_COLUMNS;
  }
  if (viewportWidth < DASHBOARD_COMPACT_BREAKPOINT_PX) {
    return DASHBOARD_MOBILE_COLUMNS;
  }
  if (viewportWidth < DASHBOARD_WIDE_BREAKPOINT_PX) {
    return DASHBOARD_COMPACT_COLUMNS;
  }
  return DASHBOARD_WIDE_COLUMNS;
}
