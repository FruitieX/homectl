import type { useCalibrationEditor } from '@/hooks/useCalibrationEditor';
import { Button } from '@/ui/primitives/button';

export function CalibrationCatalogStatus({
  query,
}: {
  query: ReturnType<typeof useCalibrationEditor>;
}) {
  if (!query.error)
    return query.data ? null : (
      <p role="status">Loading calibration profiles…</p>
    );
  return (
    <div role="alert" className="space-y-2 text-sm">
      <p>
        {query.data
          ? 'Could not refresh calibration profiles. Saved data and your draft are kept.'
          : 'Could not load calibration profiles.'}
      </p>
      <p className="text-xs text-muted-foreground">{query.error.message}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Retry calibration profiles
      </Button>
    </div>
  );
}
