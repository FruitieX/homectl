import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { CSSProperties } from 'react';

export type DashboardSpacing = 'compact' | 'balanced' | 'spacious';
export type DashboardSpacingSettings = { outer: number; gap: number };
const spacingAtom = atomWithStorage<DashboardSpacing>(
  'homectl-dashboard-spacing',
  'balanced',
);
export const useDashboardSpacing = () => useAtom(spacingAtom);
const spacingSettingsAtom = atomWithStorage<DashboardSpacingSettings>(
  'homectl-dashboard-spacing-settings',
  { outer: 10, gap: 12 },
);
export const useDashboardSpacingSettings = () => useAtom(spacingSettingsAtom);
export const dashboardSpacingStyles: Record<DashboardSpacing, CSSProperties> = {
  compact: {
    '--widget-padding': '0.625rem',
    '--widget-inner-y': '0.25rem',
    '--widget-tile-padding': '0.5rem',
    '--dashboard-gap': '0.5rem',
    '--dashboard-row': '4.5rem',
  } as CSSProperties,
  balanced: {
    '--widget-padding': '0.875rem',
    '--widget-inner-y': '0.5rem',
    '--widget-tile-padding': '0.625rem',
    '--dashboard-gap': '0.75rem',
    '--dashboard-row': '6rem',
  } as CSSProperties,
  spacious: {
    '--widget-padding': '1.25rem',
    '--widget-inner-y': '1rem',
    '--widget-tile-padding': '0.75rem',
    '--dashboard-gap': '1rem',
    '--dashboard-row': '9rem',
  } as CSSProperties,
};
