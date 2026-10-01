import { useState } from 'react';
import { useAppConfig } from '@/hooks/appConfig';
import { stringifyConfig } from '@/lib/routineDraft';
import { Button } from '@/ui/primitives/button';

/** This endpoint executes a draft against captured data and never dispatches actions. */
export function ReusePreview({ request }: { request: unknown }) {
  const { apiEndpoint } = useAppConfig();
  const [result, setResult] = useState<unknown>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [reviewed, setReviewed] = useState('');
  const serialized = stringifyConfig(request);
  async function preview() {
    setPending(true);
    setError('');
    setResult(undefined);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/reuse-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        },
      );
      const body = await response.json();
      if (!response.ok || !body.success)
        throw new Error(body.error ?? 'Preview failed.');
      setResult(body.data);
      setReviewed(serialized);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Preview failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void preview()}
        >
          {pending ? 'Previewing…' : 'Preview draft'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Uses current values. No actions are applied.
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result !== undefined && (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {reviewed === serialized
              ? 'Preview of this draft'
              : 'Draft changed; preview again.'}
          </p>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
