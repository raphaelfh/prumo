/**
 * The ONE project-list cache entry, and the switcher's view of it.
 *
 * Six properties nothing else in the suite covers:
 *
 * 1. `useProjectsList` really resolves from the shared entry. That is the half
 *    of the stale-cache defect (ledger discrepancy I) an invalidation test
 *    cannot see: `invalidateQueries` was always being called, and nothing was
 *    subscribed to the key it named.
 * 2. The entry is keyed by the caller, so an in-tab account switch cannot
 *    serve user A's rows to user B out of a module-scope QueryClient that
 *    nothing clears on sign-out.
 * 3. The query waits for an identity instead of fetching under an empty one —
 *    otherwise a disabled query and an empty account look identical downstream.
 * 4. A FAILED read is reported as a failure, not as an empty list. `projects`
 *    is `[]` in both cases, so the array alone cannot tell them apart and any
 *    consumer branching on it is wrong.
 * 5. An account with genuinely no projects is NOT reported as a failure.
 * 6. `retry` re-runs the read, so the switcher's error state is actionable
 *    rather than terminal.
 */
import type {ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const listProjectsForDashboard = vi.fn();
vi.mock('@/services/projectsService', () => ({
  listProjectsForDashboard: () => listProjectsForDashboard(),
}));

let currentUser: {id: string} | null = {id: 'u1'};
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: currentUser})}));

import {projectsListKey, useProjectsQuery} from '@/hooks/useProjectsQuery';
import {useProjectsList} from '@/hooks/useProjectsList';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
    ...over,
  };
}

function harness() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return {queryClient, wrapper};
}

describe('useProjectsQuery / useProjectsList', () => {
  beforeEach(() => {
    currentUser = {id: 'u1'};
    vi.clearAllMocks();
    listProjectsForDashboard.mockResolvedValue({ok: true, data: []});
  });

  it('the switcher resolves from the shared cache entry, not a second read', async () => {
    const {queryClient, wrapper} = harness();
    queryClient.setQueryData(projectsListKey('u1'), [row(), row({id: 'p2', name: 'Beta'})]);

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.projects).toHaveLength(2));
    expect(listProjectsForDashboard).not.toHaveBeenCalled();
  });

  it('an archived project leaves the switcher', async () => {
    const {queryClient, wrapper} = harness();
    queryClient.setQueryData(projectsListKey('u1'), [
      row(),
      row({id: 'p2', name: 'Beta', is_active: false}),
    ]);

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0].name).toBe('Alpha');
  });

  it('does not serve one user\'s cached list to the next user in the same tab', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: true, data: [row({name: 'A-only'})]});

    // Drive both identities through the hook itself — seeding the cache by
    // hand would only prove the helper scopes keys, not that the hook calls
    // it. u1 populates the shared entry first.
    const {result, rerender} = renderHook(() => useProjectsQuery(), {wrapper});
    await waitFor(() => expect(result.current.data?.[0]?.name).toBe('A-only'));

    currentUser = {id: 'u2'};
    listProjectsForDashboard.mockResolvedValue({ok: true, data: [row({id: 'p9', name: 'B-only'})]});
    rerender();

    // Nothing is served synchronously: u1's entry is a different key.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.[0]?.name).toBe('B-only'));
  });

  it('waits for an identity instead of fetching under an empty one', () => {
    currentUser = null;
    const {wrapper} = harness();

    const {result} = renderHook(() => useProjectsQuery(), {wrapper});

    // `idle` — not `fetching` and not `success`: a disabled query must be
    // distinguishable from an account with no projects.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(listProjectsForDashboard).not.toHaveBeenCalled();
  });

  it('reports a failed read as a failure, not as an empty project list', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: false, error: new Error('permission denied')});

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.loading).toBe(false);
    // The discriminator. `projects` is [] here AND in the test below, so the
    // flag is the only thing that separates "the read failed" from "you have
    // no projects" — which is exactly what the deleted toast used to say.
    expect(result.current.projects).toEqual([]);
  });

  it('an account with no projects is not a failure', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: true, data: []});

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.projects).toEqual([]);
  });

  it('retry re-runs a failed read', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: false, error: new Error('permission denied')});

    const {result} = renderHook(() => useProjectsList(), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));

    listProjectsForDashboard.mockResolvedValue({ok: true, data: [row()]});
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.isError).toBe(false);
  });
});
