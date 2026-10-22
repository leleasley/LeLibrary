import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/api/query-client';

export function AppProviders({ children }: { children: ReactNode }) {
  // One client per mount. Retries stay off by default: most LeLibrary calls are
  // credential checks or mutations, and retrying them creates provider traffic.
  const [client] = useState(() => createQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
