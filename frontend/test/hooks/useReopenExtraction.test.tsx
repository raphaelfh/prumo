/**
 * useReopenExtraction hits the arbitrator-only reopen endpoint and, on success,
 * invalidates the run's detail family so the now-empty consensus/published rows
 * and stage='extract' are refetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/integrations/api';
import { useReopenExtraction } from '@/hooks/runs/useReopenExtraction';
import { runsKeys } from '@/hooks/runs/types';

vi.mock('@/integrations/api', () => ({ apiClient: vi.fn() }));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useReopenExtraction', () => {
  it('POSTs to reopen-extraction and invalidates the run detail key on success', async () => {
    vi.mocked(apiClient).mockResolvedValue({ id: 'run-1', stage: 'extract' });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useReopenExtraction(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync('run-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient).toHaveBeenCalledWith('/api/v1/runs/run-1/reopen-extraction', {
      method: 'POST',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: runsKeys.detail('run-1') });
  });
});
