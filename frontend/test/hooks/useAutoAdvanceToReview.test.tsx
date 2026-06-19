import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import {
  useAutoAdvanceToReview,
  type UseAutoAdvanceToReviewParams,
} from '@/hooks/extraction/useAutoAdvanceToReview';

const base = (
  over: Partial<UseAutoAdvanceToReviewParams> = {},
): UseAutoAdvanceToReviewParams => ({
  stage: 'proposal',
  shouldAdvance: true,
  enabled: true,
  onAdvance: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('useAutoAdvanceToReview', () => {
  it('advances exactly once while in proposal with content + enabled', () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook((p: UseAutoAdvanceToReviewParams) => useAutoAdvanceToReview(p), {
      initialProps: base({ onAdvance }),
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    // A re-render with identical props must not fire a second time.
    rerender(base({ onAdvance }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not advance outside proposal', () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoAdvanceToReview(base({ stage: 'review', onAdvance })));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not advance when there is nothing to review or it is disabled', () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook((p: UseAutoAdvanceToReviewParams) => useAutoAdvanceToReview(p), {
      initialProps: base({ shouldAdvance: false, onAdvance }),
    });
    expect(onAdvance).not.toHaveBeenCalled();
    rerender(base({ enabled: false, onAdvance }));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('re-arms after the run leaves and re-enters proposal', () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook((p: UseAutoAdvanceToReviewParams) => useAutoAdvanceToReview(p), {
      initialProps: base({ onAdvance }),
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    rerender(base({ stage: 'review', onAdvance })); // leaves proposal → re-arm
    rerender(base({ stage: 'proposal', onAdvance })); // re-enters → fires again
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });

  it('retries on the next trigger after a failed advance', async () => {
    const onAdvance = vi
      .fn()
      .mockRejectedValueOnce(new Error('stage conflict'))
      .mockResolvedValueOnce(undefined);
    const { rerender } = renderHook((p: UseAutoAdvanceToReviewParams) => useAutoAdvanceToReview(p), {
      initialProps: base({ onAdvance }),
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    // The .catch re-arms firedRef asynchronously; toggling shouldAdvance
    // forces the effect to re-run once it has.
    await waitFor(() => {
      rerender(base({ shouldAdvance: false, onAdvance }));
      rerender(base({ shouldAdvance: true, onAdvance }));
      expect(onAdvance).toHaveBeenCalledTimes(2);
    });
  });
});
