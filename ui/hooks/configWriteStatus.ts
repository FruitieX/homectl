import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import type { ConfigWriteStatus } from '@/bindings/ConfigWriteStatus';

const warningsAtom = atom<Record<string, string>>({});
export const useConfigWriteWarnings = () => useAtomValue(warningsAtom);
export function useRecordConfigWrite() {
  const setWarnings = useSetAtom(warningsAtom);
  return useCallback(
    (key: string, status?: ConfigWriteStatus, persistedPrefix?: string) => {
      if (!status) return;
      setWarnings((current) => {
        const next = { ...current };
        if (status.persistence === 'persisted') {
          delete next[key];
          if (persistedPrefix)
            for (const existing of Object.keys(next)) {
              if (existing.startsWith(persistedPrefix)) delete next[existing];
            }
        } else
          next[key] =
            status.warning ??
            'This change is applied in memory but is not saved to the database.';
        return next;
      });
    },
    [setWarnings],
  );
}
