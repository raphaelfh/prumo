/**
 * useUpdateTemplateField — the inspector's write path.
 *
 * B-4: Save is the PostgREST write alone — edits are draft edits, so no
 * republish happens (the Publish button owns versioning). On success the
 * hook refreshes the grid + Draft chip caches; on failure the form keeps
 * its dirty state and Save stays available for retry.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const updateField = vi.fn();
vi.mock('@/services/extractionFieldService', () => ({
  updateField: (...args: unknown[]) => updateField(...args),
}));

const invalidateStructure = vi.fn();
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: () => ({
    invalidateStructure,
    invalidateAll: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {toast} from 'sonner';

function wrapper({children}: {children: ReactNode}) {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const saved = {id: 'f1', label: 'Saved'};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateStructure.mockResolvedValue(undefined);
});

describe('useUpdateTemplateField', () => {
  it('saves the field with the write alone and refreshes the caches', async () => {
    updateField.mockResolvedValue({ok: true, data: saved});

    const {result} = renderHook(() => useUpdateTemplateField('p1', 't1'), {
      wrapper,
    });

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        fieldId: 'f1',
        updates: {label: 'Saved'},
      });
    });

    expect(updateField).toHaveBeenCalledWith('p1', 't1', 'f1', {label: 'Saved'});
    expect(resolved).toEqual(saved);
    expect(toast.success).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(invalidateStructure).toHaveBeenCalledTimes(1));
  });

  it('rejects on a service error without touching the caches', async () => {
    updateField.mockResolvedValue({
      ok: false,
      error: {message: 'row-level security'},
    });

    const {result} = renderHook(() => useUpdateTemplateField('p1', 't1'), {
      wrapper,
    });

    act(() => {
      result.current.mutate({fieldId: 'f1', updates: {label: 'X'}});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateStructure).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
