/**
 * Every screening/PRISMA read refetches on remount. No article writer
 * (Zotero/RIS import, manual create, delete) invalidates the screening keys,
 * so under the app's 5-minute staleTime a remount would otherwise keep
 * pre-import enroll and PRISMA numbers. One row per screening `useQuery`.
 */
import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {Mock} from 'vitest';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

const fetchScreeningConfig = vi.fn();
const fetchImportRun = vi.fn();
const fetchScreeningQueue = vi.fn();
const fetchAssignment = vi.fn();
const fetchConflicts = vi.fn();
const fetchPrismaCounts = vi.fn();
vi.mock('@/services/screeningService', () => ({
  fetchScreeningConfig: (...args: unknown[]) => fetchScreeningConfig(...args),
  fetchImportRun: (...args: unknown[]) => fetchImportRun(...args),
  fetchScreeningQueue: (...args: unknown[]) => fetchScreeningQueue(...args),
  fetchAssignment: (...args: unknown[]) => fetchAssignment(...args),
  fetchConflicts: (...args: unknown[]) => fetchConflicts(...args),
  fetchPrismaCounts: (...args: unknown[]) => fetchPrismaCounts(...args),
}));

import {usePrismaCounts} from '@/hooks/screening/usePrismaCounts';
import {useImportRun} from '@/hooks/screening/usePubmedImport';
import {useScreeningAssignment} from '@/hooks/screening/useScreeningAssignment';
import {useScreeningConflicts} from '@/hooks/screening/useScreeningConflicts';
import {useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {useScreeningQueue} from '@/hooks/screening/useScreeningQueue';

// The app's default freshness window (frontend/App.tsx): a cached read inside
// it is fresh, so only refetchOnMount can make a remount fetch again.
const APP_STALE_TIME_MS = 5 * 60 * 1000;
// `running`, not `completed`: a finished run invalidates the whole screening
// family, which refetches the run itself and would double the call count. The
// 2 s poll interval cannot fire inside this test.
const DATA = {stub: true, status: 'running'};

type Row = [name: string, useHook: () => {data: unknown; isSuccess: boolean; isStale: boolean}, serviceFn: Mock];

const ROWS: Row[] = [
  ['useScreeningConfig', () => useScreeningConfig('p1'), fetchScreeningConfig],
  ['useImportRun', () => useImportRun('p1', 's1'), fetchImportRun],
  ['useScreeningQueue', () => useScreeningQueue('p1', true), fetchScreeningQueue],
  ['useScreeningAssignment', () => useScreeningAssignment('a1'), fetchAssignment],
  ['useScreeningConflicts', () => useScreeningConflicts('p1', true), fetchConflicts],
  ['usePrismaCounts', () => usePrismaCounts('p1'), fetchPrismaCounts],
];

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: APP_STALE_TIME_MS}},
  });
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('screening queries', () => {
  it.each(ROWS)('%s refetches when it remounts with fresh cached data', async (_name, useHook, serviceFn) => {
    serviceFn.mockReset();
    serviceFn.mockResolvedValue({ok: true, data: DATA});
    const Wrapper = wrapper();

    const first = renderHook(() => useHook(), {wrapper: Wrapper});
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    expect(serviceFn).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useHook(), {wrapper: Wrapper});
    // Precondition: the remount is served from a FRESH cache entry, so only
    // refetchOnMount can fetch again.
    expect(second.result.current.data).toEqual(DATA);
    expect(second.result.current.isStale).toBe(false);
    await waitFor(() => expect(serviceFn).toHaveBeenCalledTimes(2));
  });
});
