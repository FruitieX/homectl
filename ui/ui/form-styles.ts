/**
 * Shared class names for native form controls. `min-w-0 max-w-full` keeps long
 * option labels from stretching a select past its container on narrow screens;
 * callers that want the control to fill its container add `w-full`.
 */
export const selectClassName =
  'h-9 min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const selectClassNameLarge =
  'h-11 min-w-0 max-w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
