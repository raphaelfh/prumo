/**
 * useUpdateTemplateField — the inspector's composed write path.
 *
 * The invariant under test: the mutation settles only after BOTH the
 * PostgREST field update AND the republish have finished. The dialog's
 * fire-and-forget `void republish()` lets the UI report "saved" while the
 * forms still render the previous version; the inspector must not.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const updateField = vi.fn();
vi.mock('@/services/extractionFieldService', () => ({
  updateField: (...args: unknown[]) => updateField(...args),
}));

const republish = vi.fn();
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateRepublish: () => ({republish}),
}));

vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {
  RepublishFailedError,
  useUpdateTemplateField,
} from '@/hooks/extraction/useUpdateTemplateField';
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
});

describe('useUpdateTemplateField', () => {
  it('updates the field, then republishes, then resolves', async () => {
    updateField.mockResolvedValue({ok: true, data: saved});
    republish.mockResolvedValue(true);

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

    expect(updateField).toHaveBeenCalledWith('f1', {label: 'Saved'});
    expect(republish).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual(saved);
  });

  it('stays pending until republish resolves', async () => {
    updateField.mockResolvedValue({ok: true, data: saved});
    let releaseRepublish: () => void = () => {};
    republish.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseRepublish = () => resolve(true);
        }),
    );

    const {result} = renderHook(() => useUpdateTemplateField('p1', 't1'), {
      wrapper,
    });

    act(() => {
      result.current.mutate({fieldId: 'f1', updates: {label: 'Saved'}});
    });
    await waitFor(() => expect(republish).toHaveBeenCalled());
    expect(result.current.isPending).toBe(true);

    act(() => releaseRepublish());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rejects on a service error without republishing', async () => {
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
    expect(republish).not.toHaveBeenCalled();
  });

  it('rejects when the republish fails, without a success toast', async () => {
    updateField.mockResolvedValue({ok: true, data: saved});
    republish.mockResolvedValue(false);

    const {result} = renderHook(() => useUpdateTemplateField('p1', 't1'), {
      wrapper,
    });

    act(() => {
      result.current.mutate({fieldId: 'f1', updates: {label: 'Saved'}});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(RepublishFailedError);
    expect(toast.success).not.toHaveBeenCalled();
    // republish toasted its own error already — no doubled error toast.
    expect(toast.error).not.toHaveBeenCalled();
  });
});
