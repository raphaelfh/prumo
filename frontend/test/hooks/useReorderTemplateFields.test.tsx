/**
 * useReorderTemplateFields — the section-renumber chokepoint (B-6 T1).
 *
 * B-4 invariant: a reorder is a DRAFT edit — nothing here republishes;
 * on success only the grid + Draft chip caches refresh. No success
 * toast: the panel's single-slot Undo toast (T5) owns success feedback,
 * and Undo re-enters through THIS hook with the captured prior batch.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/extractionFieldService', () => ({
  reorderFields: vi.fn(),
}));
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: vi.fn(),
  loadTemplateConfigStatus: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {toast} from 'sonner';

import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {t} from '@/lib/copy';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {reorderFields} from '@/services/extractionFieldService';
import {republishTemplateVersion} from '@/services/templateService';

const reorderMock = reorderFields as unknown as ReturnType<typeof vi.fn>;
const republishMock = republishTemplateVersion as unknown as ReturnType<typeof vi.fn>;

function setup(opts?: {invalidateOnSuccess?: boolean}) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const {result} = renderHook(() => useReorderTemplateFields('p1', 't1', opts), {wrapper});
  return {result, invalidateSpy};
}

const structureInvalidations = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0] as {queryKey?: unknown} | undefined;
    return (
      JSON.stringify(arg?.queryKey) ===
      JSON.stringify(templateEntityTypesKeys.byTemplate('t1'))
    );
  });

const BATCH = [
  {id: 'f1', sort_order: 1},
  {id: 'f2', sort_order: 2},
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useReorderTemplateFields', () => {
  it('reorders with the batch write alone — refreshes the structure and NEVER republishes (B-4)', async () => {
    reorderMock.mockResolvedValue({ok: true, data: undefined});
    const {result, invalidateSpy} = setup();

    act(() => {
      result.current.mutate({updates: BATCH});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reorderMock).toHaveBeenCalledWith(BATCH);
    expect(structureInvalidations(invalidateSpy).length).toBeGreaterThan(0);
    expect(republishMock).not.toHaveBeenCalled();
    // The Undo toast (T5, panel-owned) is the success surface — not here.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('invalidateOnSuccess: false suppresses the hook-level refresh (dispatcher-routed calls)', async () => {
    // The serialized dispatcher (useMoveFieldTo) awaits its OWN
    // invalidateStructure per settled move — the hook must not double it.
    reorderMock.mockResolvedValue({ok: true, data: undefined});
    const {result, invalidateSpy} = setup({invalidateOnSuccess: false});

    act(() => {
      result.current.mutate({updates: BATCH});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(structureInvalidations(invalidateSpy).length).toBe(0);
  });

  it('toasts the templateConfig error copy on a partial failure — and still never republishes', async () => {
    // The service already aggregated a resolve-dont-reject inspection
    // into ok:false; the hook only has to surface it honestly.
    reorderMock.mockResolvedValue({
      ok: false,
      error: new Error('Failed to update sort_order for 1 field(s): permission denied'),
    });
    const {result, invalidateSpy} = setup();

    act(() => {
      result.current.mutate({updates: BATCH});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith(
      `${t('templateConfig', 'errors_reorderFields')}: Failed to update sort_order for 1 field(s): permission denied`,
    );
    expect(structureInvalidations(invalidateSpy).length).toBe(0);
    expect(republishMock).not.toHaveBeenCalled();
  });
});
