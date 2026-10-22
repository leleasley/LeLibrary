import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Reads only: bounded retries, and never retry an auth or credential
        // failure, which is the common cause of a failed LeLibrary read.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Mutations hit providers, push collections or verify keys. Never retry.
        retry: false,
      },
    },
  });
}
