import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/hitlConfigService', () => ({setManagerReviewVisibility: vi.fn()}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {toast} from 'sonner';
import {setManagerReviewVisibility} from '@/services/hitlConfigService';
import {useManagerReviewVisibility} from '@/hooks/hitl/useManagerReviewVisibility';

const setMock = vi.mocked(setManagerReviewVisibility);

beforeEach(() => vi.clearAllMocks());

describe('useManagerReviewVisibility', () => {
  it('flips optimistically and saves only its own kind', async () => {
    let resolve!: () => void;
    setMock.mockReturnValue(new Promise((r) => { resolve = () => r({extraction: true, quality_assessment: false} as never); }));
    const {result} = renderHook(() => useManagerReviewVisibility('p1', 'extraction', false));

    act(() => result.current.onToggle(true));
    expect(result.current.checked).toBe(true);
    expect(result.current.saving).toBe(true);
    expect(setMock).toHaveBeenCalledWith('p1', 'extraction', true);

    await act(async () => resolve());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.checked).toBe(true);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('reverts and reports the error when the save fails', async () => {
    setMock.mockRejectedValue(new Error('boom'));
    const {result} = renderHook(() => useManagerReviewVisibility('p1', 'quality_assessment', false));

    act(() => result.current.onToggle(true));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.checked).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('re-syncs when the persisted value arrives after mount', () => {
    const {result, rerender} = renderHook(
      ({value}) => useManagerReviewVisibility('p1', 'extraction', value),
      {initialProps: {value: false}},
    );
    expect(result.current.checked).toBe(false);
    rerender({value: true});
    expect(result.current.checked).toBe(true);
  });
});
