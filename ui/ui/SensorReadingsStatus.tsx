import type { ReactNode } from 'react';
import { Button } from '@/ui/primitives/button';

/** Keep missing, failed and retained readings distinct across climate views. */
export function SensorReadingsStatus({
  resource,
  children,
}: {
  resource: {
    rows: readonly unknown[];
    isError: boolean;
    isPending: boolean;
    isFetching: boolean;
    isShowingPreviousRows: boolean;
    refetch: () => unknown;
  };
  children?: ReactNode;
}) {
  const failed = resource.isError || resource.isShowingPreviousRows;
  const message = resource.isError
    ? resource.rows.length
      ? 'Readings could not be refreshed. Showing the last available samples.'
      : 'Readings could not be loaded.'
    : resource.isShowingPreviousRows
      ? 'The source returned no new readings. Showing the last available samples.'
      : resource.isPending
        ? 'Loading readings…'
        : resource.rows.length === 0
          ? 'No readings available.'
          : children;
  if (!message) return null;
  return (
    <div role="status" className="text-xs text-muted-foreground">
      {message}{' '}
      {failed && (
        <Button
          className="pointer-events-auto"
          size="sm"
          variant="ghost"
          disabled={resource.isFetching}
          onClick={() => void resource.refetch()}
        >
          {resource.isFetching ? 'Retrying…' : 'Retry readings'}
        </Button>
      )}
    </div>
  );
}
