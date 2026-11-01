/**
 * A fresh QueryClient and its provider for a component that reaches the cache
 * (`useQueryClient`) without running a query of its own, so a test can spy on
 * the client it rendered with.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';

export function createQueryWrapper() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {queryClient, wrapper};
}
