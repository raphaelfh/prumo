/**
 * useMoveTemplateField — the cross-section move chokepoint (B-6 T1).
 *
 * B-4 invariant: a move is a DRAFT edit — nothing here republishes; on
 * success only the grid + Draft chip caches refresh. No success toast
 * either: the panel's single-slot Undo toast (T5) owns success feedback,
 * and Undo re-enters through THIS hook — a hook-level toast would fire
 * again on every revert.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/extractionFieldService', () => ({
  moveField: vi.fn(),
}));
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: vi.fn(),
  loadTemplateConfigStatus: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {toast} from 'sonner';

import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {t} from '@/lib/copy';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {moveField} from '@/services/extractionFieldService';
import {republishTemplateVersion} from '@/services/templateService';

const moveMock = moveField as unknown as ReturnType<typeof vi.fn>;
const republishMock = republishTemplateVersion as unknown as ReturnType<typeof vi.fn>;

function setup(opts?: {invalidateOnSuccess?: boolean}) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const {result} = renderHook(() => useMoveTemplateField('p1', 't1', opts), {wrapper});
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMoveTemplateField', () => {
  it('moves with the write alone — refreshes the structure and NEVER republishes (B-4)', async () => {
    moveMock.mockResolvedValue({
      ok: true,
      data: {id: 'f1', entity_type_id: 'sec-2', sort_order: 5},
    });
    const {result, invalidateSpy} = setup();

    act(() => {
      result.current.mutate({fieldId: 'f1', entityTypeId: 'sec-2', sortOrder: 5});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(moveMock).toHaveBeenCalledWith('p1', 't1', 'f1', 'sec-2', 5);
    expect(structureInvalidations(invalidateSpy).length).toBeGreaterThan(0);
    expect(republishMock).not.toHaveBeenCalled();
    // The Undo toast (T5, panel-owned) is the success surface — not here.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('invalidateOnSuccess: false suppresses the hook-level refresh (dispatcher-routed calls)', async () => {
    // The serialized dispatcher (useMoveFieldTo) awaits its OWN
    // invalidateStructure per settled move — the hook must not double it.
    moveMock.mockResolvedValue({
      ok: true,
      data: {id: 'f1', entity_type_id: 'sec-2', sort_order: 5},
    });
    const {result, invalidateSpy} = setup({invalidateOnSuccess: false});

    act(() => {
      result.current.mutate({fieldId: 'f1', entityTypeId: 'sec-2', sortOrder: 5});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(structureInvalidations(invalidateSpy).length).toBe(0);
  });

  it('toasts the templateConfig error copy on a refused write — and still never republishes', async () => {
    moveMock.mockResolvedValue({ok: false, error: new Error('permission denied')});
    const {result, invalidateSpy} = setup();

    act(() => {
      result.current.mutate({fieldId: 'f1', entityTypeId: 'sec-2', sortOrder: 5});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith(
      `${t('templateConfig', 'errors_moveField')}: permission denied`,
    );
    expect(structureInvalidations(invalidateSpy).length).toBe(0);
    expect(republishMock).not.toHaveBeenCalled();
  });
});
