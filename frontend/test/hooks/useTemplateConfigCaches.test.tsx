/**
 * useTemplateConfigCaches / useTemplateRepublish — the B-4 invalidation
 * contract. No other test guards the worklist against going stale after
 * Publish (templateActiveStructureKeys), or the runs cache against
 * churning on every draft edit — this file is that guard.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const republishTemplateVersion = vi.fn();
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: (...a: unknown[]) => republishTemplateVersion(...a),
}));
vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {
  useTemplateConfigCaches,
  useTemplateRepublish,
} from '@/hooks/extraction/useTemplateRepublish';
import {runsKeys} from '@/hooks/runs/types';
import {
  templateActiveStructureKeys,
  templateConfigStatusKeys,
  templateEntityTypesKeys,
} from '@/lib/query-keys/extraction';
import {toast} from 'sonner';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  return {
    queryClient,
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTemplateConfigCaches', () => {
  it('invalidateStructure refreshes grid + chip and NEVER touches runs', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateStructure();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.byTemplate('t1')}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateActiveStructureKeys.byTemplate('p1', 't1'),
      }),
    );
  });

  it('invalidateAll additionally refreshes runs + the ACTIVE structure', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateAll();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.byTemplate('t1')}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateActiveStructureKeys.byTemplate('p1', 't1'),
      }),
    );
  });

  it('invalidateAfterImport hits the .all families (import may target a DIFFERENT template)', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateAfterImport();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateConfigStatusKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateActiveStructureKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
  });

  it('is inert without ids', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(
      () => useTemplateConfigCaches(undefined, undefined),
      {wrapper},
    );

    await result.current.invalidateStructure();
    await result.current.invalidateAll();

    expect(invalidate).not.toHaveBeenCalled();

    // Import invalidation is id-free by design (.all families).
    await result.current.invalidateAfterImport();
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.all}),
    );
  });
});

describe('useTemplateRepublish (the Publish path)', () => {
  it('returns the publish result and runs the full invalidation', async () => {
    republishTemplateVersion.mockResolvedValue({
      ok: true,
      data: {version_id: 'v-2', version: 2, changed: true, repinned_run_count: 3},
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {
      wrapper,
    });

    const outcome = await result.current.republish();

    expect(outcome).toEqual({
      version_id: 'v-2',
      version: 2,
      changed: true,
      repinned_run_count: 3,
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({queryKey: runsKeys.all}),
      ),
    );
  });

  it('returns null and toasts on failure, touching no caches', async () => {
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: {message: 'boom'},
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {
      wrapper,
    });

    const outcome = await result.current.republish();

    expect(outcome).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
