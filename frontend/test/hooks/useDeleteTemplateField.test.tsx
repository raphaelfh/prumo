/**
 * useDeleteTemplateField — the editor-hosted delete path (B-5 Task 7).
 *
 * B-4 invariant: a delete is a DRAFT edit — nothing here republishes
 * (the Publish button owns versioning); on success only the grid +
 * Draft chip caches refresh. A RESTRICT-FK refusal (SQLSTATE 23503,
 * mapped to friendly copy in the service) toasts VERBATIM.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/extractionFieldService', () => ({
  deleteField: vi.fn(),
}));
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: vi.fn(),
  loadTemplateConfigStatus: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {toast} from 'sonner';

import {useDeleteTemplateField} from '@/hooks/extraction/useDeleteTemplateField';
import {PgError} from '@/lib/error-utils';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {deleteField} from '@/services/extractionFieldService';
import {republishTemplateVersion} from '@/services/templateService';

const deleteMock = deleteField as unknown as ReturnType<typeof vi.fn>;
const republishMock = republishTemplateVersion as unknown as ReturnType<typeof vi.fn>;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const {result} = renderHook(() => useDeleteTemplateField('p1', 't1'), {wrapper});
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

describe('useDeleteTemplateField', () => {
  it('deletes with the write alone — refreshes the structure and NEVER republishes (B-4)', async () => {
    deleteMock.mockResolvedValue({ok: true, data: undefined});
    const {result, invalidateSpy} = setup();

    act(() => {
      result.current.mutate({fieldId: 'f1'});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteMock).toHaveBeenCalledWith('f1');
    expect(structureInvalidations(invalidateSpy).length).toBeGreaterThan(0);
    expect(republishMock).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('toasts the friendly 23503 message VERBATIM — the service already mapped it', async () => {
    deleteMock.mockResolvedValue({
      ok: false,
      error: new PgError('This field still holds extracted data', '23503'),
    });
    const {result} = setup();

    act(() => {
      result.current.mutate({fieldId: 'f1'});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('This field still holds extracted data');
    expect(republishMock).not.toHaveBeenCalled();
  });
});
