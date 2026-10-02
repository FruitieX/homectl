import { useEffect, useRef, useState } from 'react';
import type { ReusePreviewResponse } from '@/lib/automationPreview';
import {
  ConditionPreviewResult,
  ValuePreviewResult,
  PreviewStepList,
  PreviewJson,
} from '@/ui/AutomationPreviewResult';
import { useAppConfig } from '@/hooks/appConfig';
import { stringifyConfig } from '@/lib/routineDraft';
import { Button } from '@/ui/primitives/button';

/** This endpoint executes a draft against captured data and never dispatches actions. */
export function ReusePreview({ request }: { request: unknown }) {
  const { apiEndpoint } = useAppConfig();
  const [result, setResult] = useState<ReusePreviewResponse>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [reviewed, setReviewed] = useState(''),
    [evaluatedAt, setEvaluatedAt] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const serialized = stringifyConfig(request);
  useEffect(() => {
    requestRef.current?.abort();
    setPending(false);
    setError('');
    return () => requestRef.current?.abort();
  }, [serialized]);
  async function preview() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError('');
    setResult(undefined);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/reuse-preview`,
        {
          method: 'POST',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        },
      );
      const body = await response.json();
      if (!response.ok || !body.success)
        throw new Error(body.error ?? 'Preview failed.');
      if (!controller.signal.aborted) {
        setResult(body.data);
        setReviewed(serialized);
        setEvaluatedAt(new Date().toLocaleTimeString());
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Preview failed.');
    } finally {
      if (!controller.signal.aborted) setPending(false);
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
        <div
          aria-label="Preview result"
          className="space-y-4 rounded-lg border border-border bg-background p-4"
        >
          <p
            role="status"
            className={`text-xs ${reviewed === serialized ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}
          >
            {reviewed === serialized
              ? 'Preview of this draft'
              : 'Draft changed; preview again.'}
          </p>
          {result.kind === 'condition' ? (
            <ConditionPreviewResult condition={result.value} />
          ) : result.kind === 'action' ? (
            <PreviewStepList
              steps={result.steps}
              suppressions={result.suppressions}
            />
          ) : (
            <ValuePreviewResult kind={result.kind} value={result.value} />
          )}
          <p className="text-xs text-muted-foreground">
            Evaluated {evaluatedAt} against the server state at that time. No
            actions were applied.
          </p>
          <PreviewJson value={result} />
        </div>
      )}
    </div>
  );
}
