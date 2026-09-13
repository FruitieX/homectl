export const DASHBOARD_COMPACT_BREAKPOINT_PX = 600;
export const DASHBOARD_WIDE_BREAKPOINT_PX = 1024;
export const DASHBOARD_MOBILE_COLUMNS = 4;
export const DASHBOARD_COMPACT_COLUMNS = 6;
export const DASHBOARD_WIDE_COLUMNS = 8;
export const DASHBOARD_MAX_ROWS = 8;

export const DASHBOARD_GRID_HELP =
  'Dashboard widgets auto-layout by order and size. They use 4 columns below 600px, 6 columns from 600px, and 8 columns from 1024px. Width 6 is full width on a 600px dashboard display; width 8 is full width on large screens. Widgets also have content-aware minimum widths so narrow settings do not clip controls, charts, or text.';

export function clampDashboardWidgetWidth(
  width: number,
  columns = DASHBOARD_WIDE_COLUMNS,
) {
  return Math.min(columns, Math.max(1, Math.round(width)));
}

export function clampDashboardWidgetHeight(height: number) {
  return Math.min(DASHBOARD_MAX_ROWS, Math.max(1, Math.round(height)));
}

export function getDashboardWidgetMinimumWidth(widgetType: string) {
  switch (widgetType) {
    case 'home_overview':
    case 'spot_price':
    case 'train_schedule':
      return 4;
    case 'sensors':
      return 3;
    case 'clock':
    case 'weather':
    case 'controls':
    case 'text':
    case 'link':
    case 'image':
    case 'iframe':
    case 'custom':
      return 2;
    default:
      return 1;
  }
}

export function getDashboardWidgetSpanClass(
  width: number,
  widgetType?: string,
) {
  const minimumWidth = widgetType
    ? getDashboardWidgetMinimumWidth(widgetType)
    : 1;
  const normalizedWidth = clampDashboardWidgetWidth(
    Math.max(width, minimumWidth),
  );
  switch (normalizedWidth) {
    case 1:
      return 'col-span-4 min-[37.5rem]:col-span-1 lg:col-span-1';
    case 2:
      return 'col-span-4 min-[37.5rem]:col-span-2 lg:col-span-2';
    case 3:
      return 'col-span-4 min-[37.5rem]:col-span-3 lg:col-span-3';
    case 4:
      return 'col-span-4 min-[37.5rem]:col-span-4 lg:col-span-4';
    case 5:
      return 'col-span-4 min-[37.5rem]:col-span-5 lg:col-span-5';
    case 6:
      return 'col-span-4 min-[37.5rem]:col-span-6 lg:col-span-6';
    case 7:
      return 'col-span-4 min-[37.5rem]:col-span-6 lg:col-span-7';
    default:
      return 'col-span-4 min-[37.5rem]:col-span-6 lg:col-span-8';
  }
}

export function getDashboardWidgetRowSpanStyle(height: number) {
  const normalizedHeight = clampDashboardWidgetHeight(height);

  return {
    gridRow: `span ${normalizedHeight} / span ${normalizedHeight}`,
  };
}
