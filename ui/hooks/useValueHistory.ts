import { useAppConfig } from '@/hooks/appConfig';
import { useEffect, useState } from 'react';
import type { ValueHistoryEntry } from '@/bindings/ValueHistoryEntry';

export function useValueHistory(sourceKey: string, path: string) {
  const { apiEndpoint } = useAppConfig();
  const [history, setHistory] = useState<ValueHistoryEntry[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!sourceKey || !path || !path.startsWith('/')) {
      setHistory([]);
      setError(false);
      return;
    }
    setHistory([]);
    setError(false);
    const controller = new AbortController();
    const params = new URLSearchParams({ source_key: sourceKey, path });
    fetch(`${apiEndpoint}/api/v1/config/value-history?${params}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('History unavailable');
        return response.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) setHistory(body?.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHistory([]);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [apiEndpoint, sourceKey, path]);
  return { history, error };
}
