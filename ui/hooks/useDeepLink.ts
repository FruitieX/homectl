import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Opens a create flow when the URL carries `?new=1`, used by command palette
 * "New …" actions. The parameter is consumed so a refresh does not reopen it.
 */
export function useCreateDeepLink(onCreate: () => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('new') === '1';
  const handled = useRef(false);

  useEffect(() => {
    if (!requested || handled.current) return;
    handled.current = true;
    onCreate();
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [onCreate, requested, searchParams, setSearchParams]);
}

/**
 * Search input state that mirrors `?q=` so palette results and external deep
 * links can pre-filter a list. Unlike a plain useState, updating the query
 * also updates the URL (replace, no history spam).
 */
export function useSearchParamState(): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    setValue(searchParams.get('q') ?? '');
  }, [searchParams]);

  const setSearch = useCallback(
    (next: string) => {
      setValue(next);
      const params = new URLSearchParams(searchParams);
      if (next) {
        params.set('q', next);
      } else {
        params.delete('q');
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return [value, setSearch];
}
