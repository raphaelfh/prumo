/**
 * Regression coverage for useComparisonPermissions.
 *
 * Root-cause guard for the missing async-cancellation guard: the effect
 * fetched permissions and committed the result unconditionally, so a slow
 * stale response could overwrite a newer one. The reachable trigger is a
 * manager's Reveal (`onReveal` → setManagerReviewVisibility → refresh()):
 * if the mount fetch (still blind) resolves AFTER the refresh's fetch
 * (revealed), the screen reverts to blind mode despite the reveal. The hook
 * must commit only the most-recent fetch's result.
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, renderHook, waitFor} from '@testing-library/react';

vi.mock('@/services/projectSettingsService', () => ({
  loadComparisonPermissions: vi.fn(),
}));

import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import {loadComparisonPermissions} from '@/services/projectSettingsService';

type Result = Awaited<ReturnType<typeof loadComparisonPermissions>>;

function okResult(canSeeOthers: boolean): Result {
  return {
    ok: true,
    data: {
      userRole: 'manager',
      isBlindMode: !canSeeOthers,
      rules: {
        canSeeOthers,
        canResolveConflicts: true,
        canManageBlindMode: true,
        canExport: true,
        canEditTemplate: true,
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(loadComparisonPermissions).mockReset();
});

describe('useComparisonPermissions', () => {
  it('drops a stale in-flight fetch that resolves after a newer one', async () => {
    let resolveP1: (r: Result) => void = () => {};
    let resolveP2: (r: Result) => void = () => {};
    const p1 = new Promise<Result>((r) => (resolveP1 = r));
    const p2 = new Promise<Result>((r) => (resolveP2 = r));

    // Keyed on projectId so interleaving of the two fetches doesn't matter:
    // p1 (old coordinate) is blind, p2 (new coordinate) is revealed.
    vi.mocked(loadComparisonPermissions).mockImplementation((projectId) =>
      projectId === 'p1' ? p1 : p2,
    );

    const {result, rerender} = renderHook(
      ({projectId}) => useComparisonPermissions(projectId, 'u1', 'extraction'),
      {initialProps: {projectId: 'p1'}},
    );

    // Change the coordinate while p1 is still in flight → starts the p2 fetch.
    await act(async () => {
      rerender({projectId: 'p2'});
    });

    // Resolve the NEWER fetch first, then the STALE one — out of order.
    await act(async () => {
      resolveP2(okResult(true)); // p2 → revealed
      await p2;
    });
    await act(async () => {
      resolveP1(okResult(false)); // p1 → blind (stale, resolves last)
      await p1;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The stale p1 response must NOT clobber the fresh p2 permissions.
    expect(result.current.canSeeOthers).toBe(true);
    expect(result.current.isBlindMode).toBe(false);
  });
});
