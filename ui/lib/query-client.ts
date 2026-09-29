import { QueryClient } from '@tanstack/react-query';
import { shareQueryData } from './shareQueryData.ts';

export function createHomectlQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        structuralSharing: shareQueryData,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
