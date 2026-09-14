export const DASHBOARD_COMPACT_BREAKPOINT_PX = 600;
export const DASHBOARD_WIDE_BREAKPOINT_PX = 1024;
export const DASHBOARD_MOBILE_COLUMNS = 4;
export const DASHBOARD_COMPACT_COLUMNS = 6;
export const DASHBOARD_WIDE_COLUMNS = 8;
export const DASHBOARD_MAX_ROWS = 8;
// The public layout unit remains the width of one logical dashboard column,
// but the rendered grid is split into quarter-unit tracks so values such as
// 1.25 and 1.5 can be laid out without changing the existing config format.
export const DASHBOARD_GRID_PRECISION = 4;
export const DASHBOARD_MIN_SIZE_UNIT = 1 / DASHBOARD_GRID_PRECISION;

export const DASHBOARD_GRID_HELP =
  'Dashboard widgets auto-layout by order and size. Width and height support quarter units (for example 1.25 or 1.5). They use 4 columns below 600px, 6 columns from 600px, and 8 columns from 1024px. Width 6 is full width on a 600px dashboard display; width 8 is full width on large screens. Widgets progressively hide secondary details when their own container becomes too small.';

function normalizeDashboardUnit(value: number, fallback: number) {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return (
    Math.round(safeValue * DASHBOARD_GRID_PRECISION) / DASHBOARD_GRID_PRECISION
  );
}

export function clampDashboardWidgetWidth(
  width: number,
  columns = DASHBOARD_WIDE_COLUMNS,
) {
  return Math.min(
    columns,
    Math.max(
      DASHBOARD_MIN_SIZE_UNIT,
      normalizeDashboardUnit(width, DASHBOARD_MIN_SIZE_UNIT),
    ),
  );
}

export function clampDashboardWidgetHeight(height: number) {
  return Math.min(
    DASHBOARD_MAX_ROWS,
    Math.max(
      DASHBOARD_MIN_SIZE_UNIT,
      normalizeDashboardUnit(height, DASHBOARD_MIN_SIZE_UNIT),
    ),
  );
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
  // Kept for older consumers that still use the integer Tailwind span
  // classes. The dashboard itself uses getDashboardWidgetGridStyle below so
  // fractional widths are preserved.
  const normalizedWidth = Math.round(
    clampDashboardWidgetWidth(Math.max(width, minimumWidth)),
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

export function getDashboardWidgetGridSpan(unit: number) {
  return Math.max(
    1,
    Math.round(
      normalizeDashboardUnit(unit, DASHBOARD_MIN_SIZE_UNIT) *
        DASHBOARD_GRID_PRECISION,
    ),
  );
}

export function getDashboardWidgetGridStyle(width: number, height: number) {
  const widthSpan = getDashboardWidgetGridSpan(width);
  return {
    gridColumn: `span ${widthSpan} / span ${widthSpan}`,
    gridRow: `span ${getDashboardWidgetGridSpan(height)} / span ${getDashboardWidgetGridSpan(height)}`,
  };
}

export function getDashboardWidgetResponsiveGridStyle(
  width: number,
  height: number,
) {
  const normalizedWidth = clampDashboardWidgetWidth(width);

  return {
    '--dashboard-widget-span-mobile': String(
      getDashboardWidgetGridSpan(
        Math.min(normalizedWidth, DASHBOARD_MOBILE_COLUMNS),
      ),
    ),
    '--dashboard-widget-span-compact': String(
      getDashboardWidgetGridSpan(
        Math.min(normalizedWidth, DASHBOARD_COMPACT_COLUMNS),
      ),
    ),
    '--dashboard-widget-span-wide': String(
      getDashboardWidgetGridSpan(
        Math.min(normalizedWidth, DASHBOARD_WIDE_COLUMNS),
      ),
    ),
    gridRow: `span ${getDashboardWidgetGridSpan(height)} / span ${getDashboardWidgetGridSpan(height)}`,
  };
}

export function getDashboardWidgetRowSpanStyle(height: number) {
  return {
    gridRow: `span ${getDashboardWidgetGridSpan(height)} / span ${getDashboardWidgetGridSpan(height)}`,
  };
}
