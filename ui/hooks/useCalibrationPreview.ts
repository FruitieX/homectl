import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppConfig } from '@/hooks/appConfig';
import { createUuid } from '@/lib/uuid';

/** Live sessions never enter a retained draft. Reopening requires a new Start. */
export function useCalibrationPreview(kind: 'color' | 'brightness') {
  const { apiEndpoint } = useAppConfig();
  const base = `${apiEndpoint}/api/v1/config`;
  const owner = useRef({
    id: null as string | null,
    started: false,
    mounted: true,
    queue: Promise.resolve() as Promise<unknown>,
  });
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const response = await fetch(`${base}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
        keepalive: method === 'DELETE',
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error ?? 'Could not contact the lights');
    },
    [base],
  );
  const enqueue = useCallback(<T>(action: () => Promise<T>) => {
    const current = owner.current;
    const next = current.queue.catch(() => undefined).then(action);
    current.queue = next;
    return next;
  }, []);
  const stop = useCallback(async () => {
    await enqueue(async () => {
      const current = owner.current;
      if (current.id)
        await request(`calibration-sessions/${current.id}`, 'DELETE');
      current.id = null;
      current.started = false;
      if (current.mounted) setActive(false);
    });
  }, [enqueue, request]);
  const preview = async (body: unknown) => {
    setPending(true);
    setError(null);
    try {
      await enqueue(async () => {
        const current = owner.current;
        if (!current.mounted) return;
        const id = current.id ?? createUuid();
        current.id = id; // Also clean up an uncertain start after a lost response.
        await request(
          `${kind === 'color' ? 'calibration-sessions' : 'calibration-brightness-sessions'}/${id}`,
          current.started ? 'PUT' : 'POST',
          body,
        );
        current.started = true;
        if (current.mounted) setActive(true);
      });
    } catch (error) {
      if (owner.current.mounted)
        setError(error instanceof Error ? error.message : 'Preview failed');
      throw error;
    } finally {
      if (owner.current.mounted) setPending(false);
    }
  };
  useEffect(() => {
    const current = owner.current;
    current.mounted = true;
    const timer = window.setInterval(() => {
      if (!current.id || !current.started) return;
      void request(
        `calibration-sessions/${current.id}/heartbeat`,
        'POST',
      ).catch(() => {
        if (current.mounted) {
          setActive(false);
          setError(
            'The preview connection was lost. Stop the preview before starting again; the server also restores expired sessions automatically.',
          );
        }
      });
    }, 30000);
    return () => {
      current.mounted = false;
      window.clearInterval(timer);
      void stop().catch(() => undefined);
    };
  }, [request, stop]);
  return { preview, stop, active, pending, error };
}
